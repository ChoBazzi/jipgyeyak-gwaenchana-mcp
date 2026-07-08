import { describe, expect, it } from 'vitest';
import { resolveAddressRegion } from '../src/services/addressResolver.js';

describe('resolveAddressRegion', () => {
  it('returns a seed lawdCode candidate with an explicit seed notice and disclaimer', () => {
    const result = resolveAddressRegion('서울 강남구 역삼동 123-4', 'apartment');

    expect(result.lawdCode).toBe('11680');
    expect(result.candidates[0]?.regionName).toBe('서울특별시 강남구 역삼동');
    expect(result.source).toBe('seed');
    expect(result.dataNotice).toContain('seed');
    expect(result.disclaimer).toContain('법률, 금융, 세무 또는 투자 조언이 아니며');
  });

  it('does not invent a lawdCode for an unknown address', () => {
    const result = resolveAddressRegion('알 수 없는 주소');

    expect(result.lawdCode).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.dataNotice).toContain('seed lookup');
  });
});
