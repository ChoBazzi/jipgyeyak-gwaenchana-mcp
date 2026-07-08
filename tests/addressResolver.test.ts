import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAddressRegion } from '../src/services/addressResolver.js';

const originalFetch = globalThis.fetch;
const originalJusoApiKey = process.env.JUSO_API_KEY;
const originalJusoApiBaseUrl = process.env.JUSO_API_BASE_URL;
const originalJusoApiTimeoutMs = process.env.JUSO_API_TIMEOUT_MS;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  if (originalJusoApiKey === undefined) {
    delete process.env.JUSO_API_KEY;
  } else {
    process.env.JUSO_API_KEY = originalJusoApiKey;
  }
  if (originalJusoApiBaseUrl === undefined) {
    delete process.env.JUSO_API_BASE_URL;
  } else {
    process.env.JUSO_API_BASE_URL = originalJusoApiBaseUrl;
  }
  if (originalJusoApiTimeoutMs === undefined) {
    delete process.env.JUSO_API_TIMEOUT_MS;
  } else {
    process.env.JUSO_API_TIMEOUT_MS = originalJusoApiTimeoutMs;
  }
});

describe('resolveAddressRegion', () => {
  it('returns a local lawdCode candidate with an explicit verification notice and disclaimer', async () => {
    delete process.env.JUSO_API_KEY;
    const result = await resolveAddressRegion('서울 강남구 역삼동 123-4', 'apartment');

    expect(result.lawdCode).toBe('11680');
    expect(result.candidates[0]?.regionName).toBe('서울특별시 강남구');
    expect(result.source).toBe('local');
    expect(result.dataNotice).toContain('내장 행정구역 키워드');
    expect(result.disclaimer).toContain('법률, 금융, 세무 또는 투자 조언이 아니며');
  });

  it('resolves common Seoul area keywords without seed fixture data', async () => {
    delete process.env.JUSO_API_KEY;
    await expect(resolveAddressRegion('성수에서 오피스텔 계약', 'officetel')).resolves.toMatchObject({ lawdCode: '11200' });
    await expect(resolveAddressRegion('종로구 빌라 월세', 'villa')).resolves.toMatchObject({ lawdCode: '11110' });
  });

  it('uses Juso address candidates before local keyword mapping', async () => {
    process.env.JUSO_API_KEY = 'juso-key';
    process.env.JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: { errorCode: '0', errorMessage: '정상', totalCount: '1' },
              juso: [
                {
                  roadAddr: '경기도 부천시 원미구 조마루로 135',
                  jibunAddr: '경기도 부천시 중동 1170',
                  bdNm: '포도마을',
                  siNm: '경기도',
                  sggNm: '부천시',
                  emdNm: '중동',
                  admCd: '4119010900',
                  bdMgtSn: '4119010900100011700000001'
                }
              ]
            }
          }),
          { status: 200 }
        )
    );

    const result = await resolveAddressRegion('부천 포도마을', 'apartment');

    expect(result.source).toBe('juso');
    expect(result.lawdCode).toBe('41190');
    expect(result.normalizedRegionName).toBe('경기도 부천시');
    expect(result.candidates[0]?.matchReason).toContain('도로명주소 API');
    expect(result.dataNotice).toContain('도로명주소');
  });

  it('prefers the Pangyo local intent when Juso matches Anyang Pangyo-ro instead', async () => {
    process.env.JUSO_API_KEY = 'juso-key';
    process.env.JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: { errorCode: '0', errorMessage: '정상', totalCount: '1' },
              juso: [
                {
                  roadAddr: '경기도 안양시 동안구 안양판교로 20 (관양동)',
                  jibunAddr: '경기도 안양시 동안구 관양동 1505-29 신한데뷰오피스텔',
                  bdNm: '신한데뷰오피스텔',
                  siNm: '경기도',
                  sggNm: '안양시 동안구',
                  emdNm: '관양동',
                  admCd: '4117310200',
                  bdMgtSn: '4117310200115050029003477'
                }
              ]
            }
          }),
          { status: 200 }
        )
    );

    const result = await resolveAddressRegion('판교 오피스텔', 'officetel');

    expect(result.source).toBe('local');
    expect(result.lawdCode).toBe('41135');
    expect(result.normalizedRegionName).toBe('경기도 성남시 분당구');
    expect(result.dataNotice).toContain('지역 의도와 달라');
  });

  it('keeps a Juso candidate when the user explicitly enters Anyang Pangyo-ro', async () => {
    process.env.JUSO_API_KEY = 'juso-key';
    process.env.JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: { errorCode: '0', errorMessage: '정상', totalCount: '1' },
              juso: [
                {
                  roadAddr: '경기도 안양시 동안구 안양판교로 20 (관양동)',
                  jibunAddr: '경기도 안양시 동안구 관양동 1505-29 신한데뷰오피스텔',
                  bdNm: '신한데뷰오피스텔',
                  siNm: '경기도',
                  sggNm: '안양시 동안구',
                  emdNm: '관양동',
                  admCd: '4117310200',
                  bdMgtSn: '4117310200115050029003477'
                }
              ]
            }
          }),
          { status: 200 }
        )
    );

    const result = await resolveAddressRegion('경기도 안양시 동안구 안양판교로 20', 'officetel');

    expect(result.source).toBe('juso');
    expect(result.lawdCode).toBe('41173');
    expect(result.normalizedRegionName).toBe('경기도 안양시 동안구');
  });

  it('falls back to local keyword mapping when Juso API key is missing', async () => {
    delete process.env.JUSO_API_KEY;

    const result = await resolveAddressRegion('서울 강남구 역삼동 123-4', 'apartment');

    expect(result.source).toBe('local');
    expect(result.lawdCode).toBe('11680');
    expect(result.dataNotice).toContain('JUSO_API_KEY가 없어');
    expect(result.dataNotice).toContain('내장 행정구역 키워드');
  });

  it('falls back to local keyword mapping without fake candidates when Juso API fails', async () => {
    process.env.JUSO_API_KEY = 'juso-key';
    globalThis.fetch = vi.fn(async () => new Response('service error', { status: 500 }));

    const result = await resolveAddressRegion('서울 강남구 역삼동 123-4', 'apartment');

    expect(result.source).toBe('local');
    expect(result.lawdCode).toBe('11680');
    expect(result.candidates).toHaveLength(1);
    expect(result.dataNotice).toContain('도로명주소 API 조회가 실패');
    expect(result.dataNotice).toContain('내장 행정구역 키워드');
  });

  it('does not invent a lawdCode for an unknown address', async () => {
    delete process.env.JUSO_API_KEY;
    const result = await resolveAddressRegion('알 수 없는 주소');

    expect(result.lawdCode).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.dataNotice).toContain('정보가 부족합니다');
  });
});
