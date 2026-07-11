import { z } from 'zod';
import {
  CONTRACT_CHECK_DISCLAIMER,
  type ComparableSearchInput,
  type ComparableSearchResult,
  type RentDeal
} from '../domain/types.js';
import { assertValidDealYmdRange } from '../utils/date.js';

export interface MolitRentClient {
  searchRentComparables(input: ComparableSearchInput): Promise<ComparableSearchResult>;
}

function unavailableResult(message: string): ComparableSearchResult {
  return {
    source: 'unavailable',
    requiresLiveData: true,
    dataNotice: message,
    deals: [],
    totalMatched: 0,
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
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
const DEFAULT_MOLIT_REQUEST_TIMEOUT_MS = 5000;

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
    throw new Error('MOLIT API returned an invalid XML response');
  }

  const resultCode = getXmlField(xml, ['resultCode']);
  if (!resultCode || resultCode === '000') return;

  const resultMsg = getXmlField(xml, ['resultMsg']);
  throw new Error(`MOLIT API returned resultCode ${resultCode}${resultMsg ? `: ${resultMsg}` : ''}`);
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

  return actual.includes(requested);
}

function filterLiveDeals(input: ComparableSearchInput, deals: RentDeal[]): RentDeal[] {
  const tolerance = input.areaToleranceM2 ?? 5;

  return deals.filter((deal) => {
    if (input.contractType && deal.contractType !== input.contractType) return false;
    if (input.areaM2 !== undefined && Math.abs(deal.areaM2 - input.areaM2) > tolerance) return false;
    if (input.complexName && !matchesComplexName(input.complexName, deal.complexName)) return false;
    return true;
  });
}

export class LiveMolitRentClient implements MolitRentClient {
  private readonly timeoutMs: number;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      timeoutMs?: number;
    }
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MOLIT_REQUEST_TIMEOUT_MS;
  }

  private async fetchMonthDeals(input: ComparableSearchInput, dealYmd: string): Promise<RentDeal[]> {
    const monthlyDeals: RentDeal[] = [];

    for (let pageNo = 1; pageNo <= MAX_MOLIT_PAGES_PER_MONTH; pageNo += 1) {
      const url = buildMolitUrl(this.options, input, dealYmd, pageNo);
      const response = await fetch(url, {
        headers: { Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8' },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) {
        throw new Error(`MOLIT API request failed with status ${response.status}`);
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
            source: 'live',
            sourceNotice: 'MOLIT_OPEN_DATA_API_KEY를 사용해 live API에서 조회한 결과입니다.'
          })
        )
      );

      const effectivePageSize =
        page.numOfRows ?? (page.totalCount !== undefined && page.deals.length > 0 ? page.deals.length : MOLIT_PAGE_SIZE);
      const reachedReportedEnd = page.totalCount !== undefined && pageNo * effectivePageSize >= page.totalCount;
      const hasReportedMore = page.totalCount !== undefined && pageNo * effectivePageSize < page.totalCount;
      if (page.deals.length === 0 && hasReportedMore) {
        throw new Error(`MOLIT API returned an empty page before totalCount was exhausted for ${dealYmd}`);
      }
      const reachedObservedEnd = page.deals.length === 0 || (page.totalCount === undefined && page.deals.length < effectivePageSize);

      if (reachedReportedEnd || reachedObservedEnd) return monthlyDeals;
    }

    throw new Error(`MOLIT API pagination exceeded ${MAX_MOLIT_PAGES_PER_MONTH} pages for ${dealYmd}`);
  }

  async searchRentComparables(input: ComparableSearchInput): Promise<ComparableSearchResult> {
    assertValidDealYmdRange(input.dealYmdFrom, input.dealYmdTo);
    const parsedDeals: RentDeal[] = [];
    const months = listDealYmdMonths(input.dealYmdFrom, input.dealYmdTo).reverse();
    const requestedLimit = input.limit ?? 20;
    let searchedMonthCount = 0;

    for (let index = 0; index < months.length; index += MOLIT_MONTH_CONCURRENCY) {
      const monthBatch = months.slice(index, index + MOLIT_MONTH_CONCURRENCY);
      const batchDeals = await Promise.all(monthBatch.map((dealYmd) => this.fetchMonthDeals(input, dealYmd)));
      parsedDeals.push(...batchDeals.flat());
      searchedMonthCount += monthBatch.length;

      if (filterLiveDeals(input, parsedDeals).length >= requestedLimit) break;
    }

    const deals = filterLiveDeals(input, parsedDeals).sort((a, b) => b.contractDate.localeCompare(a.contractDate));
    const limitedDeals = deals.slice(0, requestedLimit);
    const searchComplete = searchedMonthCount === months.length;

    return {
      source: 'live',
      requiresLiveData: false,
      searchComplete,
      requestedMonthCount: months.length,
      searchedMonthCount,
      dataNotice:
        limitedDeals.length > 0
          ? searchComplete
            ? '국토교통부 Open API의 요청 기간 전체 페이지를 조회하고 지원 필드와 검색 조건을 검증한 뒤 반환했습니다.'
            : `국토교통부 Open API를 최신 월부터 ${searchedMonthCount}/${months.length}개월 조회해 최근 ${limitedDeals.length}건을 반환했습니다. 요청 기간 전체 건수는 아닙니다.`
          : '국토교통부 Open API의 월별 전체 페이지 조회는 성공했지만 입력 조건에 맞는 유사 신고자료가 없습니다. 법정동, 기간, 면적 또는 단지명 조건을 넓혀 다시 확인해 주세요.',
      deals: limitedDeals,
      totalMatched: deals.length,
      disclaimer: CONTRACT_CHECK_DISCLAIMER
    };
  }
}

export class FallbackMolitRentClient implements MolitRentClient {
  private readonly liveClient?: LiveMolitRentClient;

  constructor(options: { apiKey?: string; baseUrl?: string; timeoutMs?: number }) {
    if (options.apiKey && options.baseUrl) {
      this.liveClient = new LiveMolitRentClient({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs
      });
    }
  }

  async searchRentComparables(input: ComparableSearchInput): Promise<ComparableSearchResult> {
    if (!this.liveClient) {
      return unavailableResult(
        'MOLIT_OPEN_DATA_API_KEY가 없어 실시간 신고자료를 조회할 수 없습니다. 지금은 비교에 필요한 정보가 부족합니다.'
      );
    }

    try {
      return await this.liveClient.searchRentComparables(input);
    } catch (error) {
      const failureReason = error instanceof Error && error.message ? ` 실패 사유: ${error.message}` : '';
      return unavailableResult(
        `공공데이터 조회가 실패했습니다.${failureReason} 지금은 비교에 필요한 정보가 부족합니다. 잠시 후 다시 시도해 주세요.`
      );
    }
  }
}
