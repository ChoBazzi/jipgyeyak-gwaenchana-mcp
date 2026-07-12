import { afterEach, describe, expect, it, vi } from 'vitest';
import { FallbackMolitSaleClient, LiveMolitSaleClient } from '../src/services/molitSaleClient.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('LiveMolitSaleClient', () => {
  it('parses and filters same-building sale transactions', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          `<response><header><resultCode>000</resultCode></header><body><totalCount>2</totalCount><items>
            <item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><dealAmount>250,000</dealAmount><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>
            <item><aptNm>다른단지</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>2</dealDay><dealAmount>180,000</dealAmount><excluUseAr>84</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>
          </items></body></response>`,
          { status: 200 }
        )
    );
    globalThis.fetch = fetchMock;
    const client = new LiveMolitSaleClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchSaleComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      legalDongName: '대치동',
      complexName: '은마아파트',
      areaM2: 76,
      areaToleranceM2: 7,
      limit: 10
    });

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
      '/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'
    );
    expect(result).toMatchObject({ status: 'MATCHES_FOUND', searchComplete: true, totalMatched: 1 });
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]).toMatchObject({ complexName: '은마', salePriceKrw: 2_500_000_000, areaM2: 76 });
  });

  it('keeps searchComplete true when the requested limit is reached after the full requested period is read', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          '<response><header><resultCode>000</resultCode></header><body><numOfRows>1000</numOfRows><totalCount>1</totalCount><items><item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><dealAmount>250,000</dealAmount><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item></items></body></response>',
          { status: 200 }
        )
    );
    const client = new LiveMolitSaleClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchSaleComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      complexName: '은마',
      limit: 1
    });

    expect(result.deals).toHaveLength(1);
    expect(result.searchComplete).toBe(true);
  });

  it.each([
    ['officetel', '/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade'],
    ['villa', '/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade'],
    ['detachedMultiFamily', '/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade']
  ] as const)('uses the official %s sale endpoint', async (housingType, expectedPath) => {
    const fetchMock = vi.fn(
      async () =>
        new Response('<response><header><resultCode>03</resultCode></header><body><totalCount>0</totalCount></body></response>')
    );
    globalThis.fetch = fetchMock;
    const client = new LiveMolitSaleClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    await client.searchSaleComparables({
      lawdCode: '41135',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType,
      limit: 10
    });

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(expectedPath);
  });

  it('does not merge a numbered phase into the requested property name', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          '<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items><item><aptNm>역삼센트럴2차</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><dealAmount>100,000</dealAmount><excluUseAr>60</excluUseAr><sggCd>11680</sggCd><umdNm>역삼동</umdNm></item></items></body></response>',
          { status: 200 }
        )
    );
    const client = new LiveMolitSaleClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchSaleComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      complexName: '역삼센트럴',
      limit: 10
    });

    expect(result.deals).toEqual([]);
    expect(result.reasonCode).toBe('NO_COMPLEX_MATCH');
  });

  it('rejects XML without an official result code', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<response><body><totalCount>0</totalCount></body></response>'));
    const client = new LiveMolitSaleClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    await expect(
      client.searchSaleComparables({
        lawdCode: '11680',
        dealYmdFrom: '202607',
        dealYmdTo: '202607',
        housingType: 'apartment'
      })
    ).rejects.toThrow('resultCode');
  });

  it('rejects a page containing an unparseable transaction item', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          '<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items><item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><excluUseAr>76</excluUseAr></item></items></body></response>'
        )
    );
    const client = new LiveMolitSaleClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    await expect(
      client.searchSaleComparables({
        lawdCode: '11680',
        dealYmdFrom: '202607',
        dealYmdTo: '202607',
        housingType: 'apartment'
      })
    ).rejects.toThrow('unparseable');
  });

  it('rejects an empty page before the reported total count is exhausted', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          '<response><header><resultCode>000</resultCode></header><body><numOfRows>1</numOfRows><totalCount>1</totalCount><items /></body></response>'
        )
    );
    const client = new LiveMolitSaleClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    await expect(
      client.searchSaleComparables({
        lawdCode: '11680',
        dealYmdFrom: '202607',
        dealYmdTo: '202607',
        housingType: 'apartment'
      })
    ).rejects.toThrow('empty page');
  });

  it('keeps verified sale matches when another month in the batch times out', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const dealYmd = new URL(String(input)).searchParams.get('DEAL_YMD');
      if (dealYmd === '202607') {
        return new Response(
          '<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items><item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><dealAmount>250,000</dealAmount><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item></items></body></response>'
        );
      }
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const rejectOnAbort = () => reject(signal?.reason ?? new DOMException('timed out', 'TimeoutError'));
        if (signal?.aborted) return rejectOnAbort();
        signal?.addEventListener('abort', rejectOnAbort, { once: true });
      });
    });
    const client = new LiveMolitSaleClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000/',
      timeoutMs: 1000,
      totalTimeoutMs: 30
    });

    const result = await client.searchSaleComparables({
      lawdCode: '11680',
      dealYmdFrom: '202606',
      dealYmdTo: '202607',
      housingType: 'apartment',
      complexName: '은마',
      limit: 10
    });

    expect(result.deals).toHaveLength(1);
    expect(result.searchComplete).toBe(false);
    expect(result.searchedMonthCount).toBe(1);
  });
});

describe('FallbackMolitSaleClient', () => {
  it('returns a structured unavailable result when no API key is configured', async () => {
    const client = new FallbackMolitSaleClient({ baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchSaleComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      limit: 10
    });

    expect(result).toMatchObject({
      source: 'unavailable',
      status: 'LIVE_DATA_UNAVAILABLE',
      reasonCode: 'API_KEY_MISSING',
      retryable: false,
      deals: []
    });
  });

  it('classifies invalid input separately from an external API outage', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const client = new FallbackMolitSaleClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000/'
    });

    const result = await client.searchSaleComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      limit: 0
    });

    expect(result).toMatchObject({
      status: 'INVALID_REQUEST',
      reasonCode: 'INVALID_REQUEST',
      retryable: false,
      deals: []
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
