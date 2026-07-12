import { afterEach, describe, expect, it, vi } from 'vitest';
import { FallbackJusoAddressClient, LiveJusoAddressClient } from '../src/services/jusoAddressClient.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('LiveJusoAddressClient', () => {
  it('uses the current admCd for MOLIT lookup when bdMgtSn contains a legacy district code', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: {
                errorCode: '0',
                errorMessage: '정상',
                totalCount: '1'
              },
              juso: [
                {
                  roadAddr: '경기도 부천시 원미구 조마루로 135',
                  jibunAddr: '경기도 부천시 중동 1170',
                  bdNm: '포도마을',
                  siNm: '경기도',
                  sggNm: '부천시 원미구',
                  emdNm: '중동',
                  admCd: '4119210800',
                  bdMgtSn: '4119510800100011700000001'
                }
              ]
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    globalThis.fetch = fetchMock;

    const client = new LiveJusoAddressClient({
      apiKey: 'juso-key',
      baseUrl: 'https://business.juso.go.kr/addrlink/addrLinkApi.do',
      timeoutMs: 3000
    });

    const result = await client.searchAddress('부천 포도마을');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get('confmKey')).toBe('juso-key');
    expect(requestedUrl.searchParams.get('currentPage')).toBe('1');
    expect(requestedUrl.searchParams.get('countPerPage')).toBe('10');
    expect(requestedUrl.searchParams.get('keyword')).toBe('부천 포도마을');
    expect(requestedUrl.searchParams.get('resultType')).toBe('json');
    expect(result.candidates[0]).toMatchObject({
      lawdCode: '41192',
      legalDongCode: '4119210800',
      regionName: '경기도 부천시 원미구',
      sido: '경기도',
      sigungu: '부천시 원미구',
      eupmyeondong: '중동',
      roadAddress: '경기도 부천시 원미구 조마루로 135',
      jibunAddress: '경기도 부천시 중동 1170',
      buildingName: '포도마을',
      source: 'juso'
    });
    expect(result.candidates[0]?.matchReason).toContain('admCd');
    expect(result).toMatchObject({ status: 'MATCHES_FOUND', reasonCode: 'MATCHES_FOUND', retryable: false });
    expect(result.dataNotice).toContain('도로명주소');
  });

  it('falls back to admCd when bdMgtSn cannot provide lawdCode', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: { errorCode: '0', totalCount: '1' },
              juso: [
                {
                  roadAddr: '서울특별시 강남구 테헤란로 1',
                  jibunAddr: '서울특별시 강남구 역삼동 1',
                  bdNm: '',
                  siNm: '서울특별시',
                  sggNm: '강남구',
                  emdNm: '역삼동',
                  admCd: '1168010100',
                  bdMgtSn: ''
                }
              ]
            }
          }),
          { status: 200 }
        )
    );

    const client = new LiveJusoAddressClient({
      apiKey: 'juso-key',
      baseUrl: 'https://business.juso.go.kr/addrlink/addrLinkApi.do',
      timeoutMs: 3000
    });

    const result = await client.searchAddress('강남 역삼동');

    expect(result.candidates[0]?.lawdCode).toBe('11680');
    expect(result.candidates[0]?.matchReason).toContain('admCd');
  });

  it('distinguishes a successful address no-match from an API failure', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: {
              common: { errorCode: '0', errorMessage: '정상', totalCount: '0' },
              juso: []
            }
          }),
          { status: 200 }
        )
    );
    const client = new LiveJusoAddressClient({
      apiKey: 'juso-key',
      baseUrl: 'https://business.juso.go.kr/addrlink/addrLinkApi.do',
      timeoutMs: 3000
    });

    const result = await client.searchAddress('존재하지 않는 주소');

    expect(result).toMatchObject({
      candidates: [],
      status: 'NO_MATCHES',
      reasonCode: 'NO_ADDRESS_MATCH',
      retryable: false
    });
  });
});

describe('FallbackJusoAddressClient', () => {
  it('returns empty candidates when no API key is configured', async () => {
    const client = new FallbackJusoAddressClient({});

    const result = await client.searchAddress('부천 포도마을');

    expect(result.candidates).toEqual([]);
    expect(result).toMatchObject({
      status: 'LIVE_DATA_UNAVAILABLE',
      reasonCode: 'API_KEY_MISSING',
      retryable: false
    });
    expect(result.dataNotice).toContain('JUSO_API_KEY가 없어');
  });

  it('returns empty candidates when the live Juso API fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('service error', { status: 500 }));
    const client = new FallbackJusoAddressClient({
      apiKey: 'juso-key',
      baseUrl: 'https://business.juso.go.kr/addrlink/addrLinkApi.do',
      timeoutMs: 3000
    });

    const result = await client.searchAddress('부천 포도마을');

    expect(result.candidates).toEqual([]);
    expect(result).toMatchObject({
      status: 'LIVE_DATA_UNAVAILABLE',
      reasonCode: 'API_HTTP_ERROR',
      retryable: true
    });
    expect(result.dataNotice).toContain('도로명주소 API 조회가 실패');
  });
});
