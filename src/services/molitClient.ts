import { z } from 'zod';
import { SEED_RENT_DEALS } from '../data/seedRentDeals.js';
import {
  CONTRACT_CHECK_DISCLAIMER,
  type ComparableSearchInput,
  type ComparableSearchResult,
  type RentDeal
} from '../domain/types.js';

export interface MolitRentClient {
  searchRentComparables(input: ComparableSearchInput): Promise<ComparableSearchResult>;
}

function isDealInYmdRange(deal: RentDeal, from: string, to: string): boolean {
  const ymd = deal.contractDate.replaceAll('-', '').slice(0, 6);
  return ymd >= from && ymd <= to;
}

function filterSeedDeals(input: ComparableSearchInput): RentDeal[] {
  const tolerance = input.areaToleranceM2 ?? 5;
  const normalizedComplex = input.complexName?.replace(/\s/g, '').toLowerCase();

  return SEED_RENT_DEALS.filter((deal) => {
    if (deal.lawdCode !== input.lawdCode) return false;
    if (deal.housingType !== input.housingType) return false;
    if (!isDealInYmdRange(deal, input.dealYmdFrom, input.dealYmdTo)) return false;
    if (input.areaM2 !== undefined && Math.abs(deal.areaM2 - input.areaM2) > tolerance) return false;
    if (normalizedComplex) {
      const dealComplex = deal.complexName?.replace(/\s/g, '').toLowerCase() ?? '';
      if (!dealComplex.includes(normalizedComplex)) return false;
    }
    return true;
  })
    .sort((a, b) => b.contractDate.localeCompare(a.contractDate))
    .slice(0, input.limit ?? 20);
}

export class SeedMolitRentClient implements MolitRentClient {
  async searchRentComparables(input: ComparableSearchInput): Promise<ComparableSearchResult> {
    const deals = filterSeedDeals(input);

    return {
      source: 'seed',
      requiresLiveData: true,
      dataNotice:
        'MOLIT_OPEN_DATA_API_KEY 또는 live API 연결이 없어 MVP seed data를 반환했습니다. 이 결과는 실시간 전월세 신고자료가 아닙니다.',
      deals,
      totalMatched: deals.length,
      disclaimer: CONTRACT_CHECK_DISCLAIMER
    };
  }
}

const HOUSING_TYPE_ENDPOINTS = {
  apartment: '/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
  officetel: '/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent',
  villa: '/RTMSDataSvcRHRent/getRTMSDataSvcRHRent',
  detachedMultiFamily: '/RTMSDataSvcSHRent/getRTMSDataSvcSHRent'
} as const;

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

function buildMolitUrl(options: { baseUrl: string; apiKey: string }, input: ComparableSearchInput, dealYmd: string): URL {
  const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
  const url = new URL(`${baseUrl}${HOUSING_TYPE_ENDPOINTS[input.housingType]}`);
  url.searchParams.set('serviceKey', options.apiKey);
  url.searchParams.set('LAWD_CD', input.lawdCode);
  url.searchParams.set('DEAL_YMD', dealYmd);
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('numOfRows', String(input.limit ?? 20));
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

function parseMolitXmlDeals(xml: string): Array<z.infer<typeof ParsedXmlDealSchema>> {
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  const parsedDeals: Array<z.infer<typeof ParsedXmlDealSchema>> = [];

  for (const match of itemMatches) {
    const itemXml = match[1] ?? '';
    const year = getXmlField(itemXml, ['년']);
    const month = getXmlField(itemXml, ['월']);
    const day = getXmlField(itemXml, ['일']);
    const depositManwon = parseNumberField(getXmlField(itemXml, ['보증금액', '보증금']));
    const monthlyRentManwon = parseNumberField(getXmlField(itemXml, ['월세금액', '월세']));
    const areaM2 = parseNumberField(getXmlField(itemXml, ['전용면적', '계약면적']));

    if (!year || !month || !day || depositManwon === undefined || monthlyRentManwon === undefined || areaM2 === undefined) {
      continue;
    }

    const candidate = {
      lawdCode: getXmlField(itemXml, ['지역코드']) ?? '',
      regionName: getXmlField(itemXml, ['법정동']) ?? '',
      contractDate: formatContractDate(year, month, day),
      depositKrw: depositManwon * 10_000,
      monthlyRentKrw: monthlyRentManwon * 10_000,
      areaM2,
      floor: parseNumberField(getXmlField(itemXml, ['층'])),
      builtYear: parseNumberField(getXmlField(itemXml, ['건축년도'])),
      complexName: getXmlField(itemXml, ['아파트', '단지', '연립다세대', '단독다가구'])
    };

    const validated = ParsedXmlDealSchema.safeParse(candidate);
    if (validated.success) parsedDeals.push(validated.data);
  }

  return parsedDeals;
}

function filterLiveDeals(input: ComparableSearchInput, deals: RentDeal[]): RentDeal[] {
  const tolerance = input.areaToleranceM2 ?? 5;
  const normalizedComplex = input.complexName?.replace(/\s/g, '').toLowerCase();

  return deals.filter((deal) => {
    if (input.areaM2 !== undefined && Math.abs(deal.areaM2 - input.areaM2) > tolerance) return false;
    if (normalizedComplex) {
      const dealComplex = deal.complexName?.replace(/\s/g, '').toLowerCase() ?? '';
      if (!dealComplex.includes(normalizedComplex)) return false;
    }
    return true;
  });
}

export class LiveMolitRentClient implements MolitRentClient {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
    }
  ) {}

  async searchRentComparables(input: ComparableSearchInput): Promise<ComparableSearchResult> {
    const parsedDeals: RentDeal[] = [];
    const months = listDealYmdMonths(input.dealYmdFrom, input.dealYmdTo);

    for (const dealYmd of months) {
      const url = buildMolitUrl(this.options, input, dealYmd);
      const response = await fetch(url, { headers: { Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8' } });
      if (!response.ok) {
        throw new Error(`MOLIT API request failed with status ${response.status}`);
      }

      const xml = await response.text();
      const monthlyDeals = parseMolitXmlDeals(xml);
      parsedDeals.push(
        ...monthlyDeals.map(
          (deal, index): RentDeal => ({
            ...deal,
            id: `live-${input.housingType}-${input.lawdCode}-${dealYmd}-${index}`,
            lawdCode: deal.lawdCode || input.lawdCode,
            housingType: input.housingType,
            contractType: deal.monthlyRentKrw > 0 ? 'wolse' : 'jeonse',
            source: 'live',
            sourceNotice: 'MOLIT_OPEN_DATA_API_KEY를 사용해 live API에서 조회한 결과입니다.'
          })
        )
      );
    }

    const deals = filterLiveDeals(input, parsedDeals).sort((a, b) => b.contractDate.localeCompare(a.contractDate));

    return {
      source: 'live',
      requiresLiveData: false,
      dataNotice: '국토교통부 Open API XML 응답에서 지원 필드를 검증한 뒤 반환했습니다.',
      deals: deals.slice(0, input.limit ?? 20),
      totalMatched: deals.length,
      disclaimer: CONTRACT_CHECK_DISCLAIMER
    };
  }
}

export class FallbackMolitRentClient implements MolitRentClient {
  private readonly seedClient = new SeedMolitRentClient();
  private readonly liveClient?: LiveMolitRentClient;

  constructor(options: { apiKey?: string; baseUrl?: string }) {
    if (options.apiKey && options.baseUrl) {
      this.liveClient = new LiveMolitRentClient({ apiKey: options.apiKey, baseUrl: options.baseUrl });
    }
  }

  async searchRentComparables(input: ComparableSearchInput): Promise<ComparableSearchResult> {
    if (!this.liveClient) {
      return this.seedClient.searchRentComparables(input);
    }

    try {
      return await this.liveClient.searchRentComparables(input);
    } catch {
      const fallback = await this.seedClient.searchRentComparables(input);
      return {
        ...fallback,
        dataNotice:
          'live API 조회가 실패해 MVP seed data를 반환했습니다. 이 결과는 실시간 전월세 신고자료가 아닙니다.'
      };
    }
  }
}
