import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ContractType,
  HousingType,
  RentDeal,
  SaleComparableSearchResult,
  SaleDeal,
  ScreeningOutcome
} from '../src/domain/types.js';
import { compareContractTerms } from '../src/services/comparisonService.js';
import type { MolitRentClient } from '../src/services/molitClient.js';

const originalJusoApiKey = process.env.JUSO_API_KEY;
const originalJusoApiBaseUrl = process.env.JUSO_API_BASE_URL;
const originalFetch = globalThis.fetch;
const housingTypes: HousingType[] = ['apartment', 'officetel', 'villa', 'detachedMultiFamily'];
const contractTypes: ContractType[] = ['jeonse', 'wolse'];
const scopes = ['verifiedProperty', 'legalDong'] as const;
const sampleCounts = [0, 1, 3, 5] as const;
const searchStates = [true, false] as const;
const termDifferences = [0, 20, 30] as const;

interface MatrixCase {
  housingType: HousingType;
  contractType: ContractType;
  scope: (typeof scopes)[number];
  sampleCount: (typeof sampleCounts)[number];
  searchComplete: boolean;
  termDifferencePercent: (typeof termDifferences)[number];
}

const cases: MatrixCase[] = housingTypes.flatMap((housingType) =>
  contractTypes.flatMap((contractType) =>
    scopes.flatMap((scope) =>
      sampleCounts.flatMap((sampleCount) =>
        searchStates.flatMap((searchComplete) =>
          termDifferences.map((termDifferencePercent) => ({
            housingType,
            contractType,
            scope,
            sampleCount,
            searchComplete,
            termDifferencePercent
          }))
        )
      )
    )
  )
);

function expectedOutcome(testCase: MatrixCase): ScreeningOutcome {
  if (testCase.scope === 'legalDong' || testCase.sampleCount < 3) return 'INSUFFICIENT_INFORMATION';
  if (testCase.sampleCount < 5 || !testCase.searchComplete || testCase.termDifferencePercent >= 25) {
    return 'ADDITIONAL_VERIFICATION_REQUIRED';
  }
  return 'NO_ADDITIONAL_PRICE_SIGNAL_FOUND';
}

function rentDeals(testCase: MatrixCase): RentDeal[] {
  return Array.from({ length: testCase.sampleCount }, (_, index) => ({
    id: `rent-${index}`,
    lawdCode: '11680',
    regionName: '역삼동',
    housingType: testCase.housingType,
    contractDate: `2026-07-${String(index + 1).padStart(2, '0')}`,
    contractType: testCase.contractType,
    depositKrw: testCase.contractType === 'jeonse' ? 500_000_000 : 100_000_000,
    monthlyRentKrw: testCase.contractType === 'wolse' ? 1_000_000 : 0,
    areaM2: 60,
    complexName: '역삼센트럴',
    source: 'live'
  }));
}

function saleResult(housingType: HousingType): SaleComparableSearchResult {
  const deals: SaleDeal[] = Array.from({ length: 3 }, (_, index) => ({
    id: `sale-${index}`,
    lawdCode: '11680',
    regionName: '역삼동',
    housingType,
    contractDate: `2026-07-0${index + 1}`,
    salePriceKrw: 1_000_000_000,
    areaM2: 60,
    complexName: '역삼센트럴',
    source: 'live'
  }));
  return {
    source: 'live',
    status: 'MATCHES_FOUND',
    reasonCode: 'MATCHES_FOUND',
    retryable: false,
    nextActions: [],
    searchComplete: true,
    requestedMonthCount: 12,
    searchedMonthCount: 12,
    dataNotice: '매매 조회 완료',
    deals,
    totalMatched: deals.length,
    disclaimer: 'test disclaimer'
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalJusoApiKey === undefined) delete process.env.JUSO_API_KEY;
  else process.env.JUSO_API_KEY = originalJusoApiKey;
  if (originalJusoApiBaseUrl === undefined) delete process.env.JUSO_API_BASE_URL;
  else process.env.JUSO_API_BASE_URL = originalJusoApiBaseUrl;
});

describe('screening outcome matrix', () => {
  it.each(cases)(
    '$housingType $contractType $scope samples=$sampleCount complete=$searchComplete difference=$termDifferencePercent',
    async (testCase) => {
      if (testCase.scope === 'verifiedProperty') {
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
      } else {
        delete process.env.JUSO_API_KEY;
      }
      const deals = rentDeals(testCase);
      const client: MolitRentClient = {
        async searchRentComparables() {
          return {
            source: 'live',
            requiresLiveData: false,
            status: deals.length > 0 ? 'MATCHES_FOUND' : 'NO_MATCHES',
            reasonCode: deals.length > 0 ? 'MATCHES_FOUND' : 'NO_REPORTED_DEALS',
            retryable: false,
            nextActions: [],
            searchComplete: testCase.searchComplete,
            requestedMonthCount: 12,
            searchedMonthCount: testCase.searchComplete ? 12 : 3,
            dataNotice: '임대차 조회 완료',
            deals,
            totalMatched: deals.length,
            disclaimer: 'test disclaimer'
          };
        },
        async searchSaleComparables() {
          return saleResult(testCase.housingType);
        }
      };
      const multiplier = 1 + testCase.termDifferencePercent / 100;
      const result = await compareContractTerms(
        {
          address: '서울 강남구 역삼동',
          housingType: testCase.housingType,
          depositKrw:
            testCase.contractType === 'jeonse' ? Math.round(500_000_000 * multiplier) : 100_000_000,
          monthlyRentKrw:
            testCase.contractType === 'wolse' ? Math.round(1_000_000 * multiplier) : 0,
          areaM2: 60,
          complexName: testCase.scope === 'verifiedProperty' ? '역삼센트럴' : undefined
        },
        client,
        new Date('2026-07-08T00:00:00.000Z')
      );

      expect(result.screeningOutcome).toBe(expectedOutcome(testCase));
      if (testCase.scope === 'legalDong') {
        expect(result.comparisonScope).toBe('SAME_LEGAL_DONG');
        expect(result.screeningOutcome).not.toBe('NO_ADDITIONAL_PRICE_SIGNAL_FOUND');
      } else {
        expect(result.comparisonScope).toBe('SAME_REPORTED_PROPERTY');
      }
      if (testCase.sampleCount < 3) {
        expect(result.screeningOutcome).toBe('INSUFFICIENT_INFORMATION');
      }
    }
  );
});
