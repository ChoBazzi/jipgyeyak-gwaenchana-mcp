import { describe, expect, it } from 'vitest';
import { assertValidDealYmdRange, isValidDealYmd, subtractMonths, toDealYmd } from '../src/utils/date.js';

describe('date utilities', () => {
  it('clamps month-end subtraction to the last valid day of the target month', () => {
    expect(subtractMonths(new Date('2026-03-31T00:00:00.000Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(subtractMonths(new Date('2024-03-31T00:00:00.000Z'), 1).toISOString().slice(0, 10)).toBe('2024-02-29');
    expect(toDealYmd(subtractMonths(new Date('2026-03-31T00:00:00.000Z'), 1))).toBe('202602');
  });

  it('validates calendar months and chronological ranges', () => {
    expect(isValidDealYmd('202601')).toBe(true);
    expect(isValidDealYmd('202612')).toBe(true);
    expect(isValidDealYmd('202600')).toBe(false);
    expect(isValidDealYmd('202613')).toBe(false);
    expect(isValidDealYmd('20261')).toBe(false);
    expect(() => assertValidDealYmdRange('202601', '202612')).not.toThrow();
    expect(() => assertValidDealYmdRange('202613', '202613')).toThrow('YYYYMM');
    expect(() => assertValidDealYmdRange('202607', '202606')).toThrow('시작 월');
  });
});
