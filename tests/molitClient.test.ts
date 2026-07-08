import { afterEach, describe, expect, it, vi } from 'vitest';
import { FallbackMolitRentClient, LiveMolitRentClient } from '../src/services/molitClient.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('LiveMolitRentClient', () => {
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
    expect(requestedUrls.map((url) => url.searchParams.get('DEAL_YMD'))).toEqual(['202605', '202606', '202607']);
    for (const url of requestedUrls) {
      expect(url.searchParams.get('serviceKey')).toBe('encoded-key');
      expect(url.searchParams.get('LAWD_CD')).toBe('11680');
      expect(url.searchParams.get('pageNo')).toBe('1');
      expect(url.searchParams.get('numOfRows')).toBe('20');
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
  it('marks seed data clearly when live lookup fails', async () => {
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

    expect(result.source).toBe('seed');
    expect(result.dataNotice).toContain('live API 조회가 실패');
    expect(result.dataNotice).toContain('MVP seed data');
    expect(result.dataNotice).toContain('실시간 전월세 신고자료가 아닙니다');
  });

  it('marks seed fallback clearly when MOLIT returns an XML error resultCode', async () => {
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

    expect(result.source).toBe('seed');
    expect(result.dataNotice).toContain('live API 조회가 실패');
    expect(result.dataNotice).toContain('MVP seed data');
    expect(result.dataNotice).toContain('실패 사유');
    expect(result.dataNotice).toContain('resultCode 03');
  });
});
