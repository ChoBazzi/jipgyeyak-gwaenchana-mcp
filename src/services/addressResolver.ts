import { loadConfig } from '../config.js';
import { CONTRACT_CHECK_DISCLAIMER, type AddressResolution, type HousingType, type RegionCandidate } from '../domain/types.js';
import { FallbackJusoAddressClient, type JusoAddressClient } from './jusoAddressClient.js';

const ADDRESS_MATCH_NOTICE =
  '입력 주소를 내장 행정구역 키워드 매핑으로 해석했습니다. 도로명주소 API 또는 행정표준코드 API 검증 전까지는 후보 확인 용도로만 사용하세요.';

const ADDRESS_INSUFFICIENT_NOTICE =
  '입력 주소를 법정동 코드로 해석할 정보가 부족합니다. 도로명주소, 지번주소, 시군구/동 이름을 더 구체적으로 입력한 뒤 다시 시도해 주세요.';

const LOCAL_REGION_INDEX: Array<RegionCandidate & { keywords: string[] }> = [
  {
    regionName: '서울특별시 강남구',
    lawdCode: '11680',
    legalDongCode: '1168000000',
    sido: '서울특별시',
    sigungu: '강남구',
    eupmyeondong: '',
    confidence: 'medium',
    matchReason: '서울 강남구 행정구역 키워드 매칭',
    keywords: ['강남구', '강남역', '역삼', '역삼동', '대치', '대치동', '수서', '수서동']
  },
  {
    regionName: '서울특별시 성동구',
    lawdCode: '11200',
    legalDongCode: '1120000000',
    sido: '서울특별시',
    sigungu: '성동구',
    eupmyeondong: '',
    confidence: 'medium',
    matchReason: '서울 성동구 행정구역 키워드 매칭',
    keywords: ['성동구', '성수', '성수동', '서울숲', '왕십리']
  },
  {
    regionName: '서울특별시 종로구',
    lawdCode: '11110',
    legalDongCode: '1111000000',
    sido: '서울특별시',
    sigungu: '종로구',
    eupmyeondong: '',
    confidence: 'medium',
    matchReason: '서울 종로구 행정구역 키워드 매칭',
    keywords: ['종로구', '종로', '광화문', '북촌', '혜화', '명륜']
  },
  {
    regionName: '서울특별시 금천구',
    lawdCode: '11545',
    legalDongCode: '1154500000',
    sido: '서울특별시',
    sigungu: '금천구',
    eupmyeondong: '',
    confidence: 'medium',
    matchReason: '서울 금천구 행정구역 키워드 매칭',
    keywords: ['금천구', '가산', '가산동', '독산', '독산동']
  },
  {
    regionName: '서울특별시 송파구',
    lawdCode: '11710',
    legalDongCode: '1171000000',
    sido: '서울특별시',
    sigungu: '송파구',
    eupmyeondong: '',
    confidence: 'medium',
    matchReason: '서울 송파구 행정구역 키워드 매칭',
    keywords: ['송파구', '잠실', '잠실동', '가락', '가락동', '문정']
  },
  {
    regionName: '서울특별시 마포구',
    lawdCode: '11440',
    legalDongCode: '1144000000',
    sido: '서울특별시',
    sigungu: '마포구',
    eupmyeondong: '',
    confidence: 'medium',
    matchReason: '서울 마포구 행정구역 키워드 매칭',
    keywords: ['마포구', '마포', '아현', '아현동', '공덕', '홍대']
  },
  {
    regionName: '경기도 성남시 분당구',
    lawdCode: '41135',
    legalDongCode: '4113500000',
    sido: '경기도',
    sigungu: '성남시 분당구',
    eupmyeondong: '',
    confidence: 'medium',
    matchReason: '경기 성남시 분당구 행정구역 키워드 매칭',
    keywords: ['성남시분당구', '분당구', '판교', '판교역', '판교동', '백현동', '삼평동']
  },
  {
    regionName: '부산광역시 해운대구',
    lawdCode: '26350',
    legalDongCode: '2635000000',
    sido: '부산광역시',
    sigungu: '해운대구',
    eupmyeondong: '',
    confidence: 'medium',
    matchReason: '부산 해운대구 행정구역 키워드 매칭',
    keywords: ['해운대구', '해운대', '우동', '중동']
  }
];

function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, ' ').trim();
}

function toCandidate(region: RegionCandidate & { keywords: string[] }, compactAddress: string): RegionCandidate {
  const matchedKeyword = region.keywords.find((keyword) => compactAddress.includes(keyword.replace(/\s/g, '')));

  return {
    regionName: region.regionName,
    lawdCode: region.lawdCode,
    legalDongCode: region.legalDongCode,
    sido: region.sido,
    sigungu: region.sigungu,
    eupmyeondong: matchedKeyword ?? region.eupmyeondong,
    confidence: matchedKeyword === region.sigungu ? 'medium' : 'high',
    matchReason: matchedKeyword ? `${matchedKeyword} 행정구역 키워드 매칭` : region.matchReason,
    source: 'local'
  };
}

function findLocalCandidates(compactAddress: string): RegionCandidate[] {
  return LOCAL_REGION_INDEX.filter((region) =>
    region.keywords.some((keyword) => compactAddress.includes(keyword.replace(/\s/g, '')))
  ).map((region) => toCandidate(region, compactAddress));
}

function shouldPreferLocalIntent(compactAddress: string, localCandidates: RegionCandidate[], jusoCandidates: RegionCandidate[]): boolean {
  if (localCandidates.length === 0) return false;

  const localLawdCodes = new Set(localCandidates.map((candidate) => candidate.lawdCode));
  if (jusoCandidates.some((candidate) => localLawdCodes.has(candidate.lawdCode))) return false;

  const hasPangyoIntent = compactAddress.includes('판교') && !compactAddress.includes('안양판교로');
  const hasBundangCandidate = localCandidates.some((candidate) => candidate.lawdCode === '41135');
  return hasPangyoIntent && hasBundangCandidate;
}

function joinNotices(...notices: Array<string | undefined>): string {
  return notices.filter((notice): notice is string => Boolean(notice)).join(' ');
}

function unavailableAddressNextActions(reasonCode: string, retryable: boolean): string[] {
  if (reasonCode === 'API_KEY_MISSING') {
    return ['서비스 관리자에게 도로명주소 API 설정을 확인해 달라고 요청하세요.'];
  }
  return retryable
    ? ['잠시 후 주소 조회를 다시 시도하세요.']
    : ['도로명주소 API 설정과 응답 상태를 확인하세요.'];
}

function createJusoClientFromEnv(): JusoAddressClient {
  const config = loadConfig();
  return new FallbackJusoAddressClient({
    apiKey: config.jusoApiKey,
    baseUrl: config.jusoApiBaseUrl,
    timeoutMs: config.jusoApiTimeoutMs
  });
}

export async function resolveAddressRegion(
  address: string,
  _housingType?: HousingType,
  jusoClient: JusoAddressClient = createJusoClientFromEnv(),
  signal?: AbortSignal
): Promise<AddressResolution> {
  const normalizedAddress = normalizeAddress(address);
  const compactAddress = normalizedAddress.replace(/\s/g, '');
  const jusoResult = await jusoClient.searchAddress(normalizedAddress, signal);
  const localCandidates = findLocalCandidates(compactAddress);

  if (jusoResult.candidates.length > 0) {
    if (shouldPreferLocalIntent(compactAddress, localCandidates, jusoResult.candidates)) {
      const primary = localCandidates[0] ?? null;

      return {
        normalizedAddress,
        normalizedRegionName: primary?.regionName ?? null,
        lawdCode: primary?.lawdCode ?? null,
        candidates: localCandidates,
        source: 'local',
        lookupStatus: 'MATCHED',
        lookupReasonCode: 'LOCAL_MATCH_FOUND',
        retryable: false,
        nextActions: ['도로명주소나 지번주소를 함께 입력해 주소 후보를 다시 확인하세요.'],
        dataNotice: joinNotices(
          jusoResult.dataNotice,
          '도로명주소 API 후보가 입력한 지역 의도와 달라 내장 행정구역 키워드 매핑을 우선했습니다. 더 정확한 비교를 위해 도로명주소나 지번주소를 함께 입력하세요.'
        ),
        disclaimer: CONTRACT_CHECK_DISCLAIMER
      };
    }

    const primary = jusoResult.candidates[0] ?? null;

    return {
      normalizedAddress,
      normalizedRegionName: primary?.regionName ?? null,
      lawdCode: primary?.lawdCode ?? null,
      candidates: jusoResult.candidates,
      source: 'juso',
      lookupStatus: 'MATCHED',
      lookupReasonCode: 'MATCHES_FOUND',
      retryable: false,
      nextActions: [],
      dataNotice: jusoResult.dataNotice,
      disclaimer: CONTRACT_CHECK_DISCLAIMER
    };
  }

  const primary = localCandidates[0] ?? null;
  const lookupStatus = primary
    ? 'MATCHED'
    : jusoResult.status === 'LIVE_DATA_UNAVAILABLE'
      ? 'LIVE_DATA_UNAVAILABLE'
      : 'NO_MATCHES';
  const lookupReasonCode = primary ? 'LOCAL_MATCH_FOUND' : jusoResult.reasonCode;
  const retryable = primary ? false : jusoResult.retryable;
  const nextActions = primary
    ? ['도로명주소나 지번주소를 함께 입력해 주소 후보를 다시 확인하세요.']
    : lookupStatus === 'LIVE_DATA_UNAVAILABLE'
      ? unavailableAddressNextActions(lookupReasonCode, retryable)
      : ['도로명주소, 지번주소 또는 시군구와 법정동을 포함해 다시 입력하세요.'];

  return {
    normalizedAddress,
    normalizedRegionName: primary?.regionName ?? null,
    lawdCode: primary?.lawdCode ?? null,
    candidates: localCandidates,
    source: 'local',
    lookupStatus,
    lookupReasonCode,
    retryable,
    nextActions,
    dataNotice: primary ? joinNotices(jusoResult.dataNotice, ADDRESS_MATCH_NOTICE) : joinNotices(jusoResult.dataNotice, ADDRESS_INSUFFICIENT_NOTICE),
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
}
