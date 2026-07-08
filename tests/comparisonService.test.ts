import { describe, expect, it } from 'vitest';
import { compareContractTerms } from '../src/services/comparisonService.js';
import { SeedMolitRentClient } from '../src/services/molitClient.js';

describe('compareContractTerms', () => {
  it('compares contract terms against seed comparables without presenting them as live data', async () => {
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
      new SeedMolitRentClient(),
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(result.sampleCount).toBe(2);
    expect(result.comparableSource).toBe('seed');
    expect(result.depositKrw.median).toBe(290000000);
    expect(result.monthlyRentKrw.median).toBe(1975000);
    expect(result.dataNotice).toContain('MVP seed data');
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
      new SeedMolitRentClient(),
      new Date('2026-07-08T00:00:00.000Z')
    );

    expect(result.sampleCount).toBe(0);
    expect(result.addressResolution.lawdCode).toBeNull();
    expect(result.comparisonSummary).toContain('유사 거래 비교를 수행하지 못했습니다');
  });
});
