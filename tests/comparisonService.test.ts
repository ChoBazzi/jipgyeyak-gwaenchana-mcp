import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComparableSearchResult, RentDeal } from '../src/domain/types.js';
import { compareContractTerms } from '../src/services/comparisonService.js';
import type { MolitRentClient } from '../src/services/molitClient.js';

const originalFetch = globalThis.fetch;
const originalJusoApiKey = process.env.JUSO_API_KEY;
const originalJusoApiBaseUrl = process.env.JUSO_API_BASE_URL;

const liveDeals: RentDeal[] = [
  {
    id: 'live-1',
    lawdCode: '11680',
    regionName: '역삼동',
    housingType: 'apartment',
    contractDate: '2026-07-03',
    contractType: 'wolse',
    depositKrw: 280000000,
    monthlyRentKrw: 1900000,
    areaM2: 59.84,
    floor: 9,
    builtYear: 2018,
    complexName: '역삼센트럴',
    source: 'live',
    sourceNotice: 'live test fixture'
  },
  {
    id: 'live-2',
    lawdCode: '11680',
    regionName: '역삼동',
    housingType: 'apartment',
    contractDate: '2026-07-05',
    contractType: 'wolse',
    depositKrw: 300000000,
    monthlyRentKrw: 2050000,
    areaM2: 60.1,
    floor: 11,
    builtYear: 2018,
    complexName: '역삼센트럴',
    source: 'live',
    sourceNotice: 'live test fixture'
  }
];

function mockRentClient(result: ComparableSearchResult): MolitRentClient {
  return {
    async searchRentComparables() {
      return result;
    }
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  if (originalJusoApiKey === undefined) {
    delete process.env.JUSO_API_KEY;
  } else {
    process.env.JUSO_API_KEY = originalJusoApiKey;
  }
  if (originalJusoApiBaseUrl === undefined) {
    delete process.env.JUSO_API_BASE_URL;
  } else {
    process.env.JUSO_API_BASE_URL = originalJusoApiBaseUrl;
  }
});

describe('compareContractTerms', () => {
  it('passes the inferred contract type to the comparable search', async () => {
    delete process.env.JUSO_API_KEY;
    const searchedContractTypes: Array<string | undefined> = [];
    const rentClient: MolitRentClient = {
      async searchRentComparables(input) {
        searchedContractTypes.push(input.contractType);
        return {
          source: 'live',
          requiresLiveData: false,
          dataNotice: '조회 완료',
          deals: [],
          totalMatched: 0,
          disclaimer: 'test disclaimer'
        };
      }
    };

    await compareContractTerms(
      {
        address: '서울특별시 강남구 대치동',
        housingType: 'apartment',
        depositKrw: 1_000_000_000,
        monthlyRentKrw: 0,
        areaM2: 76
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );
    await compareContractTerms(
      {
        address: '서울특별시 강남구 대치동',
        housingType: 'apartment',
        depositKrw: 100_000_000,
        monthlyRentKrw: 3_000_000,
        areaM2: 76
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(searchedContractTypes).toEqual(['jeonse', 'wolse']);
  });

  it('distinguishes an unavailable API from a successful search with no matches', async () => {
    delete process.env.JUSO_API_KEY;
    const input = {
      address: '서울특별시 강남구 대치동',
      housingType: 'apartment' as const,
      depositKrw: 1_000_000_000,
      monthlyRentKrw: 0,
      areaM2: 76
    };

    const unavailable = await compareContractTerms(
      input,
      mockRentClient({
        source: 'unavailable',
        requiresLiveData: true,
        dataNotice: '국토교통부 API 연결에 실패했습니다.',
        deals: [],
        totalMatched: 0,
        disclaimer: 'test disclaimer'
      }),
      new Date('2026-07-08T00:00:00.000Z')
    );
    const noMatches = await compareContractTerms(
      input,
      mockRentClient({
        source: 'live',
        requiresLiveData: false,
        dataNotice: '조회는 성공했지만 조건에 맞는 자료가 없습니다.',
        deals: [],
        totalMatched: 0,
        disclaimer: 'test disclaimer'
      }),
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(unavailable.comparisonSummary).toContain('조회하지 못해');
    expect(unavailable.comparisonSummary).toContain('다시 시도');
    expect(noMatches.comparisonSummary).toContain('조회는 완료됐지만');
    expect(noMatches.comparisonSummary).toContain('조건을 넓혀');
  });

  it('compares contract terms against live comparables', async () => {
    delete process.env.JUSO_API_KEY;
    const result = await compareContractTerms(
      {
        address: '서울특별시 강남구 역삼동',
        housingType: 'apartment',
        depositKrw: 310000000,
        monthlyRentKrw: 2000000,
        areaM2: 60,
        monthsBack: 12,
        complexName: '역삼센트럴'
      },
      mockRentClient({
        source: 'live',
        requiresLiveData: false,
        dataNotice: '국토교통부 Open API XML 응답에서 지원 필드를 검증한 뒤 반환했습니다.',
        deals: liveDeals,
        totalMatched: 12,
        disclaimer: 'test disclaimer'
      }),
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(result.sampleCount).toBe(2);
    expect(result.comparableSource).toBe('live');
    expect(result.depositKrw.median).toBe(290000000);
    expect(result.monthlyRentKrw.median).toBe(1975000);
    expect(result.comparisonSummary).toContain('최근 2건');
    expect(result.dataNotice).toContain('국토교통부 Open API XML 응답');
    expect(result.disclaimer).toContain('계약 전 확인을 돕는 정보');
  });

  it('awaits Juso address resolution before searching rent comparables', async () => {
    process.env.JUSO_API_KEY = 'juso-key';
    process.env.JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: { errorCode: '0', errorMessage: '정상', totalCount: '1' },
              juso: [
                {
                  roadAddr: '경기도 부천시 원미구 조마루로 135',
                  jibunAddr: '경기도 부천시 중동 1170',
                  bdNm: '포도마을',
                  siNm: '경기도',
                  sggNm: '부천시',
                  emdNm: '중동',
                  admCd: '4119010900',
                  bdMgtSn: '4119010900100011700000001'
                }
              ]
            }
          }),
          { status: 200 }
        )
    );
    const searchedLawdCodes: string[] = [];
    const rentClient: MolitRentClient = {
      async searchRentComparables(input) {
        searchedLawdCodes.push(input.lawdCode);
        return {
          source: 'live',
          requiresLiveData: false,
          dataNotice: '국토교통부 Open API XML 응답에서 지원 필드를 검증한 뒤 반환했습니다.',
          deals: [],
          totalMatched: 0,
          disclaimer: 'test disclaimer'
        };
      }
    };

    const result = await compareContractTerms(
      {
        address: '부천 포도마을',
        housingType: 'apartment',
        depositKrw: 200000000,
        monthlyRentKrw: 1000000,
        areaM2: 59,
        monthsBack: 12,
        complexName: '포도마을'
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(result.addressResolution.source).toBe('juso');
    expect(result.addressResolution.lawdCode).toBe('41190');
    expect(searchedLawdCodes).toEqual(['41190']);
  });

  it('uses a high-confidence Juso building name when complexName is omitted', async () => {
    process.env.JUSO_API_KEY = 'juso-key';
    process.env.JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: { errorCode: '0', errorMessage: '정상', totalCount: '1' },
              juso: [
                {
                  roadAddr: '서울특별시 강남구 삼성로 212',
                  jibunAddr: '서울특별시 강남구 대치동 316',
                  bdNm: '은마아파트',
                  siNm: '서울특별시',
                  sggNm: '강남구',
                  emdNm: '대치동',
                  admCd: '1168010600',
                  bdMgtSn: '1168010600103160000000001'
                }
              ]
            }
          }),
          { status: 200 }
        )
    );
    const searchedComplexNames: Array<string | undefined> = [];
    const rentClient: MolitRentClient = {
      async searchRentComparables(input) {
        searchedComplexNames.push(input.complexName);
        return {
          source: 'live',
          requiresLiveData: false,
          dataNotice: '조회 완료',
          deals: [],
          totalMatched: 0,
          disclaimer: 'test disclaimer'
        };
      }
    };

    await compareContractTerms(
      {
        address: '서울 강남 은마아파트',
        housingType: 'apartment',
        depositKrw: 1_000_000_000,
        monthlyRentKrw: 0,
        areaM2: 76
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(searchedComplexNames).toEqual(['은마아파트']);
  });

  it('does not combine the primary Juso region with a secondary candidate building name', async () => {
    process.env.JUSO_API_KEY = 'juso-key';
    process.env.JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: { errorCode: '0', totalCount: '2' },
              juso: [
                {
                  roadAddr: '서울특별시 종로구 테스트로 1',
                  jibunAddr: '서울특별시 종로구 청운동 1',
                  bdNm: '첫후보건물',
                  siNm: '서울특별시',
                  sggNm: '종로구',
                  emdNm: '청운동',
                  admCd: '1111010100',
                  bdMgtSn: ''
                },
                {
                  roadAddr: '서울특별시 강남구 테스트로 2',
                  jibunAddr: '서울특별시 강남구 역삼동 2',
                  bdNm: '다른지역건물',
                  siNm: '서울특별시',
                  sggNm: '강남구',
                  emdNm: '역삼동',
                  admCd: '1168010100',
                  bdMgtSn: '1168010100100020000000001'
                }
              ]
            }
          }),
          { status: 200 }
        )
    );
    const searchedInputs: Array<{ lawdCode: string; complexName?: string }> = [];
    const rentClient: MolitRentClient = {
      async searchRentComparables(input) {
        searchedInputs.push({ lawdCode: input.lawdCode, complexName: input.complexName });
        return {
          source: 'live',
          requiresLiveData: false,
          dataNotice: '조회 완료',
          deals: [],
          totalMatched: 0,
          disclaimer: 'test disclaimer'
        };
      }
    };

    await compareContractTerms(
      {
        address: '테스트 주소',
        housingType: 'apartment',
        depositKrw: 100_000_000,
        monthlyRentKrw: 0,
        areaM2: 60
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(searchedInputs).toEqual([{ lawdCode: '11110', complexName: undefined }]);
  });

  it('returns an explicit no-match summary when address resolution fails', async () => {
    delete process.env.JUSO_API_KEY;
    const result = await compareContractTerms(
      {
        address: '알 수 없는 주소',
        housingType: 'apartment',
        depositKrw: 100000000,
        monthlyRentKrw: 700000,
        areaM2: 40
      },
      mockRentClient({
        source: 'unavailable',
        requiresLiveData: true,
        dataNotice: 'test',
        deals: [],
        totalMatched: 0,
        disclaimer: 'test disclaimer'
      }),
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(result.sampleCount).toBe(0);
    expect(result.addressResolution.lawdCode).toBeNull();
    expect(result.comparableSource).toBe('unavailable');
    expect(result.comparisonSummary).toContain('정보가 부족');
  });
});
