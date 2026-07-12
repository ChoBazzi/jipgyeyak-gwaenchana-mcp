import {
  CONTRACT_CHECK_DISCLAIMER,
  type AddressLookupReasonCode,
  type RegionCandidate
} from '../domain/types.js';

type JusoAddressSearchStatus = 'MATCHES_FOUND' | 'NO_MATCHES' | 'LIVE_DATA_UNAVAILABLE';

export interface JusoAddressSearchResult {
  candidates: RegionCandidate[];
  status: JusoAddressSearchStatus;
  reasonCode: AddressLookupReasonCode;
  retryable: boolean;
  dataNotice: string;
  disclaimer: string;
}

export interface JusoAddressClient {
  searchAddress(address: string, signal?: AbortSignal): Promise<JusoAddressSearchResult>;
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

interface JusoResponseFailure {
  status: JusoAddressSearchStatus;
  reasonCode: AddressLookupReasonCode;
  retryable: boolean;
}

const JUSO_AUTH_ERROR_CODES = new Set(['E0001', 'E0014']);
const JUSO_INVALID_REQUEST_CODES = new Set([
  'E0005',
  'E0006',
  'E0008',
  'E0009',
  'E0010',
  'E0011',
  'E0012',
  'E0013',
  'E0015'
]);

class JusoRequestError extends Error {
  constructor(
    message: string,
    readonly reasonCode: AddressLookupReasonCode,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'JusoRequestError';
  }
}

function emptyResult(
  message: string,
  options: {
    status?: JusoAddressSearchStatus;
    reasonCode?: AddressLookupReasonCode;
    retryable?: boolean;
  } = {}
): JusoAddressSearchResult {
  return {
    candidates: [],
    status: options.status ?? 'NO_MATCHES',
    reasonCode: options.reasonCode ?? 'NO_ADDRESS_MATCH',
    retryable: options.retryable ?? false,
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
  // bdMgtSn can retain a legacy district prefix after an administrative reorganization.
  const lawdCode = lawdCodeFromAdministrative ?? lawdCodeFromBuilding;

  if (!lawdCode || !item.siNm || !item.sggNm) return null;

  return {
    regionName: `${item.siNm} ${item.sggNm}`,
    lawdCode,
    legalDongCode: item.admCd ?? '',
    sido: item.siNm,
    sigungu: item.sggNm,
    eupmyeondong: item.emdNm ?? '',
    confidence: lawdCodeFromAdministrative || lawdCodeFromBuilding ? 'high' : 'medium',
    matchReason: lawdCodeFromAdministrative
      ? '도로명주소 API admCd 앞 5자리에서 현재 lawdCode를 추출했습니다.'
      : '도로명주소 API bdMgtSn 앞 5자리로 lawdCode를 추출했습니다.',
    source: 'juso',
    roadAddress: item.roadAddr,
    jibunAddress: item.jibunAddr,
    buildingName: item.bdNm || undefined,
    administrativeCode: item.admCd,
    buildingManagementNumber: item.bdMgtSn
  };
}

function classifyJusoBodyError(errorCode: string): JusoResponseFailure {
  if (JUSO_AUTH_ERROR_CODES.has(errorCode)) {
    return { status: 'LIVE_DATA_UNAVAILABLE', reasonCode: 'API_AUTH_ERROR', retryable: false };
  }

  if (JUSO_INVALID_REQUEST_CODES.has(errorCode)) {
    return { status: 'NO_MATCHES', reasonCode: 'INVALID_REQUEST', retryable: false };
  }

  if (errorCode === '-999') {
    return { status: 'LIVE_DATA_UNAVAILABLE', reasonCode: 'API_REQUEST_FAILED', retryable: true };
  }

  return { status: 'LIVE_DATA_UNAVAILABLE', reasonCode: 'API_RESPONSE_INVALID', retryable: true };
}

function parseJusoCandidates(payload: unknown): {
  candidates: RegionCandidate[];
  notice?: string;
  failure?: JusoResponseFailure;
} {
  if (!payload || typeof payload !== 'object') {
    return {
      candidates: [],
      notice: '도로명주소 API 응답 형식을 해석할 수 없습니다.',
      failure: { status: 'LIVE_DATA_UNAVAILABLE', reasonCode: 'API_RESPONSE_INVALID', retryable: true }
    };
  }

  const results = (payload as { results?: unknown }).results;
  if (!results || typeof results !== 'object') {
    return {
      candidates: [],
      notice: '도로명주소 API 응답에 results가 없습니다.',
      failure: { status: 'LIVE_DATA_UNAVAILABLE', reasonCode: 'API_RESPONSE_INVALID', retryable: true }
    };
  }

  const common = (results as { common?: { errorCode?: string | number; errorMessage?: string } }).common;
  const errorCode = common?.errorCode === undefined ? undefined : String(common.errorCode);
  if (errorCode && errorCode !== '0') {
    return {
      candidates: [],
      notice: `도로명주소 API가 오류를 반환했습니다. errorCode=${errorCode}${
        common?.errorMessage ? `, message=${common.errorMessage}` : ''
      }`,
      failure: classifyJusoBodyError(errorCode)
    };
  }

  const juso = (results as { juso?: unknown }).juso;
  if (!Array.isArray(juso) || juso.length === 0) {
    return { candidates: [], notice: '도로명주소 API 조회는 성공했지만 주소 후보가 없습니다.' };
  }

  const candidates = juso.map((item) => toCandidate(item as JusoAddressItem)).filter((item): item is RegionCandidate => item !== null);
  return {
    candidates,
    notice: candidates.length > 0 ? undefined : '도로명주소 API 응답에서 lawdCode를 추출할 수 있는 주소 후보가 없습니다.',
    failure:
      candidates.length === 0
        ? { status: 'LIVE_DATA_UNAVAILABLE', reasonCode: 'API_RESPONSE_INVALID', retryable: true }
        : undefined
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

  async searchAddress(address: string, signal?: AbortSignal): Promise<JusoAddressSearchResult> {
    const url = buildJusoUrl(this.options, address);
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)])
        : AbortSignal.timeout(this.options.timeoutMs)
    });

    if (!response.ok) {
      const isAuthError = response.status === 401 || response.status === 403;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new JusoRequestError(
        `Juso API request failed with status ${response.status}`,
        isAuthError ? 'API_AUTH_ERROR' : 'API_HTTP_ERROR',
        isAuthError ? false : retryable
      );
    }

    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      throw new JusoRequestError('Juso API returned invalid JSON', 'API_RESPONSE_INVALID', true);
    }
    const parsed = parseJusoCandidates(payload);
    if (parsed.candidates.length === 0) {
      return emptyResult(parsed.notice ?? '도로명주소 API 조회 결과가 없습니다.', parsed.failure);
    }

    return {
      candidates: parsed.candidates,
      status: 'MATCHES_FOUND',
      reasonCode: 'MATCHES_FOUND',
      retryable: false,
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

  async searchAddress(address: string, signal?: AbortSignal): Promise<JusoAddressSearchResult> {
    if (!this.liveClient) {
      return emptyResult(
        'JUSO_API_KEY가 없어 도로명주소 API 주소 후보를 조회할 수 없습니다. live 후보를 만들지 않고 내장 행정구역 키워드 매핑을 확인합니다.',
        { status: 'LIVE_DATA_UNAVAILABLE', reasonCode: 'API_KEY_MISSING', retryable: false }
      );
    }

    try {
      return await this.liveClient.searchAddress(address, signal);
    } catch (error) {
      const failure =
        error instanceof JusoRequestError
          ? { reasonCode: error.reasonCode, retryable: error.retryable }
          : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? { reasonCode: 'API_TIMEOUT' as const, retryable: true }
            : { reasonCode: 'API_REQUEST_FAILED' as const, retryable: true };
      const failureReason = error instanceof Error && error.message ? ` 실패 사유: ${error.message}` : '';
      return emptyResult(
        `도로명주소 API 조회가 실패했습니다.${failureReason} live 후보를 만들지 않고 내장 행정구역 키워드 매핑을 확인합니다.`,
        { status: 'LIVE_DATA_UNAVAILABLE', ...failure }
      );
    }
  }
}
