import { describe, expect, it } from 'vitest';
import type { ComparableSearchResult, RentDeal } from '../src/domain/types.js';
import { compareContractTerms } from '../src/services/comparisonService.js';
import type { MolitRentClient } from '../src/services/molitClient.js';

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

describe('compareContractTerms', () => {
  it('compares contract terms against live comparables', async () => {
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
    expect(result.dataNotice).not.toContain('seed');
    expect(result.disclaimer).toContain('계약 전 확인을 돕는 정보');
  });

  it('returns an explicit no-match summary when address resolution fails', async () => {
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
