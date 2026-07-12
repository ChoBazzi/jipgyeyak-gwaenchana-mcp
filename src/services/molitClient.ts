import { z } from 'zod';
import {
  CONTRACT_CHECK_DISCLAIMER,
  type ComparableFilterStats,
  type ComparableReasonCode,
  type ComparableSearchInput,
  type ComparableSearchResult,
  type RentDeal,
  type SaleComparableSearchInput,
  type SaleComparableSearchResult
} from '../domain/types.js';
import { assertValidDealYmdRange } from '../utils/date.js';
import { FallbackMolitSaleClient } from './molitSaleClient.js';

export interface MolitRentClient {
  searchRentComparables(input: ComparableSearchInput): Promise<ComparableSearchResult>;
  searchSaleComparables?(input: SaleComparableSearchInput): Promise<SaleComparableSearchResult>;
}

interface MolitFailure {
  reasonCode: ComparableReasonCode;
  retryable: boolean;
}

class MolitRequestError extends Error {
  constructor(
    message: string,
    readonly reasonCode: ComparableReasonCode,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'MolitRequestError';
  }
}

function unavailableResult(options: MolitFailure & { message: string; nextActions: string[] }): ComparableSearchResult {
  return {
    source: 'unavailable',
    requiresLiveData: true,
    status: options.reasonCode === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'LIVE_DATA_UNAVAILABLE',
    reasonCode: options.reasonCode,
    retryable: options.retryable,
    nextActions: options.nextActions,
    dataNotice: options.message,
    deals: [],
    totalMatched: 0,
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
}

function classifyMolitFailure(error: unknown): MolitFailure {
  if (error instanceof MolitRequestError) {
    return { reasonCode: error.reasonCode, retryable: error.retryable };
  }

  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return { reasonCode: 'API_TIMEOUT', retryable: true };
    }

    if (error.message.includes('YYYYMM') || error.message.includes('시작 월')) {
      return { reasonCode: 'INVALID_REQUEST', retryable: false };
    }
  }

  return { reasonCode: 'API_REQUEST_FAILED', retryable: true };
}

function unavailableNextActions(reasonCode: ComparableReasonCode, retryable: boolean): string[] {
  switch (reasonCode) {
    case 'API_KEY_MISSING':
      return ['서비스 관리자에게 공공데이터 API 설정을 확인해 달라고 요청하세요.'];
    case 'API_AUTH_ERROR':
      return ['공공데이터 API 키의 활용신청 승인 상태와 호출 권한을 확인하세요.'];
    case 'INVALID_REQUEST':
      return ['조회 기간과 입력 조건을 확인한 뒤 다시 요청하세요.'];
    default:
      return retryable
        ? ['잠시 후 다시 시도하세요.']
        : ['서비스 관리자에게 공공데이터 요청 설정과 응답 상태를 확인해 달라고 요청하세요.'];
  }
}

const HOUSING_TYPE_ENDPOINTS = {
  apartment: '/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
  officetel: '/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent',
  villa: '/RTMSDataSvcRHRent/getRTMSDataSvcRHRent',
  detachedMultiFamily: '/RTMSDataSvcSHRent/getRTMSDataSvcSHRent'
} as const;

const MOLIT_PAGE_SIZE = 1000;
const MAX_MOLIT_PAGES_PER_MONTH = 20;
const MOLIT_MONTH_CONCURRENCY = 3;
const MAX_COMPARABLE_LIMIT = 20;
const DEFAULT_MOLIT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_MOLIT_TOTAL_TIMEOUT_MS = 5000;

const ParsedXmlDealSchema = z.object({
  lawdCode: z.string(),
  regionName: z.string(),
  contractDate: z.string(),
  depositKrw: z.number(),
  monthlyRentKrw: z.number(),
  areaM2: z.number(),
  floor: z.number().optional(),
  builtYear: z.number().optional(),
  complexName: z.string().optional()
});

function listDealYmdMonths(from: string, to: string): string[] {
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

function buildMolitUrl(
  options: { baseUrl: string; apiKey: string },
  input: ComparableSearchInput,
  dealYmd: string,
  pageNo: number
): URL {
  const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
  const url = new URL(`${baseUrl}${HOUSING_TYPE_ENDPOINTS[input.housingType]}`);
  url.searchParams.set('serviceKey', options.apiKey);
  url.searchParams.set('LAWD_CD', input.lawdCode);
  url.searchParams.set('DEAL_YMD', dealYmd);
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(MOLIT_PAGE_SIZE));
  return url;
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
}

function getXmlField(itemXml: string, names: string[]): string | undefined {
  for (const name of names) {
    const match = itemXml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    const value = match?.[1] ? decodeXmlEntities(stripCdata(match[1]).trim()) : undefined;
    if (value) return value;
  }
  return undefined;
}

function parseNumberField(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replaceAll(',', '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatContractDate(year: string, month: string, day: string): string {
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function assertMolitXmlSuccess(xml: string): void {
  if (!/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<response(?:\s|>)/i.test(xml)) {
    throw new MolitRequestError('MOLIT API returned an invalid XML response', 'API_RESPONSE_INVALID', true);
  }

  const resultCode = getXmlField(xml, ['resultCode']);
  if (!resultCode || resultCode === '000' || resultCode === '03') return;

  const resultMsg = getXmlField(xml, ['resultMsg']);
  const message = `MOLIT API returned resultCode ${resultCode}${resultMsg ? `: ${resultMsg}` : ''}`;
  const isAuthError = ['20', '21', '22', '30', '31'].includes(resultCode);
  throw new MolitRequestError(message, isAuthError ? 'API_AUTH_ERROR' : 'API_RESPONSE_INVALID', !isAuthError);
}

function parseMolitXmlDeals(xml: string): Array<z.infer<typeof ParsedXmlDealSchema>> {
  assertMolitXmlSuccess(xml);

  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  const parsedDeals: Array<z.infer<typeof ParsedXmlDealSchema>> = [];

  for (const match of itemMatches) {
    const itemXml = match[1] ?? '';
    const year = getXmlField(itemXml, ['dealYear', '년']);
    const month = getXmlField(itemXml, ['dealMonth', '월']);
    const day = getXmlField(itemXml, ['dealDay', '일']);
    const depositManwon = parseNumberField(getXmlField(itemXml, ['deposit', '보증금액', '보증금']));
    const monthlyRentManwon = parseNumberField(getXmlField(itemXml, ['monthlyRent', '월세금액', '월세']));
    const areaM2 = parseNumberField(getXmlField(itemXml, ['excluUseAr', 'totalFloorAr', '전용면적', '계약면적']));

    if (!year || !month || !day || depositManwon === undefined || monthlyRentManwon === undefined || areaM2 === undefined) {
      continue;
    }

    const candidate = {
      lawdCode: getXmlField(itemXml, ['sggCd', '지역코드']) ?? '',
      regionName: getXmlField(itemXml, ['umdNm', '법정동']) ?? '',
      contractDate: formatContractDate(year, month, day),
      depositKrw: depositManwon * 10_000,
      monthlyRentKrw: monthlyRentManwon * 10_000,
      areaM2,
      floor: parseNumberField(getXmlField(itemXml, ['floor', '층'])),
      builtYear: parseNumberField(getXmlField(itemXml, ['buildYear', '건축년도'])),
      complexName: getXmlField(itemXml, ['aptNm', 'offiNm', 'mhouseNm', 'houseType', '아파트', '단지', '연립다세대', '단독다가구'])
    };

    const validated = ParsedXmlDealSchema.safeParse(candidate);
    if (validated.success) parsedDeals.push(validated.data);
  }

  return parsedDeals;
}

function parsePositiveIntegerField(xml: string, name: string): number | undefined {
  const value = parseNumberField(getXmlField(xml, [name]));
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseNonNegativeIntegerField(xml: string, name: string): number | undefined {
  const value = parseNumberField(getXmlField(xml, [name]));
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseMolitXmlPage(xml: string): {
  deals: Array<z.infer<typeof ParsedXmlDealSchema>>;
  totalCount?: number;
  numOfRows?: number;
} {
  return {
    deals: parseMolitXmlDeals(xml),
    totalCount: parseNonNegativeIntegerField(xml, 'totalCount'),
    numOfRows: parsePositiveIntegerField(xml, 'numOfRows')
  };
}

const GENERIC_COMPLEX_NAME_TERMS = /아파트|오피스텔|주상복합|연립주택|다세대주택|단독주택|다가구주택|빌라/gu;

function normalizeComplexName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(GENERIC_COMPLEX_NAME_TERMS, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function matchesComplexName(requestedName: string, actualName: string | undefined): boolean {
  const requested = normalizeComplexName(requestedName);
  if (!requested) return true;

  const actual = actualName ? normalizeComplexName(actualName) : '';
  if (!actual) return false;

  return actual === requested;
}

function normalizeLegalDongName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '').trim();
}

function filterLiveDeals(
  input: ComparableSearchInput,
  deals: RentDeal[]
): { deals: RentDeal[]; filterStats: ComparableFilterStats } {
  const tolerance = input.areaToleranceM2 ?? 5;
  const afterContractType = input.contractType
    ? deals.filter((deal) => deal.contractType === input.contractType)
    : deals;
  const afterLegalDong = input.legalDongName
    ? afterContractType.filter(
        (deal) => normalizeLegalDongName(deal.regionName) === normalizeLegalDongName(input.legalDongName ?? '')
      )
    : afterContractType;
  const afterComplexName = input.complexName
    ? afterLegalDong.filter((deal) => matchesComplexName(input.complexName ?? '', deal.complexName))
    : afterLegalDong;
  const afterArea =
    input.areaM2 !== undefined
      ? afterComplexName.filter((deal) => Math.abs(deal.areaM2 - input.areaM2!) <= tolerance)
      : afterComplexName;

  return {
    deals: afterArea,
    filterStats: {
      raw: deals.length,
      afterContractType: afterContractType.length,
      afterLegalDong: afterLegalDong.length,
      afterComplexName: afterComplexName.length,
      afterArea: afterArea.length
    }
  };
}

function noMatchReason(input: ComparableSearchInput, stats: ComparableFilterStats): ComparableReasonCode {
  if (stats.raw === 0) return 'NO_REPORTED_DEALS';
  if (input.contractType && stats.afterContractType === 0) return 'NO_CONTRACT_TYPE_MATCH';
  if (input.legalDongName && stats.afterLegalDong === 0) return 'NO_LEGAL_DONG_MATCH';
  if (input.complexName && stats.afterComplexName === 0) return 'NO_COMPLEX_MATCH';
  if (input.areaM2 !== undefined && stats.afterArea === 0) return 'NO_AREA_MATCH';
  return 'NO_REPORTED_DEALS';
}

function noMatchNextActions(reasonCode: ComparableReasonCode): string[] {
  switch (reasonCode) {
    case 'NO_CONTRACT_TYPE_MATCH':
      return ['전세 또는 월세 조건이 맞는지 확인해 다시 조회하세요.'];
    case 'NO_LEGAL_DONG_MATCH':
      return ['법정동이 정확한지 확인하거나 도로명·지번주소를 더 구체적으로 입력하세요.'];
    case 'NO_COMPLEX_MATCH':
      return ['단지명을 빼거나 공식 단지명으로 바꿔 다시 조회하세요.'];
    case 'NO_AREA_MATCH':
      return ['면적 허용 범위를 넓혀 다시 조회하세요.'];
    default:
      return ['조회 기간을 넓혀 다시 조회하세요.'];
  }
}

function noMatchNotice(reasonCode: ComparableReasonCode, stats: ComparableFilterStats): string {
  switch (reasonCode) {
    case 'NO_CONTRACT_TYPE_MATCH':
      return `국토교통부 Open API 조회는 성공했고 신고자료 ${stats.raw}건을 확인했지만 요청한 전세/월세 유형과 일치하는 자료가 없습니다.`;
    case 'NO_LEGAL_DONG_MATCH':
      return `국토교통부 Open API 조회는 성공했고 계약 유형에 맞는 자료 ${stats.afterContractType}건을 확인했지만 요청한 법정동과 일치하는 자료가 없습니다.`;
    case 'NO_COMPLEX_MATCH':
      return `국토교통부 Open API 조회는 성공했고 계약 유형에 맞는 자료 ${stats.afterContractType}건을 확인했지만 요청한 단지명과 일치하는 자료가 없습니다.`;
    case 'NO_AREA_MATCH':
      return `국토교통부 Open API 조회는 성공했고 단지명 조건까지 맞는 자료 ${stats.afterComplexName}건을 확인했지만 요청 면적 범위와 일치하는 자료가 없습니다.`;
    default:
      return '국토교통부 Open API의 월별 전체 페이지 조회는 성공했지만 조회 기간과 지역에 신고된 거래자료가 없습니다.';
  }
}

export class LiveMolitRentClient implements MolitRentClient {
  private readonly timeoutMs: number;
  private readonly totalTimeoutMs: number;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      timeoutMs?: number;
      totalTimeoutMs?: number;
    }
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MOLIT_REQUEST_TIMEOUT_MS;
    this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_MOLIT_TOTAL_TIMEOUT_MS;
  }

  private requestSignal(deadlineAtMs: number): AbortSignal {
    const remainingMs = deadlineAtMs - Date.now();
    if (remainingMs <= 0) {
      throw new MolitRequestError('MOLIT API lookup exceeded its overall deadline', 'API_TIMEOUT', true);
    }

    return AbortSignal.timeout(Math.max(1, Math.min(this.timeoutMs, remainingMs)));
  }

  private async fetchMonthDeals(
    input: ComparableSearchInput,
    dealYmd: string,
    deadlineAtMs: number,
    targetLimit: number
  ): Promise<{ deals: RentDeal[]; complete: boolean }> {
    const monthlyDeals: RentDeal[] = [];

    for (let pageNo = 1; pageNo <= MAX_MOLIT_PAGES_PER_MONTH; pageNo += 1) {
      const url = buildMolitUrl(this.options, input, dealYmd, pageNo);
      const response = await fetch(url, {
        headers: { Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8' },
        signal: this.requestSignal(deadlineAtMs)
      });
      if (!response.ok) {
        const isAuthError = response.status === 401 || response.status === 403;
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new MolitRequestError(
          `MOLIT API request failed with status ${response.status}`,
          isAuthError ? 'API_AUTH_ERROR' : 'API_HTTP_ERROR',
          isAuthError ? false : retryable
        );
      }

      const page = parseMolitXmlPage(await response.text());
      monthlyDeals.push(
        ...page.deals.map(
          (deal, index): RentDeal => ({
            ...deal,
            id: `live-${input.housingType}-${input.lawdCode}-${dealYmd}-${pageNo}-${index}`,
            lawdCode: deal.lawdCode || input.lawdCode,
            housingType: input.housingType,
            contractType: deal.monthlyRentKrw > 0 ? 'wolse' : 'jeonse',
            source: 'live'
          })
        )
      );

      const effectivePageSize =
        page.numOfRows ?? (page.totalCount !== undefined && page.deals.length > 0 ? page.deals.length : MOLIT_PAGE_SIZE);
      const reachedReportedEnd = page.totalCount !== undefined && pageNo * effectivePageSize >= page.totalCount;
      const hasReportedMore = page.totalCount !== undefined && pageNo * effectivePageSize < page.totalCount;
      if (page.deals.length === 0 && hasReportedMore) {
        throw new MolitRequestError(
          `MOLIT API returned an empty page before totalCount was exhausted for ${dealYmd}`,
          'API_RESPONSE_INVALID',
          true
        );
      }
      const reachedObservedEnd = page.deals.length === 0 || (page.totalCount === undefined && page.deals.length < effectivePageSize);

      if (reachedReportedEnd || reachedObservedEnd) return { deals: monthlyDeals, complete: true };
      if (filterLiveDeals(input, monthlyDeals).deals.length >= targetLimit) {
        return { deals: monthlyDeals, complete: false };
      }
    }

    throw new MolitRequestError(
      `MOLIT API pagination exceeded ${MAX_MOLIT_PAGES_PER_MONTH} pages for ${dealYmd}`,
      'API_RESPONSE_INVALID',
      true
    );
  }

  async searchRentComparables(input: ComparableSearchInput): Promise<ComparableSearchResult> {
    assertValidDealYmdRange(input.dealYmdFrom, input.dealYmdTo);
    const requestedLimit = input.limit ?? 20;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_COMPARABLE_LIMIT) {
      throw new MolitRequestError(`반환 건수는 1~${MAX_COMPARABLE_LIMIT}건이어야 합니다.`, 'INVALID_REQUEST', false);
    }

    const ownDeadlineAtMs = Date.now() + this.totalTimeoutMs;
    const deadlineAtMs = Math.min(input.deadlineAtMs ?? ownDeadlineAtMs, ownDeadlineAtMs);
    const parsedDeals: RentDeal[] = [];
    const months = listDealYmdMonths(input.dealYmdFrom, input.dealYmdTo).reverse();
    let searchedMonthCount = 0;
    let allSearchedMonthsComplete = true;

    let index = 0;
    while (index < months.length) {
      if (Date.now() >= deadlineAtMs) {
        if (filterLiveDeals(input, parsedDeals).deals.length > 0) {
          allSearchedMonthsComplete = false;
          break;
        }
        throw new MolitRequestError('MOLIT API lookup exceeded its overall deadline', 'API_TIMEOUT', true);
      }
      const matchesBeforeBatch = filterLiveDeals(input, parsedDeals).deals.length;
      const batchSize =
        index === 0 || matchesBeforeBatch >= Math.ceil(requestedLimit / 2) ? 1 : MOLIT_MONTH_CONCURRENCY;
      const monthBatch = months.slice(index, index + batchSize);
      const targetLimit = Math.max(1, requestedLimit - matchesBeforeBatch);
      const settledResults = await Promise.allSettled(
        monthBatch.map((dealYmd) => this.fetchMonthDeals(input, dealYmd, deadlineAtMs, targetLimit))
      );
      const batchResults = settledResults
        .filter((result): result is PromiseFulfilledResult<{ deals: RentDeal[]; complete: boolean }> =>
          result.status === 'fulfilled'
        )
        .map((result) => result.value);
      parsedDeals.push(...batchResults.flatMap((result) => result.deals));
      allSearchedMonthsComplete =
        allSearchedMonthsComplete && batchResults.every((result) => result.complete);
      searchedMonthCount += batchResults.length;
      index += monthBatch.length;

      const rejection = settledResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (rejection) {
        const failure = classifyMolitFailure(rejection.reason);
        if (failure.reasonCode === 'API_TIMEOUT' && filterLiveDeals(input, parsedDeals).deals.length > 0) {
          allSearchedMonthsComplete = false;
          break;
        }
        throw rejection.reason;
      }

      if (filterLiveDeals(input, parsedDeals).deals.length >= requestedLimit) break;
    }

    const filtered = filterLiveDeals(input, parsedDeals);
    const deals = [...filtered.deals].sort((a, b) => b.contractDate.localeCompare(a.contractDate));
    const limitedDeals = deals.slice(0, requestedLimit);
    const searchComplete = searchedMonthCount === months.length && allSearchedMonthsComplete;
    const reasonCode = limitedDeals.length > 0 ? 'MATCHES_FOUND' : noMatchReason(input, filtered.filterStats);

    return {
      source: 'live',
      requiresLiveData: false,
      status: limitedDeals.length > 0 ? 'MATCHES_FOUND' : 'NO_MATCHES',
      reasonCode,
      retryable: false,
      filterStats: filtered.filterStats,
      nextActions: limitedDeals.length > 0 ? [] : noMatchNextActions(reasonCode),
      searchComplete,
      requestedMonthCount: months.length,
      searchedMonthCount,
      dataNotice:
        limitedDeals.length > 0
          ? searchComplete
            ? '국토교통부 Open API의 요청 기간 전체 페이지를 조회하고 지원 필드와 검색 조건을 검증한 뒤 반환했습니다.'
            : `국토교통부 Open API를 최신 월부터 ${searchedMonthCount}/${months.length}개월 조회해 최근 ${limitedDeals.length}건을 반환했습니다. 요청 기간 전체 건수는 아닙니다.`
          : noMatchNotice(reasonCode, filtered.filterStats),
      deals: limitedDeals,
      totalMatched: deals.length,
      disclaimer: CONTRACT_CHECK_DISCLAIMER
    };
  }
}

export class FallbackMolitRentClient implements MolitRentClient {
  private readonly liveClient?: LiveMolitRentClient;
  private readonly saleClient: FallbackMolitSaleClient;

  constructor(options: { apiKey?: string; baseUrl?: string; timeoutMs?: number; totalTimeoutMs?: number }) {
    this.saleClient = new FallbackMolitSaleClient(options);
    if (options.apiKey && options.baseUrl) {
      this.liveClient = new LiveMolitRentClient({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
        totalTimeoutMs: options.totalTimeoutMs
      });
    }
  }

  async searchSaleComparables(input: SaleComparableSearchInput): Promise<SaleComparableSearchResult> {
    return this.saleClient.searchSaleComparables(input);
  }

  async searchRentComparables(input: ComparableSearchInput): Promise<ComparableSearchResult> {
    if (!this.liveClient) {
      const reasonCode = 'API_KEY_MISSING';
      return unavailableResult({
        reasonCode,
        retryable: false,
        nextActions: unavailableNextActions(reasonCode, false),
        message:
          'MOLIT_OPEN_DATA_API_KEY가 없어 공공데이터 API 신고자료를 조회할 수 없습니다. 지금은 비교에 필요한 정보가 부족합니다.'
      });
    }

    try {
      return await this.liveClient.searchRentComparables(input);
    } catch (error) {
      const failure = classifyMolitFailure(error);
      const failureReason = error instanceof Error && error.message ? ` 실패 사유: ${error.message}` : '';
      return unavailableResult({
        ...failure,
        nextActions: unavailableNextActions(failure.reasonCode, failure.retryable),
        message: `공공데이터 조회가 실패했습니다.${failureReason} 지금은 비교에 필요한 정보가 부족합니다.${failure.retryable ? ' 잠시 후 다시 시도해 주세요.' : ''}`
      });
    }
  }
}
