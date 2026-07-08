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

function joinNotices(...notices: Array<string | undefined>): string {
  return notices.filter((notice): notice is string => Boolean(notice)).join(' ');
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
  jusoClient: JusoAddressClient = createJusoClientFromEnv()
): Promise<AddressResolution> {
  const normalizedAddress = normalizeAddress(address);
  const compactAddress = normalizedAddress.replace(/\s/g, '');
  const jusoResult = await jusoClient.searchAddress(normalizedAddress);

  if (jusoResult.candidates.length > 0) {
    const primary = jusoResult.candidates[0] ?? null;

    return {
      normalizedAddress,
      normalizedRegionName: primary?.regionName ?? null,
      lawdCode: primary?.lawdCode ?? null,
      candidates: jusoResult.candidates,
      source: 'juso',
      dataNotice: jusoResult.dataNotice,
      disclaimer: CONTRACT_CHECK_DISCLAIMER
    };
  }

  const candidates = LOCAL_REGION_INDEX.filter((region) =>
    region.keywords.some((keyword) => compactAddress.includes(keyword.replace(/\s/g, '')))
  ).map((region) => toCandidate(region, compactAddress));

  const primary = candidates[0] ?? null;

  return {
    normalizedAddress,
    normalizedRegionName: primary?.regionName ?? null,
    lawdCode: primary?.lawdCode ?? null,
    candidates,
    source: 'local',
    dataNotice: primary ? joinNotices(jusoResult.dataNotice, ADDRESS_MATCH_NOTICE) : joinNotices(jusoResult.dataNotice, ADDRESS_INSUFFICIENT_NOTICE),
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
}
