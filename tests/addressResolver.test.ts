import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegionCandidate } from '../src/domain/types.js';
import { resolveAddressRegion } from '../src/services/addressResolver.js';
import type { JusoAddressClient } from '../src/services/jusoAddressClient.js';

const originalFetch = globalThis.fetch;
const originalJusoApiKey = process.env.JUSO_API_KEY;
const originalJusoApiBaseUrl = process.env.JUSO_API_BASE_URL;
const originalJusoApiTimeoutMs = process.env.JUSO_API_TIMEOUT_MS;

function jusoCandidate(input: {
  regionName: string;
  lawdCode: string;
  sido: string;
  sigungu: string;
  eupmyeondong: string;
  roadAddress: string;
  buildingName?: string;
}): RegionCandidate {
  return {
    ...input,
    legalDongCode: `${input.lawdCode}00000`,
    confidence: 'high',
    matchReason: 'test Juso candidate',
    source: 'juso'
  };
}

function jusoClientWith(candidates: RegionCandidate[]): JusoAddressClient {
  return {
    async searchAddress() {
      return {
        candidates,
        status: 'MATCHES_FOUND',
        reasonCode: 'MATCHES_FOUND',
        retryable: false,
        dataNotice: '도로명주소 API 테스트 후보',
        disclaimer: 'test disclaimer'
      };
    }
  };
}

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
  const bucheonJungdong = jusoCandidate({
    regionName: '경기도 부천시 원미구',
    lawdCode: '41192',
    sido: '경기도',
    sigungu: '부천시 원미구',
    eupmyeondong: '중동',
    roadAddress: '경기도 부천시 원미구 길주로 234 (중동)',
    buildingName: '힐스테이트 중동'
  });
  const gwangyangJungdong = jusoCandidate({
    regionName: '전라남도 광양시',
    lawdCode: '46230',
    sido: '전라남도',
    sigungu: '광양시',
    eupmyeondong: '중동',
    roadAddress: '전라남도 광양시 중마청룡길 40 (중동)',
    buildingName: '중동아파트'
  });
  const busanWoodong = jusoCandidate({
    regionName: '부산광역시 해운대구',
    lawdCode: '26350',
    sido: '부산광역시',
    sigungu: '해운대구',
    eupmyeondong: '우동',
    roadAddress: '부산광역시 해운대구 우동1로 89 (우동)'
  });
  const buanWoodongRoad = jusoCandidate({
    regionName: '전북특별자치도 부안군',
    lawdCode: '52800',
    sido: '전북특별자치도',
    sigungu: '부안군',
    eupmyeondong: '보안면',
    roadAddress: '전북특별자치도 부안군 보안면 우동길 41'
  });

  it('asks for a district when a bare legal-dong name spans multiple regions', async () => {
    const result = await resolveAddressRegion(
      '중동',
      'officetel',
      jusoClientWith([bucheonJungdong, gwangyangJungdong])
    );

    expect(result).toMatchObject({
      normalizedRegionName: null,
      lawdCode: null,
      lookupStatus: 'AMBIGUOUS',
      lookupReasonCode: 'MULTIPLE_ADDRESS_MATCHES',
      retryable: false
    });
    expect(result.clarificationQuestion).toContain('시·군·구');
    expect(result.clarificationOptions).toEqual([
      { regionName: '경기도 부천시 원미구', lawdCode: '41192', eupmyeondong: '중동' },
      { regionName: '전라남도 광양시', lawdCode: '46230', eupmyeondong: '중동' }
    ]);
  });

  it('asks for confirmation when a bare dong name only narrows after excluding road-name collisions', async () => {
    const result = await resolveAddressRegion(
      '우동',
      'officetel',
      jusoClientWith([buanWoodongRoad, busanWoodong])
    );

    expect(result).toMatchObject({
      lawdCode: null,
      lookupStatus: 'AMBIGUOUS',
      lookupReasonCode: 'MULTIPLE_ADDRESS_MATCHES'
    });
    expect(result.clarificationOptions).toEqual([
      { regionName: '부산광역시 해운대구', lawdCode: '26350', eupmyeondong: '우동' }
    ]);
  });

  it.each([
    ['부천 중동', [bucheonJungdong, gwangyangJungdong], '41192'],
    ['부산 우동', [buanWoodongRoad, busanWoodong], '26350']
  ] as const)('uses explicit administrative context to narrow %s', async (address, candidates, lawdCode) => {
    const result = await resolveAddressRegion(address, 'officetel', jusoClientWith([...candidates]));

    expect(result).toMatchObject({
      lawdCode,
      lookupStatus: 'MATCHED',
      lookupReasonCode: 'MATCHES_FOUND'
    });
    expect(new Set(result.candidates.map((candidate) => candidate.lawdCode))).toEqual(new Set([lawdCode]));
    expect(result.clarificationQuestion).toBeUndefined();
  });

  it('does not treat an administrative-name fragment inside a building word as location context', async () => {
    const goyangCandidate = jusoCandidate({
      regionName: '경기도 고양시 일산동구',
      lawdCode: '41285',
      sido: '경기도',
      sigungu: '고양시 일산동구',
      eupmyeondong: '장항동',
      roadAddress: '경기도 고양시 일산동구 테스트로 1',
      buildingName: '고양이카페'
    });
    const seoulCandidate = jusoCandidate({
      regionName: '서울특별시 마포구',
      lawdCode: '11440',
      sido: '서울특별시',
      sigungu: '마포구',
      eupmyeondong: '서교동',
      roadAddress: '서울특별시 마포구 테스트로 2',
      buildingName: '고양이카페'
    });

    const result = await resolveAddressRegion(
      '고양이카페',
      'officetel',
      jusoClientWith([goyangCandidate, seoulCandidate])
    );

    expect(result).toMatchObject({
      lawdCode: null,
      lookupStatus: 'AMBIGUOUS',
      lookupReasonCode: 'MULTIPLE_ADDRESS_MATCHES'
    });
    expect(result.clarificationOptions).toHaveLength(2);
  });

  it('asks when the stated city matches but the stated dong does not match that city candidate', async () => {
    const seoulMangwoodong = jusoCandidate({
      regionName: '서울특별시 중랑구',
      lawdCode: '11260',
      sido: '서울특별시',
      sigungu: '중랑구',
      eupmyeondong: '망우동',
      roadAddress: '서울특별시 중랑구 망우로 1 (망우동)',
      buildingName: '망우동센터'
    });

    const result = await resolveAddressRegion(
      '서울 우동',
      'officetel',
      jusoClientWith([seoulMangwoodong, busanWoodong])
    );

    expect(result).toMatchObject({
      lawdCode: null,
      lookupStatus: 'AMBIGUOUS',
      lookupReasonCode: 'MULTIPLE_ADDRESS_MATCHES'
    });
    expect(result.clarificationOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lawdCode: '11260', eupmyeondong: '망우동' }),
        expect.objectContaining({ lawdCode: '26350', eupmyeondong: '우동' })
      ])
    );
  });

  it('accepts a broader dong token when the legal dong candidate has a numbered suffix', async () => {
    const seongsu1ga = jusoCandidate({
      regionName: '서울특별시 성동구',
      lawdCode: '11200',
      sido: '서울특별시',
      sigungu: '성동구',
      eupmyeondong: '성수동1가',
      roadAddress: '서울특별시 성동구 왕십리로 1 (성수동1가)'
    });

    const result = await resolveAddressRegion(
      '서울 성수동',
      'officetel',
      jusoClientWith([seongsu1ga])
    );

    expect(result).toMatchObject({ lawdCode: '11200', lookupStatus: 'MATCHED' });
  });

  it('returns a local lawdCode candidate with an explicit verification notice and disclaimer', async () => {
    delete process.env.JUSO_API_KEY;
    const result = await resolveAddressRegion('서울 강남구 역삼동 123-4', 'apartment');

    expect(result.lawdCode).toBe('11680');
    expect(result.candidates[0]?.regionName).toBe('서울특별시 강남구');
    expect(result.source).toBe('local');
    expect(result.dataNotice).toContain('내장 행정구역 키워드');
    expect(result.disclaimer).toContain('법률, 금융, 세무 또는 투자 조언이 아니며');
  });

  it('resolves common Seoul area keywords from local mapping', async () => {
    delete process.env.JUSO_API_KEY;
    await expect(resolveAddressRegion('성수에서 오피스텔 계약', 'officetel')).resolves.toMatchObject({ lawdCode: '11200' });
    await expect(resolveAddressRegion('종로구 빌라 월세', 'villa')).resolves.toMatchObject({ lawdCode: '11110' });
  });

  it('does not promote a colloquial area alias to a legal-dong name', async () => {
    delete process.env.JUSO_API_KEY;

    const result = await resolveAddressRegion('판교 오피스텔', 'officetel');

    expect(result).toMatchObject({ lawdCode: '41135', source: 'local' });
    expect(result.candidates[0]).toMatchObject({ eupmyeondong: '', confidence: 'medium' });
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

  it('retries a brand-focused Juso query inside the locally identified district', async () => {
    const pangyoSkHub = jusoCandidate({
      regionName: '경기도 성남시 분당구',
      lawdCode: '41135',
      sido: '경기도',
      sigungu: '성남시 분당구',
      eupmyeondong: '백현동',
      roadAddress: '경기도 성남시 분당구 판교역로 109 (백현동)',
      buildingName: 'SK HUB 오피스텔'
    });
    const searchAddress = vi.fn(async (query: string) => ({
      candidates: query === '성남시 분당구 SK HUB 오피스텔' ? [pangyoSkHub] : [],
      status: query === '성남시 분당구 SK HUB 오피스텔' ? ('MATCHES_FOUND' as const) : ('NO_MATCHES' as const),
      reasonCode: query === '성남시 분당구 SK HUB 오피스텔' ? ('MATCHES_FOUND' as const) : ('NO_ADDRESS_MATCH' as const),
      retryable: false,
      dataNotice: '도로명주소 API 테스트 결과',
      disclaimer: 'test disclaimer'
    }));

    const result = await resolveAddressRegion('판교 SK HUB', 'officetel', { searchAddress });

    expect(searchAddress).toHaveBeenNthCalledWith(1, '판교 SK HUB', undefined);
    expect(searchAddress).toHaveBeenNthCalledWith(2, '성남시 분당구 SK HUB 오피스텔', undefined);
    expect(result).toMatchObject({
      source: 'juso',
      lookupStatus: 'MATCHED',
      lookupReasonCode: 'BRAND_ASSISTED_MATCH_FOUND',
      lawdCode: '41135'
    });
    expect(result.candidates[0]).toMatchObject({
      eupmyeondong: '백현동',
      buildingName: 'SK HUB 오피스텔'
    });
    expect(result.dataNotice).toContain('보조 검색어');
  });

  it('rejects a brand-assisted candidate with unmatched brand tokens', async () => {
    const unrelatedSkView = jusoCandidate({
      regionName: '경기도 성남시 분당구',
      lawdCode: '41135',
      sido: '경기도',
      sigungu: '성남시 분당구',
      eupmyeondong: '정자동',
      roadAddress: '경기도 성남시 분당구 테스트로 1 (정자동)',
      buildingName: 'SK VIEW 오피스텔'
    });
    const searchAddress = vi.fn(async (query: string) => ({
      candidates: query === '성남시 분당구 SK 오피스텔' ? [unrelatedSkView] : [],
      status: query === '성남시 분당구 SK 오피스텔' ? ('MATCHES_FOUND' as const) : ('NO_MATCHES' as const),
      reasonCode: query === '성남시 분당구 SK 오피스텔' ? ('MATCHES_FOUND' as const) : ('NO_ADDRESS_MATCH' as const),
      retryable: false,
      dataNotice: '도로명주소 API 테스트 결과',
      disclaimer: 'test disclaimer'
    }));

    const result = await resolveAddressRegion('판교SK허브', 'officetel', { searchAddress });

    expect(searchAddress).toHaveBeenNthCalledWith(2, '성남시 분당구 SK 오피스텔', undefined);
    expect(result).toMatchObject({
      lookupStatus: 'NO_MATCHES',
      lookupReasonCode: 'NO_ADDRESS_MATCH',
      lawdCode: null
    });
    expect(result.candidates).toEqual([]);
  });

  it('does not turn an unresolved building name into a legal dong from an area nickname', async () => {
    const searchAddress = vi.fn(async () => ({
      candidates: [],
      status: 'NO_MATCHES' as const,
      reasonCode: 'NO_ADDRESS_MATCH' as const,
      retryable: false,
      dataNotice: '도로명주소 API에서 후보가 없습니다.',
      disclaimer: 'test disclaimer'
    }));

    const result = await resolveAddressRegion('판교알수없는타워', 'officetel', { searchAddress });

    expect(result).toMatchObject({
      source: 'juso',
      lookupStatus: 'NO_MATCHES',
      lookupReasonCode: 'NO_ADDRESS_MATCH',
      lawdCode: null,
      normalizedRegionName: null
    });
    expect(result.candidates).toEqual([]);
    expect(result.dataNotice).toContain('지역 별칭만으로 법정동을 추측하지 않았습니다');
  });

  it('asks instead of hardcoding a local preference when Juso and local intent conflict', async () => {
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

    expect(result.lawdCode).toBeNull();
    expect(result.normalizedRegionName).toBeNull();
    expect(result).toMatchObject({
      lookupStatus: 'AMBIGUOUS',
      lookupReasonCode: 'MULTIPLE_ADDRESS_MATCHES'
    });
    expect(result.clarificationOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ regionName: '경기도 안양시 동안구', lawdCode: '41173' }),
        expect.objectContaining({ regionName: '경기도 성남시 분당구', lawdCode: '41135' })
      ])
    );
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
    expect(result).toMatchObject({ lookupStatus: 'MATCHED', lookupReasonCode: 'LOCAL_MATCH_FOUND' });
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

  it.each(['부천 중동', '대구 중동', '서울 중동', '부산 우동'])(
    'does not map an ambiguous neighborhood name to Haeundae when Juso is unavailable: %s',
    async (address) => {
      delete process.env.JUSO_API_KEY;

      const result = await resolveAddressRegion(address, 'officetel');

      expect(result.lawdCode).toBeNull();
      expect(result.candidates).toEqual([]);
      expect(result).toMatchObject({
        lookupStatus: 'LIVE_DATA_UNAVAILABLE',
        lookupReasonCode: 'API_KEY_MISSING',
        retryable: false
      });
    }
  );

  it('keeps an explicit Haeundae local fallback when Juso is unavailable', async () => {
    delete process.env.JUSO_API_KEY;

    const result = await resolveAddressRegion('부산 해운대구 중동', 'officetel');

    expect(result).toMatchObject({
      lawdCode: '26350',
      lookupStatus: 'MATCHED',
      lookupReasonCode: 'LOCAL_MATCH_FOUND'
    });
  });

  it('asks instead of choosing the first local mapping when the input contains conflicting regions', async () => {
    delete process.env.JUSO_API_KEY;

    const result = await resolveAddressRegion('강남구 성수', 'officetel');

    expect(result).toMatchObject({
      lawdCode: null,
      lookupStatus: 'AMBIGUOUS',
      lookupReasonCode: 'MULTIPLE_ADDRESS_MATCHES'
    });
    expect(result.clarificationQuestion).toContain('어느 지역');
  });

  it('does not invent a lawdCode for an unknown address', async () => {
    delete process.env.JUSO_API_KEY;
    const result = await resolveAddressRegion('알 수 없는 주소');

    expect(result.lawdCode).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result).toMatchObject({
      lookupStatus: 'LIVE_DATA_UNAVAILABLE',
      lookupReasonCode: 'API_KEY_MISSING',
      retryable: false
    });
    expect(result.dataNotice).toContain('정보가 부족합니다');
  });
});
