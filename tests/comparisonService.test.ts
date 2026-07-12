import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ComparableSearchInput,
  ComparableSearchResult,
  RentDeal,
  SaleComparableSearchInput
} from '../src/domain/types.js';
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

function mockVerifiedJusoProperty(): void {
  process.env.JUSO_API_KEY = 'juso-key';
  process.env.JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          results: {
            common: { errorCode: '0', totalCount: '1' },
            juso: [
              {
                roadAddr: '서울특별시 강남구 테스트로 1',
                jibunAddr: '서울특별시 강남구 역삼동 1 역삼센트럴',
                bdNm: '역삼센트럴',
                siNm: '서울특별시',
                sggNm: '강남구',
                emdNm: '역삼동',
                admCd: '1168010100',
                bdMgtSn: '1168010100100010000000001'
              }
            ]
          }
        }),
        { status: 200 }
      )
  );
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
    const searchedLimits: Array<number | undefined> = [];
    const rentClient: MolitRentClient = {
      async searchRentComparables(input) {
        searchedContractTypes.push(input.contractType);
        searchedLimits.push(input.limit);
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
    expect(searchedLimits).toEqual([10, 10]);
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
        status: 'LIVE_DATA_UNAVAILABLE',
        reasonCode: 'API_TIMEOUT',
        retryable: true,
        nextActions: ['잠시 후 다시 시도하세요.'],
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
        status: 'NO_MATCHES',
        reasonCode: 'NO_AREA_MATCH',
        retryable: false,
        filterStats: { raw: 10, afterContractType: 8, afterComplexName: 5, afterArea: 0 },
        nextActions: ['면적 허용 범위를 넓혀 다시 조회하세요.'],
        dataNotice: '조회는 성공했지만 조건에 맞는 자료가 없습니다.',
        deals: [],
        totalMatched: 0,
        disclaimer: 'test disclaimer'
      }),
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(unavailable.comparisonSummary).toContain('조회하지 못해');
    expect(unavailable.comparisonSummary).toContain('다시 시도');
    expect(unavailable).toMatchObject({
      status: 'LIVE_DATA_UNAVAILABLE',
      reasonCode: 'API_TIMEOUT',
      retryable: true,
      nextActions: ['잠시 후 다시 시도하세요.']
    });
    expect(noMatches.comparisonSummary).toContain('면적');
    expect(noMatches).toMatchObject({
      status: 'NO_MATCHES',
      reasonCode: 'NO_AREA_MATCH',
      retryable: false,
      filterStats: { raw: 10, afterContractType: 8, afterComplexName: 5, afterArea: 0 }
    });
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
    expect(result.status).toBe('COMPARED');
    expect(result.reasonCode).toBe('MATCHES_FOUND');
    expect(result.period).toEqual({ from: '2025-08-01', to: '2026-07-08', monthsBack: 12 });
    expect(result.comparableSource).toBe('live');
    expect(result.depositKrw.median).toBe(290000000);
    expect(result.monthlyRentKrw.median).toBe(1975000);
    expect(result.monthlyRentKrw).toMatchObject({
      comparisonMethod: 'PAIRED_NEAREST_DEPOSIT',
      comparableSampleCount: 2,
      maximumDepositDifferencePercent: 25
    });
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

    const result = await compareContractTerms(
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

    expect(searchedInputs).toEqual([]);
    expect(result).toMatchObject({
      status: 'ADDRESS_AMBIGUOUS',
      reasonCode: 'ADDRESS_AMBIGUOUS',
      retryable: false,
      sampleCount: 0
    });
    expect(result.nextActions).toContain('도로명주소나 지번주소를 더 구체적으로 입력하세요.');
  });

  it.each([undefined, '중동아파트'] as const)(
    'does not turn a bare dong into a building match when complexName is %s',
    async (complexName) => {
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
                    roadAddr: '전라남도 광양시 중마청룡길 40 (중동, 중동아파트)',
                    jibunAddr: '전라남도 광양시 중동 1294 중동아파트',
                    bdNm: '중동아파트',
                    siNm: '전라남도',
                    sggNm: '광양시',
                    emdNm: '중동',
                    admCd: '4623010600',
                    bdMgtSn: '4623010600112940000000001'
                  },
                  {
                    roadAddr: '경기도 부천시 원미구 길주로 234 (중동, 힐스테이트 중동)',
                    jibunAddr: '경기도 부천시 원미구 중동 1301 힐스테이트 중동',
                    bdNm: '힐스테이트 중동',
                    siNm: '경기도',
                    sggNm: '부천시 원미구',
                    emdNm: '중동',
                    admCd: '4119210800',
                    bdMgtSn: '4119210800113010000000001'
                  }
                ]
              }
            }),
            { status: 200 }
          )
      );
      let searchCount = 0;
      const rentClient: MolitRentClient = {
        async searchRentComparables() {
          searchCount += 1;
          throw new Error('ambiguous address must not trigger a rent lookup');
        }
      };

      const result = await compareContractTerms(
        {
          address: '중동',
          housingType: 'officetel',
          depositKrw: 100_000_000,
          monthlyRentKrw: 1_000_000,
          areaM2: 30,
          complexName
        },
        rentClient,
        new Date('2026-07-08T00:00:00.000Z')
      );

      expect(searchCount).toBe(0);
      expect(result).toMatchObject({ status: 'ADDRESS_AMBIGUOUS', reasonCode: 'ADDRESS_AMBIGUOUS' });
      expect(result.addressResolution.clarificationQuestion).toContain('시·군·구');
    }
  );

  it('uses a district-qualified dong as a regional query without inferring a building name', async () => {
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
                  roadAddr: '전라남도 광양시 중마청룡길 40 (중동, 중동아파트)',
                  jibunAddr: '전라남도 광양시 중동 1294 중동아파트',
                  bdNm: '중동아파트',
                  siNm: '전라남도',
                  sggNm: '광양시',
                  emdNm: '중동',
                  admCd: '4623010600',
                  bdMgtSn: '4623010600112940000000001'
                },
                {
                  roadAddr: '경기도 부천시 원미구 길주로 234 (중동, 힐스테이트 중동)',
                  jibunAddr: '경기도 부천시 원미구 중동 1301 힐스테이트 중동',
                  bdNm: '힐스테이트 중동',
                  siNm: '경기도',
                  sggNm: '부천시 원미구',
                  emdNm: '중동',
                  admCd: '4119210800',
                  bdMgtSn: '4119210800113010000000001'
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
          status: 'NO_MATCHES',
          reasonCode: 'NO_REPORTED_DEALS',
          retryable: false,
          dataNotice: '조회 완료',
          deals: [],
          totalMatched: 0,
          disclaimer: 'test disclaimer'
        };
      }
    };

    await compareContractTerms(
      {
        address: '부천 중동',
        housingType: 'officetel',
        depositKrw: 100_000_000,
        monthlyRentKrw: 1_000_000,
        areaM2: 30
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(searchedInputs).toEqual([{ lawdCode: '41192', complexName: undefined }]);
  });

  it('selects an exact road-address candidate even when prefix variants are also returned', async () => {
    process.env.JUSO_API_KEY = 'juso-key';
    process.env.JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: { errorCode: '0', totalCount: '3' },
              juso: [
                {
                  roadAddr: '서울특별시 강남구 삼성로 212 (대치동, 은마아파트)',
                  jibunAddr: '서울특별시 강남구 대치동 316 은마아파트',
                  bdNm: '은마아파트',
                  siNm: '서울특별시',
                  sggNm: '강남구',
                  emdNm: '대치동',
                  admCd: '1168010600',
                  bdMgtSn: '1168010600103160000014551'
                },
                {
                  roadAddr: '서울특별시 강남구 삼성로 212-2 (대치동)',
                  jibunAddr: '서울특별시 강남구 대치동 316',
                  bdNm: '',
                  siNm: '서울특별시',
                  sggNm: '강남구',
                  emdNm: '대치동',
                  admCd: '1168010600',
                  bdMgtSn: '1168010600103160000014581'
                },
                {
                  roadAddr: '서울특별시 강남구 삼성로 212-3 (대치동)',
                  jibunAddr: '서울특별시 강남구 대치동 316',
                  bdNm: '',
                  siNm: '서울특별시',
                  sggNm: '강남구',
                  emdNm: '대치동',
                  admCd: '1168010600',
                  bdMgtSn: '1168010600103160000014582'
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

    const result = await compareContractTerms(
      {
        address: '서울특별시 강남구 삼성로 212',
        housingType: 'apartment',
        depositKrw: 1_000_000_000,
        monthlyRentKrw: 0,
        areaM2: 76
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(result.status).toBe('NO_MATCHES');
    expect(searchedInputs).toEqual([{ lawdCode: '11680', complexName: '은마아파트' }]);
    expect(result.addressResolution.candidates[0]?.roadAddress).toContain('삼성로 212 ');
  });

  it('treats multiple buildings in the same named complex as one comparable target', async () => {
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
                  roadAddr: '경기도 부천시 원미구 소향로 124 (중동, 포도마을)',
                  jibunAddr: '경기도 부천시 원미구 중동 1171 포도마을',
                  bdNm: '포도마을',
                  siNm: '경기도',
                  sggNm: '부천시 원미구',
                  emdNm: '중동',
                  admCd: '4119210800',
                  bdMgtSn: '4119510800111710000000001'
                },
                {
                  roadAddr: '경기도 부천시 원미구 조마루로 135 (중동, 포도마을)',
                  jibunAddr: '경기도 부천시 원미구 중동 1170 포도마을',
                  bdNm: '포도마을',
                  siNm: '경기도',
                  sggNm: '부천시 원미구',
                  emdNm: '중동',
                  admCd: '4119210800',
                  bdMgtSn: '4119510800111700000000002'
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

    const result = await compareContractTerms(
      {
        address: '부천 포도마을',
        housingType: 'apartment',
        depositKrw: 200_000_000,
        monthlyRentKrw: 1_000_000,
        areaM2: 59,
        complexName: '포도마을'
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(result.status).toBe('NO_MATCHES');
    expect(searchedInputs).toEqual([{ lawdCode: '41192', complexName: '포도마을' }]);
  });

  it('does not merge separate properties that only share a building name in one district', async () => {
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
                  roadAddr: '서울특별시 강남구 테스트로 1',
                  jibunAddr: '서울특별시 강남구 역삼동 1 센트럴',
                  bdNm: '센트럴',
                  siNm: '서울특별시',
                  sggNm: '강남구',
                  emdNm: '역삼동',
                  admCd: '1168010100',
                  bdMgtSn: '1168010100100010000000001'
                },
                {
                  roadAddr: '서울특별시 강남구 테스트로 99',
                  jibunAddr: '서울특별시 강남구 역삼동 999 센트럴',
                  bdNm: '센트럴',
                  siNm: '서울특별시',
                  sggNm: '강남구',
                  emdNm: '역삼동',
                  admCd: '1168010100',
                  bdMgtSn: '1168010100109990000000001'
                }
              ]
            }
          }),
          { status: 200 }
        )
    );
    let searchCount = 0;
    const rentClient: MolitRentClient = {
      async searchRentComparables() {
        searchCount += 1;
        throw new Error('ambiguous candidates must not trigger a rent lookup');
      }
    };

    const result = await compareContractTerms(
      {
        address: '강남 센트럴',
        housingType: 'officetel',
        depositKrw: 100_000_000,
        monthlyRentKrw: 1_000_000,
        areaM2: 40,
        complexName: '센트럴'
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(searchCount).toBe(0);
    expect(result).toMatchObject({ status: 'ADDRESS_AMBIGUOUS', reasonCode: 'ADDRESS_AMBIGUOUS' });
  });

  it('distinguishes an unavailable address API from a successful address no-match', async () => {
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
    expect(result.status).toBe('LIVE_DATA_UNAVAILABLE');
    expect(result.reasonCode).toBe('API_KEY_MISSING');
    expect(result.retryable).toBe(false);
    expect(result.addressResolution.lawdCode).toBeNull();
    expect(result.comparableSource).toBe('unavailable');
    expect(result.comparisonSummary).toContain('도로명주소 API');
  });

  it('uses a unique official building for a partial building query and keeps the area band narrow', async () => {
    process.env.JUSO_API_KEY = 'juso-key';
    process.env.JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: { errorCode: '0', totalCount: '1' },
              juso: [
                {
                  roadAddr: '경기도 성남시 분당구 판교역로192번길 22',
                  jibunAddr: '경기도 성남시 분당구 삼평동 659 판교 효성 해링턴 타워',
                  bdNm: '판교 효성 해링턴 타워',
                  siNm: '경기도',
                  sggNm: '성남시 분당구',
                  emdNm: '삼평동',
                  admCd: '4113510900',
                  bdMgtSn: '4113510900106590000000001'
                }
              ]
            }
          }),
          { status: 200 }
        )
    );
    let searchedInput: ComparableSearchInput | undefined;
    let searchedSaleInput: SaleComparableSearchInput | undefined;
    const deals = Array.from({ length: 5 }, (_, index): RentDeal => ({
      id: `pangyo-${index}`,
      lawdCode: '41135',
      regionName: '삼평동',
      housingType: 'officetel',
      contractDate: `2026-07-0${index + 1}`,
      contractType: 'wolse',
      depositKrw: 10_000_000,
      monthlyRentKrw: 1_050_000 + index * 25_000,
      areaM2: 27.1,
      complexName: '판교 효성 해링턴 타워',
      source: 'live'
    }));
    const rentClient: MolitRentClient = {
      async searchRentComparables(input) {
        searchedInput = input;
        return {
          source: 'live',
          requiresLiveData: false,
          status: 'MATCHES_FOUND',
          reasonCode: 'MATCHES_FOUND',
          retryable: false,
          searchComplete: true,
          requestedMonthCount: 12,
          searchedMonthCount: 12,
          dataNotice: '조회 완료',
          deals,
          totalMatched: deals.length,
          disclaimer: 'test disclaimer'
        };
      },
      async searchSaleComparables(input) {
        searchedSaleInput = input;
        return {
          source: 'live',
          status: 'MATCHES_FOUND',
          reasonCode: 'MATCHES_FOUND',
          retryable: false,
          nextActions: [],
          searchComplete: true,
          dataNotice: '매매 조회 완료',
          deals: Array.from({ length: 3 }, (_, index) => ({
            id: `pangyo-sale-${index}`,
            lawdCode: '41135',
            regionName: '삼평동',
            housingType: 'officetel' as const,
            contractDate: `2026-07-0${index + 1}`,
            salePriceKrw: 300_000_000 + index * 10_000_000,
            areaM2: 27.1,
            complexName: '판교 효성 해링턴 타워',
            source: 'live' as const
          })),
          totalMatched: 3,
          disclaimer: 'test disclaimer'
        };
      }
    };

    const result = await compareContractTerms(
      {
        address: '판교 효성해링턴',
        housingType: 'officetel',
        depositKrw: 10_000_000,
        monthlyRentKrw: 1_100_000,
        areaM2: 30
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(searchedInput).toMatchObject({
      lawdCode: '41135',
      legalDongName: '삼평동',
      complexName: '판교 효성 해링턴 타워',
      areaToleranceM2: 3
    });
    expect(searchedSaleInput).toMatchObject({
      lawdCode: '41135',
      legalDongName: '삼평동',
      complexName: '판교 효성 해링턴 타워',
      areaToleranceM2: 3
    });
    expect(result).toMatchObject({
      comparisonScope: 'SAME_REPORTED_PROPERTY',
      resolvedBuildingName: '판교 효성 해링턴 타워',
      areaToleranceM2: 3,
      searchComplete: true,
      confidence: 'HIGH',
      screeningOutcome: 'NO_ADDITIONAL_PRICE_SIGNAL_FOUND'
    });
    expect(result.comparables.every((deal) => deal.complexName === '판교 효성 해링턴 타워')).toBe(true);
  });

  it('uses a single brand-assisted Juso candidate as the reported property scope', async () => {
    process.env.JUSO_API_KEY = 'juso-key';
    process.env.JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
    const jusoQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input) => {
      const keyword = new URL(String(input)).searchParams.get('keyword') ?? '';
      jusoQueries.push(keyword);
      const matched = keyword === '성남시 분당구 SK HUB 오피스텔';
      return new Response(
        JSON.stringify({
          results: {
            common: { errorCode: '0', errorMessage: '정상', totalCount: matched ? '1' : '0' },
            juso: matched
              ? [
                  {
                    roadAddr: '경기도 성남시 분당구 판교역로 109 (백현동)',
                    jibunAddr: '경기도 성남시 분당구 백현동 529 SK HUB 오피스텔',
                    bdNm: 'SK HUB 오피스텔',
                    siNm: '경기도',
                    sggNm: '성남시 분당구',
                    emdNm: '백현동',
                    admCd: '4113511000',
                    bdMgtSn: '4113511000105290000000001'
                  }
                ]
              : []
          }
        }),
        { status: 200 }
      );
    });
    let searchedInput: ComparableSearchInput | undefined;
    const rentClient: MolitRentClient = {
      async searchRentComparables(input) {
        searchedInput = input;
        return {
          source: 'live',
          requiresLiveData: false,
          status: 'NO_MATCHES',
          reasonCode: 'NO_AREA_MATCH',
          retryable: false,
          filterStats: { raw: 10, afterContractType: 8, afterLegalDong: 4, afterComplexName: 3, afterArea: 0 },
          nextActions: ['전용면적을 확인하세요.'],
          searchComplete: true,
          requestedMonthCount: 12,
          searchedMonthCount: 12,
          dataNotice: '면적 일치 자료 없음',
          deals: [],
          totalMatched: 0,
          disclaimer: 'test disclaimer'
        };
      }
    };

    const result = await compareContractTerms(
      {
        address: '판교 SK HUB',
        housingType: 'officetel',
        depositKrw: 70_000_000,
        monthlyRentKrw: 750_000,
        areaM2: 67
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(jusoQueries).toEqual(['판교 SK HUB', '성남시 분당구 SK HUB 오피스텔']);
    expect(searchedInput).toMatchObject({
      lawdCode: '41135',
      legalDongName: '백현동',
      complexName: 'SK HUB 오피스텔'
    });
    expect(result).toMatchObject({
      comparisonScope: 'SAME_REPORTED_PROPERTY',
      resolvedBuildingName: 'SK HUB 오피스텔',
      reasonCode: 'NO_AREA_MATCH'
    });
  });

  it('labels a legal-dong comparison as reference data instead of a building screening result', async () => {
    delete process.env.JUSO_API_KEY;
    let searchedInput: ComparableSearchInput | undefined;
    const rentClient: MolitRentClient = {
      async searchRentComparables(input) {
        searchedInput = input;
        return {
          source: 'live',
          requiresLiveData: false,
          status: 'MATCHES_FOUND',
          reasonCode: 'MATCHES_FOUND',
          retryable: false,
          searchComplete: true,
          requestedMonthCount: 12,
          searchedMonthCount: 12,
          dataNotice: '조회 완료',
          deals: liveDeals,
          totalMatched: liveDeals.length,
          disclaimer: 'test disclaimer'
        };
      }
    };

    const result = await compareContractTerms(
      {
        address: '서울특별시 강남구 역삼동',
        housingType: 'apartment',
        depositKrw: 300_000_000,
        monthlyRentKrw: 2_000_000,
        areaM2: 60
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(searchedInput).toMatchObject({ legalDongName: '역삼동', areaToleranceM2: 6 });
    expect(result).toMatchObject({
      comparisonScope: 'SAME_LEGAL_DONG',
      confidence: 'LOW',
      screeningOutcome: 'INSUFFICIENT_INFORMATION'
    });
    expect(result.scopeReason).toContain('건물');
  });

  it('does not compare monthly rent against deals with materially different deposits', async () => {
    mockVerifiedJusoProperty();
    const deals = Array.from({ length: 5 }, (_, index): RentDeal => ({
      id: `wolse-pair-${index}`,
      lawdCode: '11680',
      regionName: '역삼동',
      housingType: 'apartment',
      contractDate: `2026-07-0${index + 1}`,
      contractType: 'wolse',
      depositKrw: 100_000_000 + index * 10_000_000,
      monthlyRentKrw: 1_000_000 - index * 50_000,
      areaM2: 59.8,
      complexName: '역삼센트럴',
      source: 'live'
    }));

    const result = await compareContractTerms(
      {
        address: '서울특별시 강남구 역삼동 역삼센트럴',
        housingType: 'apartment',
        depositKrw: 10_000_000,
        monthlyRentKrw: 1_500_000,
        areaM2: 60,
        complexName: '역삼센트럴'
      },
      mockRentClient({
        source: 'live',
        requiresLiveData: false,
        status: 'MATCHES_FOUND',
        reasonCode: 'MATCHES_FOUND',
        retryable: false,
        searchComplete: true,
        requestedMonthCount: 12,
        searchedMonthCount: 12,
        dataNotice: '조회 완료',
        deals,
        totalMatched: deals.length,
        disclaimer: 'test disclaimer'
      }),
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(result.monthlyRentKrw).toMatchObject({
      median: null,
      comparableSampleCount: 0,
      comparisonMethod: 'PAIRED_NEAREST_DEPOSIT'
    });
    expect(result.screeningOutcome).toBe('ADDITIONAL_VERIFICATION_REQUIRED');
    expect(result.dataNotice).toContain('보증금 차이 25% 이내');
  });

  it('keeps a user-provided property name as reference-only when Juso cannot verify it', async () => {
    delete process.env.JUSO_API_KEY;
    let searchedInput: ComparableSearchInput | undefined;
    const rentClient: MolitRentClient = {
      async searchRentComparables(input) {
        searchedInput = input;
        return {
          source: 'live',
          requiresLiveData: false,
          status: 'MATCHES_FOUND',
          reasonCode: 'MATCHES_FOUND',
          retryable: false,
          searchComplete: true,
          dataNotice: '조회 완료',
          deals: Array.from({ length: 5 }, (_, index): RentDeal => ({
            id: `unverified-${index}`,
            lawdCode: '11680',
            regionName: '역삼동',
            housingType: 'apartment',
            contractDate: `2026-07-0${index + 1}`,
            contractType: 'jeonse',
            depositKrw: 500_000_000,
            monthlyRentKrw: 0,
            areaM2: 60,
            complexName: '역삼센트럴',
            source: 'live'
          })),
          totalMatched: 5,
          disclaimer: 'test disclaimer'
        };
      }
    };

    const result = await compareContractTerms(
      {
        address: '서울 강남구 역삼동 역삼센트럴',
        housingType: 'apartment',
        depositKrw: 500_000_000,
        monthlyRentKrw: 0,
        areaM2: 60,
        complexName: '역삼센트럴'
      },
      rentClient,
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(searchedInput).toMatchObject({ legalDongName: '역삼동', complexName: '역삼센트럴' });
    expect(result).toMatchObject({
      comparisonScope: 'REQUESTED_PROPERTY_REFERENCE',
      resolvedBuildingName: undefined,
      confidence: 'LOW',
      screeningOutcome: 'INSUFFICIENT_INFORMATION'
    });
  });

  it('never uses residual deals from an unavailable API response', async () => {
    delete process.env.JUSO_API_KEY;
    const result = await compareContractTerms(
      {
        address: '서울 강남구 역삼동',
        housingType: 'apartment',
        depositKrw: 500_000_000,
        monthlyRentKrw: 3_000_000,
        areaM2: 60
      },
      mockRentClient({
        source: 'unavailable',
        requiresLiveData: true,
        status: 'LIVE_DATA_UNAVAILABLE',
        reasonCode: 'API_TIMEOUT',
        retryable: true,
        dataNotice: '조회 시간 초과',
        deals: liveDeals,
        totalMatched: liveDeals.length,
        disclaimer: 'test disclaimer'
      }),
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(result).toMatchObject({
      status: 'LIVE_DATA_UNAVAILABLE',
      reasonCode: 'API_TIMEOUT',
      sampleCount: 0,
      screeningOutcome: 'INSUFFICIENT_INFORMATION'
    });
    expect(result.comparables).toEqual([]);
    expect(result.depositKrw.median).toBeNull();
  });
});
