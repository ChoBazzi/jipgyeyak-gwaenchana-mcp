import { afterEach, describe, expect, it, vi } from 'vitest';
import { FallbackMolitRentClient, LiveMolitRentClient } from '../src/services/molitClient.js';

const originalFetch = globalThis.fetch;

const filterStatsXml = `
  <response><header><resultCode>000</resultCode></header><body><totalCount>4</totalCount><items>
    <item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><deposit>100,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>59</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>
    <item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>2</dealDay><deposit>120,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>84</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>
    <item><aptNm>다른단지</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>3</dealDay><deposit>80,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>59</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>
    <item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>4</dealDay><deposit>10,000</deposit><monthlyRent>300</monthlyRent><excluUseAr>59</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>
  </items></body></response>`;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('LiveMolitRentClient', () => {
  it('uses an abort signal for every MOLIT request', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response('<response><header><resultCode>000</resultCode></header><body><items /></body></response>', {
        status: 200
      });
    });
    globalThis.fetch = fetchMock;

    const client = new LiveMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000/',
      timeoutMs: 5000
    });
    await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      limit: 20
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-XML gateway payload instead of reporting a successful empty search', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html><body>gateway error</body></html>', { status: 200 }));
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    await expect(
      client.searchRentComparables({
        lawdCode: '11680',
        dealYmdFrom: '202607',
        dealYmdTo: '202607',
        housingType: 'apartment',
        limit: 20
      })
    ).rejects.toThrow('invalid XML response');
  });

  it('follows pagination metadata before filtering and returning the requested limit', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const pageNo = new URL(String(input)).searchParams.get('pageNo');
      const item =
        pageNo === '1'
          ? `<item><aptNm>다른단지</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><deposit>20,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>`
          : `<item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>2</dealDay><deposit>100,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>`;

      return new Response(
        `<response><header><resultCode>000</resultCode></header><body><pageNo>${pageNo}</pageNo><numOfRows>1</numOfRows><totalCount>2</totalCount><items>${item}</items></body></response>`,
        { status: 200 }
      );
    });
    globalThis.fetch = fetchMock;

    const client = new LiveMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000/'
    });
    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      complexName: '은마',
      limit: 1
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('pageNo'))).toEqual(['1', '2']);
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]?.complexName).toBe('은마');
  });

  it('stops paging within a month once enough filtered comparables are collected', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const pageNo = new URL(String(input)).searchParams.get('pageNo');
      return new Response(
        `<response><header><resultCode>000</resultCode></header><body><pageNo>${pageNo}</pageNo><numOfRows>1</numOfRows><totalCount>100</totalCount><items><item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><deposit>100,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item></items></body></response>`,
        { status: 200 }
      );
    });
    globalThis.fetch = fetchMock;
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      complexName: '은마',
      limit: 1
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.deals).toHaveLength(1);
    expect(result.searchComplete).toBe(false);
    expect(result.dataNotice).toContain('요청 기간 전체 건수는 아닙니다');
  });

  it('rejects an empty page that appears before the reported total count is exhausted', async () => {
    const requestedPages: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const pageNo = new URL(String(input)).searchParams.get('pageNo') ?? '';
      requestedPages.push(pageNo);
      const item =
        pageNo === '1'
          ? '<item><aptNm>다른단지</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><deposit>20,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>'
          : '';
      return new Response(
        `<response><header><resultCode>000</resultCode></header><body><pageNo>${pageNo}</pageNo><numOfRows>1</numOfRows><totalCount>3</totalCount><items>${item}</items></body></response>`,
        { status: 200 }
      );
    });

    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });
    await expect(
      client.searchRentComparables({
        lawdCode: '11680',
        dealYmdFrom: '202607',
        dealYmdTo: '202607',
        housingType: 'apartment',
        complexName: '은마',
        limit: 20
      })
    ).rejects.toThrow('empty page before');
    expect(requestedPages).toEqual(['1', '2']);
  });

  it('rejects invalid and reversed deal month ranges before making a request', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    await expect(
      client.searchRentComparables({
        lawdCode: '11680',
        dealYmdFrom: '202613',
        dealYmdTo: '202613',
        housingType: 'apartment'
      })
    ).rejects.toThrow('YYYYMM');
    await expect(
      client.searchRentComparables({
        lawdCode: '11680',
        dealYmdFrom: '202607',
        dealYmdTo: '202606',
        housingType: 'apartment'
      })
    ).rejects.toThrow('시작 월');
    await expect(
      client.searchRentComparables({
        lawdCode: '11680',
        dealYmdFrom: '202507',
        dealYmdTo: '202607',
        housingType: 'apartment'
      })
    ).rejects.toThrow('최대 12개월');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches newest months first and stops after enough recent comparables are found', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const dealYmd = new URL(String(input)).searchParams.get('DEAL_YMD') ?? '';
      const year = dealYmd.slice(0, 4);
      const month = String(Number(dealYmd.slice(4, 6)));
      return new Response(
        `<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items><item><aptNm>은마</aptNm><dealYear>${year}</dealYear><dealMonth>${month}</dealMonth><dealDay>1</dealDay><deposit>100,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item></items></body></response>`,
        { status: 200 }
      );
    });
    globalThis.fetch = fetchMock;

    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });
    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202604',
      dealYmdTo: '202607',
      housingType: 'apartment',
      complexName: '은마',
      limit: 2
    });

    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('DEAL_YMD'))).toEqual([
      '202607',
      '202606'
    ]);
    expect(result.deals.map((deal) => deal.contractDate)).toEqual(['2026-07-01', '2026-06-01']);
    expect(result.searchComplete).toBe(false);
    expect(result.requestedMonthCount).toBe(4);
    expect(result.searchedMonthCount).toBe(2);
    expect(result.dataNotice).toContain('최신 월부터');
  });

  it('returns verified partial matches when the overall deadline expires during older-month expansion', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const dealYmd = new URL(String(input)).searchParams.get('DEAL_YMD');
      if (dealYmd === '202612') {
        return new Response(
          '<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items><item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>12</dealMonth><dealDay>1</dealDay><deposit>100,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item></items></body></response>',
          { status: 200 }
        );
      }

      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const rejectOnAbort = () => reject(signal?.reason ?? new DOMException('timed out', 'TimeoutError'));
        if (signal?.aborted) return rejectOnAbort();
        signal?.addEventListener('abort', rejectOnAbort, { once: true });
      });
    });
    const client = new LiveMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000/',
      timeoutMs: 1000,
      totalTimeoutMs: 30
    });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202601',
      dealYmdTo: '202612',
      housingType: 'apartment',
      complexName: '은마',
      areaM2: 76,
      limit: 10
    });

    expect(result).toMatchObject({
      source: 'live',
      status: 'MATCHES_FOUND',
      reasonCode: 'MATCHES_FOUND',
      searchComplete: false,
      searchedMonthCount: 1,
      totalMatched: 1
    });
    expect(result.deals).toHaveLength(1);
    expect(result.dataNotice).toContain('요청 기간 전체 건수는 아닙니다');
  });

  it.each([['은마아파트', '은마']])('matches normalized complex-name variations: %s -> %s', async (requestedName, apiName) => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<response><header><resultCode>000</resultCode></header><body><pageNo>1</pageNo><numOfRows>1000</numOfRows><totalCount>1</totalCount><items><item><offiNm>${apiName}</offiNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>2</dealDay><deposit>20,000</deposit><monthlyRent>100</monthlyRent><excluUseAr>30</excluUseAr><sggCd>41135</sggCd><umdNm>백현동</umdNm></item></items></body></response>`,
          { status: 200 }
        )
    );

    const client = new LiveMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000/'
    });
    const result = await client.searchRentComparables({
      lawdCode: '41135',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'officetel',
      complexName: requestedName,
      limit: 20
    });

    expect(result.deals.map((deal) => deal.complexName)).toEqual([apiName]);
  });

  it('does not treat a location plus generic housing type as a specific complex name', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          '<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items><item><offiNm>판교역 푸르지오시티</offiNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>2</dealDay><deposit>20,000</deposit><monthlyRent>100</monthlyRent><excluUseAr>30</excluUseAr><sggCd>41135</sggCd><umdNm>백현동</umdNm></item></items></body></response>',
          { status: 200 }
        )
    );
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchRentComparables({
      lawdCode: '41135',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'officetel',
      complexName: '판교 오피스텔',
      limit: 20
    });

    expect(result.deals).toEqual([]);
    expect(result.reasonCode).toBe('NO_COMPLEX_MATCH');
  });

  it('filters district results to the resolved legal dong before applying area filters', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<response><header><resultCode>000</resultCode></header><body><totalCount>2</totalCount><items>
            <item><aptNm>역삼센트럴</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><deposit>50,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>60</excluUseAr><sggCd>11680</sggCd><umdNm>역삼동</umdNm></item>
            <item><aptNm>대치센트럴</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>2</dealDay><deposit>60,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>60</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>
          </items></body></response>`,
          { status: 200 }
        )
    );
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      legalDongName: '역삼동',
      areaM2: 60,
      areaToleranceM2: 6,
      limit: 20
    });

    expect(result.deals.map((deal) => deal.regionName)).toEqual(['역삼동']);
    expect(result.filterStats?.afterLegalDong).toBe(1);
  });

  it('does not merge shorter or numbered-phase property names', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<response><header><resultCode>000</resultCode></header><body><totalCount>2</totalCount><items>
            <item><aptNm>대우</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><deposit>30,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>84</excluUseAr><sggCd>26350</sggCd><umdNm>우동</umdNm></item>
            <item><aptNm>대우마리나1</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>2</dealDay><deposit>50,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>84</excluUseAr><sggCd>26350</sggCd><umdNm>우동</umdNm></item>
          </items></body></response>`,
          { status: 200 }
        )
    );

    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });
    const result = await client.searchRentComparables({
      lawdCode: '26350',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      complexName: '대우마리나',
      limit: 20
    });

    expect(result.deals).toEqual([]);
    expect(result.reasonCode).toBe('NO_COMPLEX_MATCH');
  });

  it('matches the same numbered phase when Juso uses the 차 suffix', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<response><header><resultCode>000</resultCode></header><body><totalCount>2</totalCount><items>
            <item><aptNm>대우마리나1</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>2</dealDay><deposit>50,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>84</excluUseAr><sggCd>26350</sggCd><umdNm>우동</umdNm></item>
            <item><aptNm>대우마리나3</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>3</dealDay><deposit>30,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>84</excluUseAr><sggCd>26350</sggCd><umdNm>우동</umdNm></item>
          </items></body></response>`,
          { status: 200 }
        )
    );

    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });
    const result = await client.searchRentComparables({
      lawdCode: '26350',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      complexName: '대우마리나1차아파트',
      limit: 20
    });

    expect(result.deals.map((deal) => deal.complexName)).toEqual(['대우마리나1']);
  });

  it('matches a Juso building name to a MOLIT name with a Korean location qualifier', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items>
            <item><offiNm>판교역 SK HUB</offiNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>8</dealDay><deposit>25,700</deposit><monthlyRent>11</monthlyRent><excluUseAr>31.15</excluUseAr><sggCd>41135</sggCd><umdNm>백현동</umdNm></item>
          </items></body></response>`,
          { status: 200 }
        )
    );

    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });
    const result = await client.searchRentComparables({
      lawdCode: '41135',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'officetel',
      contractType: 'wolse',
      legalDongName: '백현동',
      complexName: 'SK HUB 오피스텔',
      limit: 5
    });

    expect(result).toMatchObject({ status: 'MATCHES_FOUND', reasonCode: 'MATCHES_FOUND' });
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]?.complexName).toBe('판교역 SK HUB');
  });

  it('counts byte-equivalent duplicate rental rows only once', async () => {
    const duplicatedItem =
      '<item><aptNm>해운대엑소디움</aptNm><contractTerm>26.02~28.02</contractTerm><contractType>신규</contractType><dealYear>2025</dealYear><dealMonth>12</dealMonth><dealDay>30</dealDay><deposit>80,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>181.774</excluUseAr><floor>17</floor><buildYear>2009</buildYear><sggCd>26350</sggCd><umdNm>우동</umdNm></item>';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<response><header><resultCode>000</resultCode></header><body><totalCount>2</totalCount><items>${duplicatedItem}${duplicatedItem}</items></body></response>`,
          { status: 200 }
        )
    );
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchRentComparables({
      lawdCode: '26350',
      dealYmdFrom: '202512',
      dealYmdTo: '202512',
      housingType: 'apartment',
      contractType: 'jeonse',
      legalDongName: '우동',
      complexName: '해운대엑소디움',
      areaM2: 188,
      areaToleranceM2: 7,
      limit: 5
    });

    expect(result.deals).toHaveLength(1);
    expect(result.totalMatched).toBe(1);
    expect(result.filterStats?.raw).toBe(1);
  });

  it('counts byte-equivalent duplicate rental rows across pages only once', async () => {
    const duplicatedItem =
      '<item><aptNm>해운대엑소디움</aptNm><contractTerm>26.02~28.02</contractTerm><contractType>신규</contractType><dealYear>2025</dealYear><dealMonth>12</dealMonth><dealDay>30</dealDay><deposit>80,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>181.774</excluUseAr><floor>17</floor><buildYear>2009</buildYear><sggCd>26350</sggCd><umdNm>우동</umdNm></item>';
    const fetchMock = vi.fn(
      async (input: string | URL | Request) =>
        new Response(
          `<response><header><resultCode>000</resultCode></header><body><pageNo>${new URL(String(input)).searchParams.get('pageNo')}</pageNo><numOfRows>1</numOfRows><totalCount>2</totalCount><items>${duplicatedItem}</items></body></response>`,
          { status: 200 }
        )
    );
    globalThis.fetch = fetchMock;
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchRentComparables({
      lawdCode: '26350',
      dealYmdFrom: '202512',
      dealYmdTo: '202512',
      housingType: 'apartment',
      contractType: 'jeonse',
      legalDongName: '우동',
      complexName: '해운대엑소디움',
      areaM2: 188,
      areaToleranceM2: 7,
      limit: 5
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.deals).toHaveLength(1);
    expect(result.totalMatched).toBe(1);
    expect(result.filterStats?.raw).toBe(1);
    expect(result.searchComplete).toBe(true);
  });

  it('filters jeonse and wolse deals separately when contractType is provided', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<response><header><resultCode>000</resultCode></header><body><totalCount>2</totalCount><items>
            <item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay><deposit>100,000</deposit><monthlyRent>0</monthlyRent><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>
            <item><aptNm>은마</aptNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>2</dealDay><deposit>10,000</deposit><monthlyRent>300</monthlyRent><excluUseAr>76</excluUseAr><sggCd>11680</sggCd><umdNm>대치동</umdNm></item>
          </items></body></response>`,
          { status: 200 }
        )
    );

    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });
    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      contractType: 'jeonse',
      limit: 20
    });

    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]?.contractType).toBe('jeonse');
  });

  it('returns machine-readable status and counts after each comparable filter', async () => {
    globalThis.fetch = vi.fn(async () => new Response(filterStatsXml, { status: 200 }));
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      contractType: 'jeonse',
      complexName: '은마아파트',
      areaM2: 60,
      areaToleranceM2: 2,
      limit: 20
    });

    expect(result).toMatchObject({
      status: 'MATCHES_FOUND',
      reasonCode: 'MATCHES_FOUND',
      retryable: false,
      filterStats: { raw: 4, afterContractType: 3, afterComplexName: 2, afterArea: 1 },
      nextActions: []
    });
    expect(result.deals).toHaveLength(1);
  });

  it('explains which filter removed all otherwise available deals', async () => {
    globalThis.fetch = vi.fn(async () => new Response(filterStatsXml, { status: 200 }));
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      contractType: 'jeonse',
      complexName: '은마',
      areaM2: 120,
      areaToleranceM2: 2,
      limit: 20
    });

    expect(result).toMatchObject({
      status: 'NO_MATCHES',
      reasonCode: 'NO_AREA_MATCH',
      retryable: false,
      filterStats: { raw: 4, afterContractType: 3, afterComplexName: 2, afterArea: 0 }
    });
    expect(result.nextActions).toContain('면적 허용 범위를 넓혀 다시 조회하세요.');
    expect(result.nextActions[0]).toContain('전용면적');
  });

  it('does not claim that a complex-name filter was applied when it was omitted', async () => {
    globalThis.fetch = vi.fn(async () => new Response(filterStatsXml, { status: 200 }));
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      contractType: 'jeonse',
      legalDongName: '대치동',
      areaM2: 120,
      areaToleranceM2: 2,
      limit: 20
    });

    expect(result.reasonCode).toBe('NO_AREA_MATCH');
    expect(result.dataNotice).toContain('법정동 조건까지 맞는 자료');
    expect(result.dataNotice).not.toContain('단지명 조건');
  });

  it.each([
    {
      title: 'the requested contract type has no matches',
      xml: filterStatsXml.replace('<monthlyRent>300</monthlyRent>', '<monthlyRent>0</monthlyRent>'),
      filters: { contractType: 'wolse' as const },
      reasonCode: 'NO_CONTRACT_TYPE_MATCH',
      filterStats: { raw: 4, afterContractType: 0, afterComplexName: 0, afterArea: 0 },
      nextAction: '전세 또는 월세 조건이 맞는지 확인해 다시 조회하세요.'
    },
    {
      title: 'the requested complex has no matches',
      xml: filterStatsXml,
      filters: { contractType: 'jeonse' as const, complexName: '없는단지' },
      reasonCode: 'NO_COMPLEX_MATCH',
      filterStats: { raw: 4, afterContractType: 3, afterComplexName: 0, afterArea: 0 },
      nextAction: '단지명을 빼거나 공식 단지명으로 바꿔 다시 조회하세요.'
    },
    {
      title: 'the region and period have no reported deals',
      xml: '<response><header><resultCode>000</resultCode></header><body><totalCount>0</totalCount><items /></body></response>',
      filters: {},
      reasonCode: 'NO_REPORTED_DEALS',
      filterStats: { raw: 0, afterContractType: 0, afterComplexName: 0, afterArea: 0 },
      nextAction: '조회 기간을 넓혀 다시 조회하세요.'
    }
  ])('returns a specific no-match reason when $title', async ({ xml, filters, reasonCode, filterStats, nextAction }) => {
    globalThis.fetch = vi.fn(async () => new Response(xml, { status: 200 }));
    const client = new LiveMolitRentClient({ apiKey: 'key', baseUrl: 'https://apis.data.go.kr/1613000/' });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      limit: 20,
      ...filters
    });

    expect(result).toMatchObject({
      status: 'NO_MATCHES',
      reasonCode,
      retryable: false,
      filterStats
    });
    expect(result.nextActions).toContain(nextAction);
  });

  it('builds housing-type endpoint URLs from the service root and calls each requested month', async () => {
    const fetchMock = vi.fn(async () => new Response('<response><body><items /></body></response>', { status: 200 }));
    globalThis.fetch = fetchMock;

    const client = new LiveMolitRentClient({
      apiKey: 'encoded-key',
      baseUrl: 'https://apis.data.go.kr/1613000'
    });

    await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202605',
      dealYmdTo: '202607',
      housingType: 'officetel',
      limit: 20
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requestedUrls = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    expect(requestedUrls.map((url) => url.pathname)).toEqual([
      '/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent',
      '/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent',
      '/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent'
    ]);
    expect(requestedUrls.map((url) => url.searchParams.get('DEAL_YMD'))).toEqual(['202607', '202606', '202605']);
    for (const url of requestedUrls) {
      expect(url.searchParams.get('serviceKey')).toBe('encoded-key');
      expect(url.searchParams.get('LAWD_CD')).toBe('11680');
      expect(url.searchParams.get('pageNo')).toBe('1');
      expect(url.searchParams.get('numOfRows')).toBe('1000');
      expect(url.searchParams.has('DEAL_YMD_FROM')).toBe(false);
      expect(url.searchParams.has('DEAL_YMD_TO')).toBe(false);
      expect(url.searchParams.has('housingType')).toBe(false);
    }
  });

  it('parses MOLIT XML items into live rent deals', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <response>
            <body>
              <items>
                <item>
                  <지역코드>11680</지역코드>
                  <법정동> 역삼동 </법정동>
                  <아파트>역삼센트럴</아파트>
                  <년>2026</년>
                  <월>7</월>
                  <일>3</일>
                  <전용면적>59.84</전용면적>
                  <보증금액>29,000</보증금액>
                  <월세금액>195</월세금액>
                  <층>10</층>
                  <건축년도>2018</건축년도>
                </item>
              </items>
            </body>
          </response>`,
          { status: 200, headers: { 'content-type': 'application/xml' } }
        )
    );

    const client = new LiveMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000/'
    });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      limit: 20
    });

    expect(result.source).toBe('live');
    expect(result.totalMatched).toBe(1);
    expect(result.deals[0]).toMatchObject({
      lawdCode: '11680',
      regionName: '역삼동',
      housingType: 'apartment',
      contractDate: '2026-07-03',
      contractType: 'wolse',
      depositKrw: 290000000,
      monthlyRentKrw: 1950000,
      areaM2: 59.84,
      floor: 10,
      builtYear: 2018,
      complexName: '역삼센트럴',
      source: 'live'
    });
  });

  it('parses live MOLIT XML items with English field names', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <response>
            <header>
              <resultCode>000</resultCode>
              <resultMsg>OK</resultMsg>
            </header>
            <body>
              <items>
                <item>
                  <aptNm>래미안원베일리</aptNm>
                  <aptSeq>11680-1234</aptSeq>
                  <buildYear>2023</buildYear>
                  <dealDay>8</dealDay>
                  <dealMonth>7</dealMonth>
                  <dealYear>2026</dealYear>
                  <deposit>50,000</deposit>
                  <excluUseAr>84.97</excluUseAr>
                  <floor>15</floor>
                  <jibun>12-3</jibun>
                  <monthlyRent>250</monthlyRent>
                  <sggCd>11680</sggCd>
                  <umdNm> 반포동 </umdNm>
                </item>
              </items>
            </body>
          </response>`,
          { status: 200, headers: { 'content-type': 'application/xml' } }
        )
    );

    const client = new LiveMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000/'
    });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      limit: 20
    });

    expect(result.source).toBe('live');
    expect(result.totalMatched).toBe(1);
    expect(result.deals[0]).toMatchObject({
      lawdCode: '11680',
      regionName: '반포동',
      housingType: 'apartment',
      contractDate: '2026-07-08',
      contractType: 'wolse',
      depositKrw: 500000000,
      monthlyRentKrw: 2500000,
      areaM2: 84.97,
      floor: 15,
      builtYear: 2023,
      complexName: '래미안원베일리',
      source: 'live'
    });
  });

  it('parses detached multi-family live XML using totalFloorAr as area', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <response>
            <header>
              <resultCode>000</resultCode>
              <resultMsg>OK</resultMsg>
            </header>
            <body>
              <items>
                <item>
                  <buildYear>1996</buildYear>
                  <dealDay>3</dealDay>
                  <dealMonth>1</dealMonth>
                  <dealYear>2024</dealYear>
                  <deposit>22,000</deposit>
                  <houseType>다가구</houseType>
                  <monthlyRent>0</monthlyRent>
                  <sggCd>11680</sggCd>
                  <totalFloorAr>45</totalFloorAr>
                  <umdNm>대치동</umdNm>
                </item>
              </items>
            </body>
          </response>`,
          { status: 200, headers: { 'content-type': 'application/xml' } }
        )
    );

    const client = new LiveMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000/'
    });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202401',
      dealYmdTo: '202401',
      housingType: 'detachedMultiFamily',
      limit: 20
    });

    expect(result.source).toBe('live');
    expect(result.totalMatched).toBe(1);
    expect(result.deals[0]).toMatchObject({
      lawdCode: '11680',
      regionName: '대치동',
      housingType: 'detachedMultiFamily',
      contractDate: '2024-01-03',
      contractType: 'jeonse',
      depositKrw: 220000000,
      monthlyRentKrw: 0,
      areaM2: 45,
      builtYear: 1996,
      complexName: '다가구',
      source: 'live'
    });
  });

  it('throws when MOLIT XML contains an error resultCode', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <response>
            <header>
              <resultCode>30</resultCode>
              <resultMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</resultMsg>
            </header>
            <body>
              <items />
            </body>
          </response>`,
          { status: 200, headers: { 'content-type': 'application/xml' } }
        )
    );

    const client = new LiveMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000/'
    });

    await expect(
      client.searchRentComparables({
        lawdCode: '11680',
        dealYmdFrom: '202607',
        dealYmdTo: '202607',
        housingType: 'apartment',
        limit: 20
      })
    ).rejects.toThrow('MOLIT API returned resultCode 30');
  });
});

describe('FallbackMolitRentClient', () => {
  it('returns unavailable information when live lookup fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('service error', { status: 500 }));

    const client = new FallbackMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000'
    });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      areaM2: 60,
      complexName: '역삼센트럴',
      limit: 20
    });

    expect(result.source).toBe('unavailable');
    expect(result.status).toBe('LIVE_DATA_UNAVAILABLE');
    expect(result.reasonCode).toBe('API_HTTP_ERROR');
    expect(result.retryable).toBe(true);
    expect(result.deals).toEqual([]);
    expect(result.dataNotice).toContain('공공데이터 조회가 실패했습니다');
    expect(result.dataNotice).toContain('정보가 부족합니다');
  });

  it('treats the public-data NODATA resultCode as a successful empty search', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <response>
            <header>
              <resultCode>03</resultCode>
              <resultMsg>NODATA_ERROR</resultMsg>
            </header>
          </response>`,
          { status: 200, headers: { 'content-type': 'application/xml' } }
        )
    );

    const client = new FallbackMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000'
    });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      areaM2: 60,
      complexName: '역삼센트럴',
      limit: 20
    });

    expect(result.source).toBe('live');
    expect(result.status).toBe('NO_MATCHES');
    expect(result.reasonCode).toBe('NO_REPORTED_DEALS');
    expect(result.retryable).toBe(false);
    expect(result.deals).toEqual([]);
    expect(result.dataNotice).toContain('신고된 거래자료가 없습니다');
  });

  it('aborts the full lookup when its overall deadline is exceeded', async () => {
    globalThis.fetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const rejectOnAbort = () => reject(signal?.reason ?? new DOMException('timed out', 'TimeoutError'));
          if (signal?.aborted) {
            rejectOnAbort();
            return;
          }
          signal?.addEventListener('abort', rejectOnAbort, { once: true });
        })
    );
    const client = new FallbackMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000',
      timeoutMs: 1000,
      totalTimeoutMs: 30
    });

    const startedAt = Date.now();
    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202601',
      dealYmdTo: '202612',
      housingType: 'apartment',
      complexName: '없는단지'
    });

    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(result).toMatchObject({
      source: 'unavailable',
      status: 'LIVE_DATA_UNAVAILABLE',
      reasonCode: 'API_TIMEOUT',
      retryable: true
    });
  });

  it('marks a request timeout as retryable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException('request timed out', 'TimeoutError');
    });
    const client = new FallbackMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000'
    });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment'
    });

    expect(result).toMatchObject({
      status: 'LIVE_DATA_UNAVAILABLE',
      reasonCode: 'API_TIMEOUT',
      retryable: true,
      nextActions: ['잠시 후 다시 시도하세요.']
    });
  });

  it('marks an API authorization failure as non-retryable', async () => {
    globalThis.fetch = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const client = new FallbackMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000'
    });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment'
    });

    expect(result).toMatchObject({
      status: 'LIVE_DATA_UNAVAILABLE',
      reasonCode: 'API_AUTH_ERROR',
      retryable: false
    });
    expect(result.nextActions).toContain('공공데이터 API 키의 활용신청 승인 상태와 호출 권한을 확인하세요.');
  });

  it('marks an invalid request range as non-retryable without calling the API', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const client = new FallbackMolitRentClient({
      apiKey: 'key',
      baseUrl: 'https://apis.data.go.kr/1613000'
    });

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202606',
      housingType: 'apartment'
    });

    expect(result).toMatchObject({
      status: 'INVALID_REQUEST',
      reasonCode: 'INVALID_REQUEST',
      retryable: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns unavailable information when no API key is configured', async () => {
    const client = new FallbackMolitRentClient({});

    const result = await client.searchRentComparables({
      lawdCode: '11680',
      dealYmdFrom: '202607',
      dealYmdTo: '202607',
      housingType: 'apartment',
      limit: 20
    });

    expect(result.source).toBe('unavailable');
    expect(result.status).toBe('LIVE_DATA_UNAVAILABLE');
    expect(result.reasonCode).toBe('API_KEY_MISSING');
    expect(result.retryable).toBe(false);
    expect(result.nextActions).toContain('서비스 관리자에게 공공데이터 API 설정을 확인해 달라고 요청하세요.');
    expect(result.requiresLiveData).toBe(true);
    expect(result.deals).toEqual([]);
    expect(result.dataNotice).toContain('MOLIT_OPEN_DATA_API_KEY가 없어');
    expect(result.dataNotice).toContain('공공데이터 API 신고자료를 조회할 수 없습니다');
    expect(result.dataNotice).toContain('정보가 부족합니다');
  });
});
