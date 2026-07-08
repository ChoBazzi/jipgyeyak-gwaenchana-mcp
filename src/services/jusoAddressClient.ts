import { CONTRACT_CHECK_DISCLAIMER, type RegionCandidate } from '../domain/types.js';

export interface JusoAddressSearchResult {
  candidates: RegionCandidate[];
  dataNotice: string;
  disclaimer: string;
}

export interface JusoAddressClient {
  searchAddress(address: string): Promise<JusoAddressSearchResult>;
}

interface JusoAddressItem {
  roadAddr?: string;
  jibunAddr?: string;
  bdNm?: string;
  siNm?: string;
  sggNm?: string;
  emdNm?: string;
  admCd?: string;
  bdMgtSn?: string;
}

function emptyResult(message: string): JusoAddressSearchResult {
  return {
    candidates: [],
    dataNotice: message,
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
}

function buildJusoUrl(options: { baseUrl: string; apiKey: string }, keyword: string): URL {
  const url = new URL(options.baseUrl);
  url.searchParams.set('confmKey', options.apiKey);
  url.searchParams.set('currentPage', '1');
  url.searchParams.set('countPerPage', '10');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('resultType', 'json');
  return url;
}

function firstFiveDigits(value: string | undefined): string | null {
  if (!value || value.length < 5) return null;
  const lawdCode = value.slice(0, 5);
  return /^\d{5}$/.test(lawdCode) ? lawdCode : null;
}

function toCandidate(item: JusoAddressItem): RegionCandidate | null {
  const lawdCodeFromBuilding = firstFiveDigits(item.bdMgtSn);
  const lawdCodeFromAdministrative = firstFiveDigits(item.admCd);
  const lawdCode = lawdCodeFromBuilding ?? lawdCodeFromAdministrative;

  if (!lawdCode || !item.siNm || !item.sggNm) return null;

  return {
    regionName: `${item.siNm} ${item.sggNm}`,
    lawdCode,
    legalDongCode: item.admCd ?? '',
    sido: item.siNm,
    sigungu: item.sggNm,
    eupmyeondong: item.emdNm ?? '',
    confidence: lawdCodeFromBuilding ? 'high' : 'medium',
    matchReason: lawdCodeFromBuilding
      ? '도로명주소 API bdMgtSn 앞 5자리로 lawdCode를 추출했습니다.'
      : '도로명주소 API admCd 앞 5자리로 lawdCode를 추출했습니다.',
    source: 'juso',
    roadAddress: item.roadAddr,
    jibunAddress: item.jibunAddr,
    buildingName: item.bdNm || undefined,
    administrativeCode: item.admCd,
    buildingManagementNumber: item.bdMgtSn
  };
}

function parseJusoCandidates(payload: unknown): { candidates: RegionCandidate[]; notice?: string } {
  if (!payload || typeof payload !== 'object') {
    return { candidates: [], notice: '도로명주소 API 응답 형식을 해석할 수 없습니다.' };
  }

  const results = (payload as { results?: unknown }).results;
  if (!results || typeof results !== 'object') {
    return { candidates: [], notice: '도로명주소 API 응답에 results가 없습니다.' };
  }

  const common = (results as { common?: { errorCode?: string; errorMessage?: string } }).common;
  if (common?.errorCode && common.errorCode !== '0') {
    return {
      candidates: [],
      notice: `도로명주소 API가 오류를 반환했습니다. errorCode=${common.errorCode}${
        common.errorMessage ? `, message=${common.errorMessage}` : ''
      }`
    };
  }

  const juso = (results as { juso?: unknown }).juso;
  if (!Array.isArray(juso) || juso.length === 0) {
    return { candidates: [], notice: '도로명주소 API 조회는 성공했지만 주소 후보가 없습니다.' };
  }

  const candidates = juso.map((item) => toCandidate(item as JusoAddressItem)).filter((item): item is RegionCandidate => item !== null);
  return {
    candidates,
    notice: candidates.length > 0 ? undefined : '도로명주소 API 응답에서 lawdCode를 추출할 수 있는 주소 후보가 없습니다.'
  };
}

export class LiveJusoAddressClient implements JusoAddressClient {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
    }
  ) {}

  async searchAddress(address: string): Promise<JusoAddressSearchResult> {
    const url = buildJusoUrl(this.options, address);
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.options.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Juso API request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const parsed = parseJusoCandidates(payload);
    if (parsed.candidates.length === 0) {
      return emptyResult(parsed.notice ?? '도로명주소 API 조회 결과가 없습니다.');
    }

    return {
      candidates: parsed.candidates,
      dataNotice: '도로명주소 주소기반산업지원서비스 검색 API 응답에서 주소 후보와 lawdCode를 추출했습니다.',
      disclaimer: CONTRACT_CHECK_DISCLAIMER
    };
  }
}

export class FallbackJusoAddressClient implements JusoAddressClient {
  private readonly liveClient?: LiveJusoAddressClient;

  constructor(options: { apiKey?: string; baseUrl?: string; timeoutMs?: number }) {
    if (options.apiKey && options.baseUrl && options.timeoutMs) {
      this.liveClient = new LiveJusoAddressClient({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs
      });
    }
  }

  async searchAddress(address: string): Promise<JusoAddressSearchResult> {
    if (!this.liveClient) {
      return emptyResult(
        'JUSO_API_KEY가 없어 도로명주소 API 주소 후보를 조회할 수 없습니다. live 후보를 만들지 않고 내장 행정구역 키워드 매핑을 확인합니다.'
      );
    }

    try {
      return await this.liveClient.searchAddress(address);
    } catch (error) {
      const failureReason = error instanceof Error && error.message ? ` 실패 사유: ${error.message}` : '';
      return emptyResult(
        `도로명주소 API 조회가 실패했습니다.${failureReason} live 후보를 만들지 않고 내장 행정구역 키워드 매핑을 확인합니다.`
      );
    }
  }
}
