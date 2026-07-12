import { describe, expect, it } from 'vitest';
import { reportedPropertyNamesMatch } from '../src/utils/propertyName.js';

describe('reportedPropertyNamesMatch', () => {
  it('allows a geographic station qualifier around a distinctive Latin brand', () => {
    expect(reportedPropertyNamesMatch('SK HUB 오피스텔', '판교역 SK HUB')).toBe(true);
  });

  it.each([
    ['HILLSTATE', '더샵 HILLSTATE'],
    ['SK VIEW', '롯데 SK VIEW']
  ])('rejects an unrelated Korean co-brand: %s / %s', (requested, actual) => {
    expect(reportedPropertyNamesMatch(requested, actual)).toBe(false);
  });

  it('matches the same numbered phase but not a missing phase', () => {
    expect(reportedPropertyNamesMatch('대우마리나1차아파트', '대우마리나1')).toBe(true);
    expect(reportedPropertyNamesMatch('대우마리나', '대우마리나1')).toBe(false);
  });
});
