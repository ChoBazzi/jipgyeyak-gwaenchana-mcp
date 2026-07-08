import { describe, expect, it } from 'vitest';
import { detectPrecontractCheckSignals } from '../src/services/checkService.js';
import { SeedMolitRentClient } from '../src/services/molitClient.js';

describe('detectPrecontractCheckSignals', () => {
  it('uses checkSignals and itemsToVerify instead of deterministic risk labels', async () => {
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
      new SeedMolitRentClient()
    );

    expect(result.checkSignals.length).toBeGreaterThan(0);
    expect(result.itemsToVerify).toContain('등기부등본의 소유자, 근저당권, 압류/가압류 등 권리관계');
    expect(JSON.stringify(result)).not.toContain('riskSignals');
    expect(result.disclaimer).toContain('법률, 금융, 세무 또는 투자 조언이 아니며');
  });
});
