import { z } from 'zod';
import {
  CONTRACT_CHECK_DISCLAIMER,
  type ComparableFilterStats,
  type ComparableReasonCode,
  type SaleComparableSearchInput,
  type SaleComparableSearchResult,
  type SaleDeal
} from '../domain/types.js';
import { assertValidDealYmdRange } from '../utils/date.js';

export interface MolitSaleClient {
  searchSaleComparables(input: SaleComparableSearchInput): Promise<SaleComparableSearchResult>;
}

class MolitSaleRequestError extends Error {
  constructor(
    message: string,
    readonly reasonCode: ComparableReasonCode,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'MolitSaleRequestError';
  }
}

const SALE_ENDPOINTS = {
  apartment: '/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade',
  officetel: '/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade',
  villa: '/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade',
  detachedMultiFamily: '/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade'
} as const;

const PAGE_SIZE = 1000;
const MAX_PAGES_PER_MONTH = 20;
const MAX_LIMIT = 20;
const MONTH_CONCURRENCY = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_TOTAL_TIMEOUT_MS = 5000;
const GENERIC_COMPLEX_TERMS = /아파트|오피스텔|주상복합|연립주택|다세대주택|단독주택|다가구주택|빌라/gu;

const ParsedSaleDealSchema = z.object({
  lawdCode: z.string(),
  regionName: z.string(),
  contractDate: z.string(),
  salePriceKrw: z.number().positive(),
  areaM2: z.number().positive(),
  floor: z.number().optional(),
  builtYear: z.number().optional(),
  complexName: z.string().optional()
});

function listMonths(from: string, to: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(4, 6));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(4, 6));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }
  return months;
}

function buildUrl(
  options: { baseUrl: string; apiKey: string },
  input: SaleComparableSearchInput,
  dealYmd: string,
  pageNo: number
): URL {
  const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
  const url = new URL(`${baseUrl}${SALE_ENDPOINTS[input.housingType]}`);
  url.searchParams.set('serviceKey', options.apiKey);
  url.searchParams.set('LAWD_CD', input.lawdCode);
  url.searchParams.set('DEAL_YMD', dealYmd);
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(PAGE_SIZE));
  return url;
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function xmlField(xml: string, names: string[]): string | undefined {
  for (const name of names) {
    const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    const value = match?.[1]
      ? decodeXml(match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim())
      : undefined;
    if (value) return value;
  }
  return undefined;
}

function numberField(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function assertSuccessfulXml(xml: string): void {
  if (!/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<response(?:\s|>)/i.test(xml)) {
    throw new MolitSaleRequestError('MOLIT sale API returned an invalid XML response', 'API_RESPONSE_INVALID', true);
  }
  const resultCode = xmlField(xml, ['resultCode']);
  if (!resultCode) {
    throw new MolitSaleRequestError('MOLIT sale API response is missing resultCode', 'API_RESPONSE_INVALID', true);
  }
  if (resultCode === '000' || resultCode === '03') return;
  const isAuthError = ['20', '21', '22', '30', '31'].includes(resultCode);
  throw new MolitSaleRequestError(
    `MOLIT sale API returned resultCode ${resultCode}`,
    isAuthError ? 'API_AUTH_ERROR' : 'API_RESPONSE_INVALID',
    !isAuthError
  );
}

function parsePage(xml: string): { deals: Array<z.infer<typeof ParsedSaleDealSchema>>; totalCount?: number; rows?: number } {
  assertSuccessfulXml(xml);
  const deals: Array<z.infer<typeof ParsedSaleDealSchema>> = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = match[1] ?? '';
    const year = xmlField(item, ['dealYear', '년']);
    const month = xmlField(item, ['dealMonth', '월']);
    const day = xmlField(item, ['dealDay', '일']);
    const amountManwon = numberField(xmlField(item, ['dealAmount', '거래금액']));
    const areaM2 = numberField(xmlField(item, ['excluUseAr', 'totalFloorAr', '전용면적', '연면적']));
    if (!year || !month || !day || amountManwon === undefined || areaM2 === undefined) {
      throw new MolitSaleRequestError(
        'MOLIT sale API returned an unparseable transaction item',
        'API_RESPONSE_INVALID',
        true
      );
    }

    const candidate = ParsedSaleDealSchema.safeParse({
      lawdCode: xmlField(item, ['sggCd', '지역코드']) ?? '',
      regionName: xmlField(item, ['umdNm', '법정동']) ?? '',
      contractDate: `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
      salePriceKrw: amountManwon * 10_000,
      areaM2,
      floor: numberField(xmlField(item, ['floor', '층'])),
      builtYear: numberField(xmlField(item, ['buildYear', '건축년도'])),
      complexName: xmlField(item, ['aptNm', 'offiNm', 'mhouseNm', 'houseType', '아파트', '단지', '연립다세대'])
    });
    if (!candidate.success) {
      throw new MolitSaleRequestError(
        'MOLIT sale API returned an unparseable transaction item',
        'API_RESPONSE_INVALID',
        true
      );
    }
    deals.push(candidate.data);
  }

  const totalCount = numberField(xmlField(xml, ['totalCount']));
  const rows = numberField(xmlField(xml, ['numOfRows']));
  return {
    deals,
    totalCount: totalCount !== undefined && Number.isInteger(totalCount) && totalCount >= 0 ? totalCount : undefined,
    rows: rows !== undefined && Number.isInteger(rows) && rows > 0 ? rows : undefined
  };
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(GENERIC_COMPLEX_TERMS, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function matchesComplex(requestedName: string, actualName: string | undefined): boolean {
  const requested = normalizeName(requestedName);
  const actual = actualName ? normalizeName(actualName) : '';
  if (!requested || !actual) return false;
  return actual === requested;
}

function filterDeals(
  input: SaleComparableSearchInput,
  deals: SaleDeal[]
): { deals: SaleDeal[]; filterStats: ComparableFilterStats } {
  const normalizeDong = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const afterLegalDong = input.legalDongName
    ? deals.filter((deal) => normalizeDong(deal.regionName) === normalizeDong(input.legalDongName ?? ''))
    : deals;
  const afterComplexName = input.complexName
    ? afterLegalDong.filter((deal) => matchesComplex(input.complexName ?? '', deal.complexName))
    : afterLegalDong;
  const tolerance = input.areaToleranceM2 ?? 5;
  const afterArea =
    input.areaM2 === undefined
      ? afterComplexName
      : afterComplexName.filter((deal) => Math.abs(deal.areaM2 - input.areaM2!) <= tolerance);
  return {
    deals: afterArea,
    filterStats: {
      raw: deals.length,
      afterContractType: deals.length,
      afterLegalDong: afterLegalDong.length,
      afterComplexName: afterComplexName.length,
      afterArea: afterArea.length
    }
  };
}

function noMatchReason(input: SaleComparableSearchInput, stats: ComparableFilterStats): ComparableReasonCode {
  if (stats.raw === 0) return 'NO_REPORTED_DEALS';
  if (input.legalDongName && stats.afterLegalDong === 0) return 'NO_LEGAL_DONG_MATCH';
  if (input.complexName && stats.afterComplexName === 0) return 'NO_COMPLEX_MATCH';
  if (input.areaM2 !== undefined && stats.afterArea === 0) return 'NO_AREA_MATCH';
  return 'NO_REPORTED_DEALS';
}

function nextActions(reasonCode: ComparableReasonCode, retryable = false): string[] {
  if (reasonCode === 'MATCHES_FOUND') return [];
  if (reasonCode === 'NO_COMPLEX_MATCH') return ['공식 건물명을 확인하고 매매 신고자료를 다시 조회하세요.'];
  if (reasonCode === 'NO_AREA_MATCH') return ['비슷한 면적의 매매 신고자료가 있는지 조회 범위를 확인하세요.'];
  if (reasonCode === 'NO_LEGAL_DONG_MATCH') return ['법정동이 정확한지 확인하세요.'];
  if (reasonCode === 'API_KEY_MISSING') return ['서비스 관리자에게 공공데이터 API 설정을 확인해 달라고 요청하세요.'];
  if (reasonCode === 'API_AUTH_ERROR') return ['해당 매매 API의 활용신청 승인 상태를 확인하세요.'];
  return retryable ? ['잠시 후 매매 신고자료를 다시 조회하세요.'] : ['조회 조건을 확인하세요.'];
}

export class LiveMolitSaleClient implements MolitSaleClient {
  private readonly timeoutMs: number;
  private readonly totalTimeoutMs: number;

  constructor(
    private readonly options: { apiKey: string; baseUrl: string; timeoutMs?: number; totalTimeoutMs?: number }
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  }

  private signal(deadlineAtMs: number): AbortSignal {
    const remainingMs = deadlineAtMs - Date.now();
    if (remainingMs <= 0) throw new MolitSaleRequestError('MOLIT sale lookup timed out', 'API_TIMEOUT', true);
    return AbortSignal.timeout(Math.max(1, Math.min(this.timeoutMs, remainingMs)));
  }

  private async fetchMonth(
    input: SaleComparableSearchInput,
    dealYmd: string,
    deadlineAtMs: number,
    targetLimit: number
  ): Promise<{ deals: SaleDeal[]; complete: boolean }> {
    const deals: SaleDeal[] = [];
    for (let pageNo = 1; pageNo <= MAX_PAGES_PER_MONTH; pageNo += 1) {
      const response = await fetch(buildUrl(this.options, input, dealYmd, pageNo), {
        headers: { Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8' },
        signal: this.signal(deadlineAtMs)
      });
      if (!response.ok) {
        const authError = response.status === 401 || response.status === 403;
        throw new MolitSaleRequestError(
          `MOLIT sale API request failed with status ${response.status}`,
          authError ? 'API_AUTH_ERROR' : 'API_HTTP_ERROR',
          !authError && (response.status === 408 || response.status === 429 || response.status >= 500)
        );
      }

      const page = parsePage(await response.text());
      deals.push(
        ...page.deals.map((deal, index) => ({
          ...deal,
          id: `live-sale-${input.housingType}-${input.lawdCode}-${dealYmd}-${pageNo}-${index}`,
          lawdCode: deal.lawdCode || input.lawdCode,
          housingType: input.housingType,
          source: 'live' as const
        }))
      );
      const pageSize = page.rows ?? (page.totalCount !== undefined && page.deals.length > 0 ? page.deals.length : PAGE_SIZE);
      const pageShouldContainData =
        page.totalCount !== undefined && (pageNo - 1) * pageSize < page.totalCount;
      if (page.deals.length === 0 && pageShouldContainData) {
        throw new MolitSaleRequestError(
          `MOLIT sale API returned an empty page before totalCount was exhausted for ${dealYmd}`,
          'API_RESPONSE_INVALID',
          true
        );
      }
      const reachedEnd =
        (page.totalCount !== undefined && pageNo * pageSize >= page.totalCount) ||
        (page.totalCount === undefined && page.deals.length === 0) ||
        (page.totalCount === undefined && page.deals.length < pageSize);
      if (reachedEnd) return { deals, complete: true };
      if (filterDeals(input, deals).deals.length >= targetLimit) return { deals, complete: false };
    }
    throw new MolitSaleRequestError('MOLIT sale pagination limit exceeded', 'API_RESPONSE_INVALID', true);
  }

  async searchSaleComparables(input: SaleComparableSearchInput): Promise<SaleComparableSearchResult> {
    assertValidDealYmdRange(input.dealYmdFrom, input.dealYmdTo);
    const limit = input.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new MolitSaleRequestError(`반환 건수는 1~${MAX_LIMIT}건이어야 합니다.`, 'INVALID_REQUEST', false);
    }

    const ownDeadline = Date.now() + this.totalTimeoutMs;
    const deadlineAtMs = Math.min(input.deadlineAtMs ?? ownDeadline, ownDeadline);
    const months = listMonths(input.dealYmdFrom, input.dealYmdTo).reverse();
    const parsedDeals: SaleDeal[] = [];
    let searchedMonthCount = 0;
    let complete = true;

    for (let index = 0; index < months.length; index += MONTH_CONCURRENCY) {
      if (Date.now() >= deadlineAtMs) {
        if (filterDeals(input, parsedDeals).deals.length === 0) {
          throw new MolitSaleRequestError('MOLIT sale lookup timed out', 'API_TIMEOUT', true);
        }
        complete = false;
        break;
      }
      const batch = months.slice(index, index + MONTH_CONCURRENCY);
      const settledResults = await Promise.allSettled(
        batch.map((dealYmd) => this.fetchMonth(input, dealYmd, deadlineAtMs, limit))
      );
      const results = settledResults
        .filter((result): result is PromiseFulfilledResult<{ deals: SaleDeal[]; complete: boolean }> =>
          result.status === 'fulfilled'
        )
        .map((result) => result.value);
      parsedDeals.push(...results.flatMap((result) => result.deals));
      searchedMonthCount += results.length;
      complete = complete && results.every((result) => result.complete);
      const rejection = settledResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (rejection) {
        const failure = classifyFailure(rejection.reason);
        if (failure.reasonCode === 'API_TIMEOUT' && filterDeals(input, parsedDeals).deals.length > 0) {
          complete = false;
          break;
        }
        throw rejection.reason;
      }
      if (filterDeals(input, parsedDeals).deals.length >= limit) {
        if (searchedMonthCount < months.length) complete = false;
        break;
      }
    }

    const filtered = filterDeals(input, parsedDeals);
    const allMatches = [...filtered.deals].sort((a, b) => b.contractDate.localeCompare(a.contractDate));
    const deals = allMatches.slice(0, limit);
    const searchComplete = complete && searchedMonthCount === months.length;
    const reasonCode = deals.length > 0 ? 'MATCHES_FOUND' : noMatchReason(input, filtered.filterStats);
    return {
      source: 'live',
      status: deals.length > 0 ? 'MATCHES_FOUND' : 'NO_MATCHES',
      reasonCode,
      retryable: false,
      filterStats: filtered.filterStats,
      nextActions: nextActions(reasonCode),
      searchComplete,
      requestedMonthCount: months.length,
      searchedMonthCount,
      dataNotice:
        deals.length > 0
          ? `국토교통부 매매 실거래가 Open API에서 법정동과 신고 건물·단지명이 일치하는 유사 면적 자료 ${deals.length}건을 확인했습니다.${searchComplete ? '' : ' 요청 기간 전체 검색은 완료되지 않았습니다.'}`
          : '국토교통부 매매 실거래가 Open API 조회는 완료됐지만 조건에 맞는 자료가 없습니다.',
      deals,
      totalMatched: allMatches.length,
      disclaimer: CONTRACT_CHECK_DISCLAIMER
    };
  }
}

function classifyFailure(error: unknown): { reasonCode: ComparableReasonCode; retryable: boolean } {
  if (error instanceof MolitSaleRequestError) return { reasonCode: error.reasonCode, retryable: error.retryable };
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { reasonCode: 'API_TIMEOUT', retryable: true };
  }
  if (error instanceof Error && (error.message.includes('YYYYMM') || error.message.includes('시작 월'))) {
    return { reasonCode: 'INVALID_REQUEST', retryable: false };
  }
  return { reasonCode: 'API_REQUEST_FAILED', retryable: true };
}

export class FallbackMolitSaleClient implements MolitSaleClient {
  private readonly liveClient?: LiveMolitSaleClient;

  constructor(options: { apiKey?: string; baseUrl?: string; timeoutMs?: number; totalTimeoutMs?: number }) {
    if (options.apiKey && options.baseUrl) {
      this.liveClient = new LiveMolitSaleClient({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
        totalTimeoutMs: options.totalTimeoutMs
      });
    }
  }

  async searchSaleComparables(input: SaleComparableSearchInput): Promise<SaleComparableSearchResult> {
    if (!this.liveClient) {
      return {
        source: 'unavailable',
        status: 'LIVE_DATA_UNAVAILABLE',
        reasonCode: 'API_KEY_MISSING',
        retryable: false,
        nextActions: nextActions('API_KEY_MISSING'),
        searchComplete: false,
        dataNotice: 'MOLIT_OPEN_DATA_API_KEY가 없어 매매 신고자료를 조회하지 못했습니다.',
        deals: [],
        totalMatched: 0,
        disclaimer: CONTRACT_CHECK_DISCLAIMER
      };
    }

    try {
      return await this.liveClient.searchSaleComparables(input);
    } catch (error) {
      const failure = classifyFailure(error);
      return {
        source: 'unavailable',
        status: failure.reasonCode === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'LIVE_DATA_UNAVAILABLE',
        reasonCode: failure.reasonCode,
        retryable: failure.retryable,
        nextActions: nextActions(failure.reasonCode, failure.retryable),
        searchComplete: false,
        dataNotice: `매매 신고자료 조회에 실패했습니다.${failure.retryable ? ' 잠시 후 다시 시도해 주세요.' : ''}`,
        deals: [],
        totalMatched: 0,
        disclaimer: CONTRACT_CHECK_DISCLAIMER
      };
    }
  }
}
