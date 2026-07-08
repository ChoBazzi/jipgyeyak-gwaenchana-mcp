import { describe, expect, it } from 'vitest';
import { resolveAddressRegion } from '../src/services/addressResolver.js';

describe('resolveAddressRegion', () => {
  it('returns a local lawdCode candidate with an explicit verification notice and disclaimer', () => {
    const result = resolveAddressRegion('서울 강남구 역삼동 123-4', 'apartment');

    expect(result.lawdCode).toBe('11680');
    expect(result.candidates[0]?.regionName).toBe('서울특별시 강남구');
    expect(result.source).toBe('local');
    expect(result.dataNotice).toContain('내장 행정구역 키워드');
    expect(result.disclaimer).toContain('법률, 금융, 세무 또는 투자 조언이 아니며');
  });

  it('resolves common Seoul area keywords without seed fixture data', () => {
    expect(resolveAddressRegion('성수에서 오피스텔 계약', 'officetel').lawdCode).toBe('11200');
    expect(resolveAddressRegion('종로구 빌라 월세', 'villa').lawdCode).toBe('11110');
  });

  it('does not invent a lawdCode for an unknown address', () => {
    const result = resolveAddressRegion('알 수 없는 주소');

    expect(result.lawdCode).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.dataNotice).toContain('정보가 부족합니다');
  });
});
