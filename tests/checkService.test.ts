import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComparableSearchResult, SaleComparableSearchResult } from '../src/domain/types.js';
import { detectPrecontractCheckSignals } from '../src/services/checkService.js';
import type { MolitRentClient } from '../src/services/molitClient.js';

const originalJusoApiKey = process.env.JUSO_API_KEY;
const originalJusoApiBaseUrl = process.env.JUSO_API_BASE_URL;
const originalFetch = globalThis.fetch;

function mockVerifiedPropertyAddress(): void {
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

function mockRentClient(
  result: ComparableSearchResult,
  saleResult?: SaleComparableSearchResult
): MolitRentClient {
  return {
    async searchRentComparables() {
      return result;
    },
    ...(saleResult
      ? {
          async searchSaleComparables() {
            return saleResult;
          }
        }
      : {})
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalJusoApiKey === undefined) {
    delete process.env.JUSO_API_KEY;
  } else {
    process.env.JUSO_API_KEY = originalJusoApiKey;
  }
  if (originalJusoApiBaseUrl === undefined) delete process.env.JUSO_API_BASE_URL;
  else process.env.JUSO_API_BASE_URL = originalJusoApiBaseUrl;
});

describe('detectPrecontractCheckSignals', () => {
  it('uses checkSignals and itemsToVerify instead of deterministic risk labels', async () => {
    delete process.env.JUSO_API_KEY;
    const result = await detectPrecontractCheckSignals(
      {
        address: '서울특별시 강남구 역삼동',
        housingType: 'apartment',
        depositKrw: 500000000,
        monthlyRentKrw: 3200000,
        areaM2: 60,
        monthsBack: 12,
        complexName: '역삼센트럴'
      },
      mockRentClient({
        source: 'live',
        requiresLiveData: false,
        dataNotice: '국토교통부 Open API XML 응답에서 지원 필드를 검증한 뒤 반환했습니다.',
        totalMatched: 1,
        disclaimer: 'test disclaimer',
        deals: [
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
            complexName: '역삼센트럴',
            source: 'live',
            sourceNotice: 'live test fixture'
          }
        ]
      })
    );

    expect(result.checkSignals.map((signal) => signal.code)).toContain('LOW_SAMPLE_COUNT');
    expect(result.checkSignals.map((signal) => signal.code)).toContain('PROPERTY_NAME_UNVERIFIED');
    expect(result.checkSignals.map((signal) => signal.code)).not.toContain('WOLSE_COMPARISON_LIMITED');
    expect(result.checkSignals.map((signal) => signal.code)).not.toContain('WOLSE_TERMS_DIFFER_FROM_MEDIAN');
    expect(result.checkSignals.map((signal) => signal.code)).not.toContain('DEPOSIT_OUTSIDE_COMPARABLE_RANGE');
    expect(result.itemsToVerify).toContain('등기부등본의 소유자, 근저당권, 압류/가압류 등 권리관계');
    expect(result.notAutomaticallyVerifiedItems.join('\n')).toContain('등기부등본');
    expect(result.screeningOutcome).toBe('INSUFFICIENT_INFORMATION');
    expect(result.screeningSummary).toContain('정보가 부족');
    expect(JSON.stringify(result)).not.toContain('riskSignals');
    expect(JSON.stringify(result)).not.toContain('SEED');
    expect(result.disclaimer).toContain('법률, 금융, 세무 또는 투자 조언이 아니며');
  });

  it('reports live data unavailability instead of a low sample count', async () => {
    delete process.env.JUSO_API_KEY;
    const result = await detectPrecontractCheckSignals(
      {
        address: '서울특별시 강남구 역삼동',
        housingType: 'apartment',
        depositKrw: 500000000,
        monthlyRentKrw: 0,
        areaM2: 60
      },
      mockRentClient({
        source: 'unavailable',
        requiresLiveData: true,
        status: 'LIVE_DATA_UNAVAILABLE',
        reasonCode: 'API_TIMEOUT',
        retryable: true,
        nextActions: ['잠시 후 다시 시도하세요.'],
        dataNotice: '공공데이터 요청 시간이 초과됐습니다.',
        totalMatched: 0,
        deals: [],
        disclaimer: 'test disclaimer'
      })
    );

    expect(result.checkSignals.map((signal) => signal.code)).toContain('LIVE_DATA_UNAVAILABLE');
    expect(result.checkSignals.map((signal) => signal.code)).not.toContain('LOW_SAMPLE_COUNT');
    expect(result.screeningOutcome).toBe('INSUFFICIENT_INFORMATION');
  });

  it('reports no additional price signal only for sufficient high-confidence property data', async () => {
    mockVerifiedPropertyAddress();
    const deals = Array.from({ length: 5 }, (_, index) => ({
      id: `same-building-${index}`,
      lawdCode: '11680',
      regionName: '역삼동',
      housingType: 'apartment' as const,
      contractDate: `2026-07-0${index + 1}`,
      contractType: 'jeonse' as const,
      depositKrw: 490_000_000 + index * 5_000_000,
      monthlyRentKrw: 0,
      areaM2: 59.8,
      complexName: '역삼센트럴',
      source: 'live' as const
    }));

    const result = await detectPrecontractCheckSignals(
      {
        address: '서울특별시 강남구 역삼동 역삼센트럴',
        housingType: 'apartment',
        depositKrw: 500_000_000,
        monthlyRentKrw: 0,
        areaM2: 60,
        complexName: '역삼센트럴'
      },
      mockRentClient(
        {
          source: 'live',
          requiresLiveData: false,
          status: 'MATCHES_FOUND',
          reasonCode: 'MATCHES_FOUND',
          retryable: false,
          searchComplete: true,
          requestedMonthCount: 12,
          searchedMonthCount: 12,
          dataNotice: '조회 완료',
          totalMatched: deals.length,
          deals,
          disclaimer: 'test disclaimer'
        },
        {
          source: 'live',
          status: 'MATCHES_FOUND',
          reasonCode: 'MATCHES_FOUND',
          retryable: false,
          nextActions: [],
          searchComplete: true,
          dataNotice: '매매 조회 완료',
          totalMatched: 3,
          deals: Array.from({ length: 3 }, (_, index) => ({
            id: `sale-${index}`,
            lawdCode: '11680',
            regionName: '역삼동',
            housingType: 'apartment' as const,
            contractDate: `2026-07-0${index + 1}`,
            salePriceKrw: 900_000_000 + index * 10_000_000,
            areaM2: 59.8,
            complexName: '역삼센트럴',
            source: 'live' as const
          })),
          disclaimer: 'test disclaimer'
        }
      )
    );

    expect(result.screeningOutcome).toBe('NO_ADDITIONAL_PRICE_SIGNAL_FOUND');
    expect(result.screeningSummary).toContain('공공데이터 가격 조건 비교');
    expect(result.screeningSummary).toContain('계약 안전이나 권리관계를 확인한 결과가 아니');
    expect(result.comparison).toMatchObject({ comparisonScope: 'SAME_REPORTED_PROPERTY', confidence: 'HIGH' });
  });

  it('answers the price question directly even when verified-property samples are limited', async () => {
    mockVerifiedPropertyAddress();
    const rentDeals = [700_000_000, 800_000_000].map((depositKrw, index) => ({
      id: `limited-rent-${index}`,
      lawdCode: '11680',
      regionName: '역삼동',
      housingType: 'apartment' as const,
      contractDate: `2026-0${index + 5}-20`,
      contractType: 'jeonse' as const,
      depositKrw,
      monthlyRentKrw: 0,
      areaM2: 181.774,
      complexName: '역삼센트럴',
      source: 'live' as const
    }));

    const result = await detectPrecontractCheckSignals(
      {
        address: '서울특별시 강남구 역삼동 역삼센트럴',
        housingType: 'apartment',
        depositKrw: 500_000_000,
        monthlyRentKrw: 0,
        areaM2: 188,
        complexName: '역삼센트럴'
      },
      mockRentClient(
        {
          source: 'live',
          requiresLiveData: false,
          status: 'MATCHES_FOUND',
          reasonCode: 'MATCHES_FOUND',
          retryable: false,
          searchComplete: true,
          dataNotice: '임대차 조회 완료',
          totalMatched: rentDeals.length,
          deals: rentDeals,
          disclaimer: 'test disclaimer'
        },
        {
          source: 'live',
          status: 'MATCHES_FOUND',
          reasonCode: 'MATCHES_FOUND',
          retryable: false,
          nextActions: [],
          searchComplete: true,
          dataNotice: '매매 조회 완료',
          totalMatched: 1,
          deals: [
            {
              id: 'limited-sale-1',
              lawdCode: '11680',
              regionName: '역삼동',
              housingType: 'apartment' as const,
              contractDate: '2026-05-22',
              salePriceKrw: 1_850_000_000,
              areaM2: 181.774,
              complexName: '역삼센트럴',
              source: 'live' as const
            }
          ],
          disclaimer: 'test disclaimer'
        }
      )
    );

    expect(result.screeningOutcome).toBe('INSUFFICIENT_INFORMATION');
    expect(result.pricePosition).toMatchObject({
      basis: 'JEONSE_DEPOSIT',
      position: 'BELOW_COMPARABLE_RANGE',
      inputKrw: 500_000_000,
      medianKrw: 750_000_000,
      minKrw: 700_000_000,
      maxKrw: 800_000_000,
      comparableSampleCount: 2
    });
    expect(result.screeningSummary).toContain('5억원');
    expect(result.screeningSummary).toContain('7억원~8억원');
    expect(result.screeningSummary).toContain('2억원~3억원 낮습니다');
    expect(result.screeningSummary).toContain('18억 5,000만원');
    expect(result.screeningSummary).toContain('27%');
    expect(result.screeningSummary).toContain('80%보다 낮습니다');
    expect(result.screeningSummary).toContain('표본 2건');
    expect(result.screeningSummary).toContain('계약 안전');
  });

  it('explains directly when wolse samples have no comparable deposit level', async () => {
    mockVerifiedPropertyAddress();
    const deals = Array.from({ length: 5 }, (_, index) => ({
      id: `wolse-unpaired-${index}`,
      lawdCode: '11680',
      regionName: '역삼동',
      housingType: 'officetel' as const,
      contractDate: `2026-07-0${index + 1}`,
      contractType: 'wolse' as const,
      depositKrw: index % 2 === 0 ? 10_000_000 : 200_000_000,
      monthlyRentKrw: 900_000 + index * 50_000,
      areaM2: 31.15,
      complexName: '역삼센트럴',
      source: 'live' as const
    }));

    const result = await detectPrecontractCheckSignals(
      {
        address: '서울특별시 강남구 역삼동 역삼센트럴',
        housingType: 'officetel',
        depositKrw: 70_000_000,
        monthlyRentKrw: 750_000,
        areaM2: 31.15,
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
        dataNotice: '임대차 조회 완료',
        totalMatched: deals.length,
        deals,
        disclaimer: 'test disclaimer'
      })
    );

    expect(result.pricePosition).toMatchObject({
      basis: 'UNAVAILABLE',
      position: 'INSUFFICIENT_DATA',
      comparableSampleCount: 0
    });
    expect(result.screeningSummary).toContain('월세 신고자료 5건은 확인');
    expect(result.screeningSummary).toContain('입력 보증금 7,000만원');
    expect(result.screeningSummary).toContain('25% 이내인 표본은 0건');
    expect(result.screeningSummary).toContain('입력 월세 75만원이 높은지 낮은지 직접 비교할 수 없습니다');
  });

  it('surfaces an area mismatch in the top-level summary', async () => {
    mockVerifiedPropertyAddress();
    const result = await detectPrecontractCheckSignals(
      {
        address: '서울특별시 강남구 테스트로 1',
        housingType: 'officetel',
        depositKrw: 70_000_000,
        monthlyRentKrw: 750_000,
        areaM2: 67,
        complexName: '역삼센트럴'
      },
      mockRentClient({
        source: 'live',
        requiresLiveData: false,
        status: 'NO_MATCHES',
        reasonCode: 'NO_AREA_MATCH',
        retryable: false,
        filterStats: { raw: 100, afterContractType: 80, afterLegalDong: 20, afterComplexName: 10, afterArea: 0 },
        nextActions: ['전용면적을 확인하세요.'],
        searchComplete: true,
        requestedMonthCount: 12,
        searchedMonthCount: 12,
        dataNotice: '면적 일치 자료 없음',
        totalMatched: 0,
        deals: [],
        disclaimer: 'test disclaimer'
      })
    );

    expect(result.comparison).toMatchObject({
      comparisonScope: 'SAME_REPORTED_PROPERTY',
      reasonCode: 'NO_AREA_MATCH'
    });
    expect(result.screeningSummary).toContain('요청한 면적 범위');
    expect(result.screeningSummary).toContain('전용면적');
  });

  it('does not treat legal-dong reference data as a contract-level screening result', async () => {
    delete process.env.JUSO_API_KEY;
    const result = await detectPrecontractCheckSignals(
      {
        address: '서울특별시 강남구 역삼동',
        housingType: 'apartment',
        depositKrw: 800_000_000,
        monthlyRentKrw: 0,
        areaM2: 60
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
        totalMatched: 5,
        deals: Array.from({ length: 5 }, (_, index) => ({
          id: `regional-${index}`,
          lawdCode: '11680',
          regionName: '역삼동',
          housingType: 'apartment' as const,
          contractDate: `2026-07-0${index + 1}`,
          contractType: 'jeonse' as const,
          depositKrw: 490_000_000 + index * 5_000_000,
          monthlyRentKrw: 0,
          areaM2: 59.8,
          complexName: `서로다른건물${index}`,
          source: 'live' as const
        })),
        disclaimer: 'test disclaimer'
      })
    );

    expect(result.screeningOutcome).toBe('INSUFFICIENT_INFORMATION');
    expect(result.checkSignals.map((signal) => signal.code)).toContain('REGIONAL_REFERENCE_ONLY');
    expect(result.checkSignals.map((signal) => signal.code)).not.toContain('DEPOSIT_OUTSIDE_COMPARABLE_RANGE');
    expect(result.screeningSummary).toContain('정확한 건물');
  });

  it.each([
    { saleCount: 3, expectsRatioSignal: true },
    { saleCount: 1, expectsRatioSignal: false }
  ])('gates a high deposit-to-sale ratio on sale data quality: $saleCount samples', async ({ saleCount, expectsRatioSignal }) => {
    mockVerifiedPropertyAddress();
    const rentDeals = Array.from({ length: 5 }, (_, index) => ({
      id: `rent-high-deposit-${index}`,
      lawdCode: '11680',
      regionName: '역삼동',
      housingType: 'apartment' as const,
      contractDate: `2026-07-0${index + 1}`,
      contractType: 'jeonse' as const,
      depositKrw: 790_000_000 + index * 5_000_000,
      monthlyRentKrw: 0,
      areaM2: 59.8,
      complexName: '역삼센트럴',
      source: 'live' as const
    }));
    const result = await detectPrecontractCheckSignals(
      {
        address: '서울 강남구 역삼동 역삼센트럴',
        housingType: 'apartment',
        depositKrw: 800_000_000,
        monthlyRentKrw: 0,
        areaM2: 60,
        complexName: '역삼센트럴'
      },
      mockRentClient(
        {
          source: 'live',
          requiresLiveData: false,
          status: 'MATCHES_FOUND',
          reasonCode: 'MATCHES_FOUND',
          retryable: false,
          searchComplete: true,
          dataNotice: '임대차 조회 완료',
          totalMatched: rentDeals.length,
          deals: rentDeals,
          disclaimer: 'test disclaimer'
        },
        {
          source: 'live',
          status: 'MATCHES_FOUND',
          reasonCode: 'MATCHES_FOUND',
          retryable: false,
          nextActions: [],
          searchComplete: true,
          dataNotice: '매매 조회 완료',
          totalMatched: saleCount,
          deals: Array.from({ length: saleCount }, (_, index) => ({
            id: `sale-high-deposit-${index}`,
            lawdCode: '11680',
            regionName: '역삼동',
            housingType: 'apartment' as const,
            contractDate: `2026-07-0${index + 1}`,
            salePriceKrw: 990_000_000 + index * 10_000_000,
            areaM2: 59.8,
            complexName: '역삼센트럴',
            source: 'live' as const
          })),
          disclaimer: 'test disclaimer'
        }
      )
    );

    expect(result.screeningOutcome).toBe('ADDITIONAL_VERIFICATION_REQUIRED');
    if (expectsRatioSignal) {
      expect(result.checkSignals.map((signal) => signal.code)).toContain('DEPOSIT_TO_SALE_PRICE_CHECK');
      expect(result.checkSignals.map((signal) => signal.code)).not.toContain('SALE_PRICE_REFERENCE_LIMITED');
    } else {
      expect(result.checkSignals.map((signal) => signal.code)).toContain('SALE_PRICE_REFERENCE_LIMITED');
      expect(result.checkSignals.map((signal) => signal.code)).not.toContain('DEPOSIT_TO_SALE_PRICE_CHECK');
    }
    expect(result.comparison?.salePriceAssessment.depositToMedianSalePricePercent).toBeGreaterThanOrEqual(80);
  });
});
