import { afterEach, describe, expect, it } from 'vitest';
import type { ComparableSearchResult } from '../src/domain/types.js';
import { detectPrecontractCheckSignals } from '../src/services/checkService.js';
import type { MolitRentClient } from '../src/services/molitClient.js';

const originalJusoApiKey = process.env.JUSO_API_KEY;

function mockRentClient(result: ComparableSearchResult): MolitRentClient {
  return {
    async searchRentComparables() {
      return result;
    }
  };
}

afterEach(() => {
  if (originalJusoApiKey === undefined) {
    delete process.env.JUSO_API_KEY;
  } else {
    process.env.JUSO_API_KEY = originalJusoApiKey;
  }
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
    expect(result.checkSignals.map((signal) => signal.code)).toContain('DEPOSIT_OUTSIDE_COMPARABLE_RANGE');
    expect(result.itemsToVerify).toContain('등기부등본의 소유자, 근저당권, 압류/가압류 등 권리관계');
    expect(JSON.stringify(result)).not.toContain('riskSignals');
    expect(JSON.stringify(result)).not.toContain('SEED');
    expect(result.disclaimer).toContain('법률, 금융, 세무 또는 투자 조언이 아니며');
  });
});
