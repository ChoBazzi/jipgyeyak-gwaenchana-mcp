import { SEED_REGIONS } from '../data/seedRegions.js';
import { CONTRACT_CHECK_DISCLAIMER, type AddressResolution, type HousingType } from '../domain/types.js';

const ADDRESS_DATA_NOTICE =
  '주소 해석은 MVP seed lookup 결과입니다. 도로명주소 API 또는 행정표준코드 API 연동 전까지는 후보 확인 용도로만 사용하세요.';

function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, ' ').trim();
}

export function resolveAddressRegion(address: string, _housingType?: HousingType): AddressResolution {
  const normalizedAddress = normalizeAddress(address);
  const compactAddress = normalizedAddress.replace(/\s/g, '');

  const candidates = SEED_REGIONS.filter((region) => {
    const compactRegion = region.regionName.replace(/\s/g, '');
    return (
      compactAddress.includes(region.eupmyeondong) ||
      compactAddress.includes(region.sigungu.replace(/\s/g, '')) ||
      compactAddress.includes(compactRegion)
    );
  }).map((region) => ({
    ...region,
    confidence: compactAddress.includes(region.eupmyeondong) ? region.confidence : ('medium' as const),
    matchReason: compactAddress.includes(region.eupmyeondong)
      ? `${region.eupmyeondong} seed match`
      : `${region.sigungu} seed match`
  }));

  const primary = candidates[0] ?? null;

  return {
    normalizedAddress,
    normalizedRegionName: primary?.regionName ?? null,
    lawdCode: primary?.lawdCode ?? null,
    candidates,
    source: 'seed',
    dataNotice: ADDRESS_DATA_NOTICE,
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
}
