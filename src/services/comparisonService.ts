import {
  CONTRACT_CHECK_DISCLAIMER,
  type AddressResolution,
  type ComparableReasonCode,
  type ComparisonConfidence,
  type ComparisonScope,
  type ContractComparison,
  type ContractComparisonInput,
  type ContractComparisonReasonCode,
  type ContractComparisonStatus,
  type RegionCandidate,
  type SaleComparableSearchResult,
  type SalePriceAssessment,
  type ScreeningOutcome
} from '../domain/types.js';
import { loadConfig } from '../config.js';
import { dealYmdToRangeStart, subtractMonths, toDealYmd, toIsoDate } from '../utils/date.js';
import { candidateBrandIdentityMatches, reportedPropertyNamesMatch } from '../utils/propertyName.js';
import { median, percentDifference, range } from '../utils/stats.js';
import { resolveAddressRegion } from './addressResolver.js';
import type { MolitRentClient } from './molitClient.js';

function nextActionsForReason(reasonCode: ContractComparisonReasonCode, retryable = false): string[] {
  switch (reasonCode) {
    case 'ADDRESS_UNRESOLVED':
      return ['도로명주소, 지번주소 또는 시군구와 법정동을 포함해 다시 입력하세요.'];
    case 'ADDRESS_AMBIGUOUS':
      return ['도로명주소나 지번주소를 더 구체적으로 입력하세요.'];
    case 'NO_CONTRACT_TYPE_MATCH':
      return ['전세 또는 월세 조건이 맞는지 확인해 다시 조회하세요.'];
    case 'NO_LEGAL_DONG_MATCH':
      return ['법정동이 정확한지 확인하거나 도로명·지번주소를 더 구체적으로 입력하세요.'];
    case 'NO_COMPLEX_MATCH':
      return ['단지명을 빼거나 공식 단지명으로 바꿔 다시 조회하세요.'];
    case 'NO_AREA_MATCH':
      return [
        '아파트·오피스텔·연립다세대는 입력 면적이 공급면적이 아닌 전용면적인지 확인하세요.',
        '면적 허용 범위를 넓혀 다시 조회하세요.'
      ];
    case 'NO_REPORTED_DEALS':
      return ['조회 기간을 넓혀 다시 조회하세요.'];
    case 'API_KEY_MISSING':
      return ['서비스 관리자에게 공공데이터 API 설정을 확인해 달라고 요청하세요.'];
    case 'API_AUTH_ERROR':
      return ['공공데이터 API 키의 활용신청 승인 상태와 호출 권한을 확인하세요.'];
    case 'INVALID_REQUEST':
      return ['조회 기간과 입력 조건을 확인한 뒤 다시 요청하세요.'];
    case 'MATCHES_FOUND':
      return [];
    default:
      return retryable
        ? ['잠시 후 다시 시도하세요.']
        : ['서비스 관리자에게 공공데이터 요청 설정과 응답 상태를 확인해 달라고 요청하세요.'];
  }
}

const GENERIC_BUILDING_TERMS = /아파트|오피스텔|주상복합|연립주택|다세대주택|단독주택|다가구주택|빌라/gu;
const MAX_WOLSE_DEPOSIT_DIFFERENCE_PERCENT = 25;
const SALE_PRICE_REVIEW_THRESHOLD_PERCENT = 80;

function normalizeAddressForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeBuildingName(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(GENERIC_BUILDING_TERMS, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function administrativeNameVariants(candidate: RegionCandidate): string[] {
  const suffixPattern = /(특별자치시|특별시|광역시|특별자치도|도|시|군|구|읍|면|동)$/u;
  return [candidate.sido, candidate.sigungu, candidate.eupmyeondong]
    .flatMap((value) => [value, ...value.split(/\s+/)])
    .flatMap((value) => {
      const normalized = normalizeBuildingName(value);
      return [normalized, normalized.replace(suffixPattern, '')];
    })
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function addressMentionsCandidateBuilding(address: string, candidate: RegionCandidate): boolean {
  const buildingName = normalizeBuildingName(candidate.buildingName);
  if (!buildingName || !hasDistinctBuildingIdentity(candidate)) return false;

  const requestedAddress = normalizeAddressForMatch(address);
  if (requestedAddress.includes(buildingName)) return true;

  let buildingHint = normalizeBuildingName(address);
  for (const administrativeName of administrativeNameVariants(candidate)) {
    buildingHint = buildingHint.replaceAll(administrativeName, '');
  }

  if (!buildingHint) return false;
  if (buildingHint === buildingName) return true;
  return buildingHint.length >= 4 && (buildingName.includes(buildingHint) || buildingHint.includes(buildingName));
}

function areaToleranceFor(areaM2: number): number {
  return Math.round(Math.max(2, Math.min(7, areaM2 * 0.1)) * 10) / 10;
}

function depositDifferencePercent(inputDepositKrw: number, comparableDepositKrw: number): number {
  const denominator = Math.max(inputDepositKrw, comparableDepositKrw);
  if (denominator === 0) return 0;
  return (Math.abs(inputDepositKrw - comparableDepositKrw) / denominator) * 100;
}

function pairedMonthlyRentComparables(
  inputDepositKrw: number,
  deals: ContractComparison['comparables']
): ContractComparison['comparables'] {
  return deals
    .filter(
      (deal) =>
        depositDifferencePercent(inputDepositKrw, deal.depositKrw) <= MAX_WOLSE_DEPOSIT_DIFFERENCE_PERCENT
    )
    .sort(
      (a, b) =>
        depositDifferencePercent(inputDepositKrw, a.depositKrw) -
        depositDifferencePercent(inputDepositKrw, b.depositKrw)
    );
}

function hasDistinctBuildingIdentity(candidate: RegionCandidate): boolean {
  const buildingName = normalizeBuildingName(candidate.buildingName);
  if (!buildingName) return false;

  const administrativeNames = [candidate.sido, candidate.sigungu, candidate.eupmyeondong]
    .flatMap((value) => [value, ...value.split(/\s+/)])
    .map((value) => normalizeBuildingName(value))
    .filter(Boolean);
  return !administrativeNames.includes(buildingName);
}

function normalizedCandidateAddressBase(value: string, candidate: RegionCandidate): string {
  const normalizedAddress = normalizeAddressForMatch(value);
  const normalizedBuildingName = normalizeAddressForMatch(candidate.buildingName ?? '');
  return normalizedBuildingName && normalizedAddress.endsWith(normalizedBuildingName)
    ? normalizedAddress.slice(0, -normalizedBuildingName.length)
    : normalizedAddress;
}

function addressIdentifiesCandidateProperty(address: string, candidate: RegionCandidate): boolean {
  const requestedAddress = normalizeAddressForMatch(address);
  const addressTokens = new Set(
    address
      .normalize('NFKC')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter(Boolean)
  );
  const mostSpecificDistrict = (candidate.sigungu.split(/\s+/).filter(Boolean).at(-1) ?? '')
    .normalize('NFKC')
    .toLowerCase();
  const hasCompleteAddressNumber = /(?:산)?\d+(?:-\d+)?$/u.test(requestedAddress);
  if (
    !hasCompleteAddressNumber ||
    !mostSpecificDistrict ||
    !addressTokens.has(mostSpecificDistrict)
  ) {
    return false;
  }

  return [candidate.roadAddress, candidate.jibunAddress]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizedCandidateAddressBase(value, candidate).endsWith(requestedAddress));
}

function candidatePropertyIdentity(candidate: RegionCandidate): string {
  const addressIdentity = candidate.jibunAddress ?? candidate.roadAddress;
  if (addressIdentity) return normalizeAddressForMatch(addressIdentity);
  return candidate.buildingManagementNumber ?? '';
}

function candidateParcelNumber(candidate: RegionCandidate): number | null {
  const match = candidate.jibunAddress?.match(/\s(?:산\s*)?(\d{1,4})(?:-\d{1,4})?(?=\s|$)/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function representsOneNamedComplex(candidates: RegionCandidate[]): boolean {
  if (candidates.length === 0) return false;
  const groupKeys = new Set(
    candidates.map(
      (candidate) =>
        `${candidate.lawdCode}|${candidate.eupmyeondong}|${normalizeBuildingName(candidate.buildingName)}`
    )
  );
  if (groupKeys.size !== 1) return false;

  const propertyIdentities = new Set(candidates.map(candidatePropertyIdentity));
  if (propertyIdentities.size === 1) return true;

  const parcelNumbers = candidates.map(candidateParcelNumber);
  if (parcelNumbers.some((value) => value === null)) return false;
  const values = parcelNumbers as number[];
  return Math.max(...values) - Math.min(...values) <= 10;
}

function candidateDecision(
  input: ContractComparisonInput,
  addressResolution: AddressResolution
): { selected?: RegionCandidate; buildingName?: string; ambiguous: boolean } {
  const candidates = addressResolution.candidates;
  if (candidates.length === 0) return { ambiguous: false };

  const requestedAddress = normalizeAddressForMatch(input.address);
  const exactCandidates = candidates.filter((candidate) =>
    [candidate.roadAddress, candidate.jibunAddress]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizeAddressForMatch(value) === requestedAddress)
  );
  if (exactCandidates.length === 1) {
    const selected = exactCandidates[0];
    return { selected, buildingName: selected?.buildingName, ambiguous: false };
  }

  const exactPropertyCandidates = candidates.filter(
    (candidate) => hasDistinctBuildingIdentity(candidate) && addressIdentifiesCandidateProperty(input.address, candidate)
  );
  if (exactPropertyCandidates.length === 1) {
    const selected = exactPropertyCandidates[0];
    return { selected, buildingName: selected?.buildingName, ambiguous: false };
  }
  if (exactPropertyCandidates.length > 1) return { ambiguous: true };

  const brandAssistedCandidate = candidates.length === 1 ? candidates[0] : undefined;
  if (
    brandAssistedCandidate &&
    addressResolution.lookupReasonCode === 'BRAND_ASSISTED_MATCH_FOUND' &&
    hasDistinctBuildingIdentity(brandAssistedCandidate) &&
    candidateBrandIdentityMatches(
      input.complexName ? `${input.address} ${input.complexName}` : input.address,
      brandAssistedCandidate.buildingName
    )
  ) {
    const selected = brandAssistedCandidate;
    return { selected, buildingName: selected?.buildingName, ambiguous: false };
  }

  const requestedBuilding = normalizeBuildingName(input.complexName);
  if (requestedBuilding) {
    const candidatesWithBuildingIdentity = candidates.filter(hasDistinctBuildingIdentity);
    if (
      candidatesWithBuildingIdentity.length === 0 &&
      new Set(candidates.map((candidate) => candidate.lawdCode)).size === 1
    ) {
      return { selected: candidates[0], ambiguous: false };
    }

    const buildingCandidates = candidatesWithBuildingIdentity.filter((candidate) => {
      const buildingName = normalizeBuildingName(candidate.buildingName);
      if (!buildingName) return false;
      return reportedPropertyNamesMatch(input.complexName ?? '', candidate.buildingName);
    });
    if (representsOneNamedComplex(buildingCandidates)) {
      const selected = buildingCandidates[0];
      return { selected, buildingName: selected?.buildingName, ambiguous: false };
    }
    return { ambiguous: true };
  }

  const inferredBuildingCandidates = candidates.filter((candidate) =>
    addressMentionsCandidateBuilding(input.address, candidate)
  );
  if (representsOneNamedComplex(inferredBuildingCandidates)) {
    const selected = inferredBuildingCandidates[0];
    return { selected, buildingName: selected?.buildingName, ambiguous: false };
  }

  if (new Set(candidates.map((candidate) => candidate.lawdCode)).size > 1) {
    return { ambiguous: true };
  }

  if (candidates.length === 1) {
    const selected = candidates[0];
    const canInferBuilding =
      selected !== undefined &&
      addressMentionsCandidateBuilding(input.address, selected);
    return {
      selected,
      buildingName: canInferBuilding ? selected?.buildingName : undefined,
      ambiguous: false
    };
  }

  return { selected: candidates[0], ambiguous: false };
}

function withSelectedCandidate(addressResolution: AddressResolution, selected: RegionCandidate): AddressResolution {
  return {
    ...addressResolution,
    normalizedRegionName: selected.regionName,
    lawdCode: selected.lawdCode,
    candidates: [selected, ...addressResolution.candidates.filter((candidate) => candidate !== selected)]
  };
}

function comparisonPeriod(now: Date, monthsBack: number): ContractComparison['period'] {
  const fromYmd = toDealYmd(subtractMonths(now, monthsBack - 1));
  return {
    from: dealYmdToRangeStart(fromYmd),
    to: toIsoDate(now),
    monthsBack
  };
}

function emptyComparison(
  input: ContractComparisonInput,
  addressResolution: AddressResolution,
  now: Date,
  monthsBack: number,
  options: {
    status: ContractComparisonStatus;
    reasonCode: ContractComparisonReasonCode;
    retryable: boolean;
    comparisonSummary: string;
    dataNotice: string;
    nextActions?: string[];
  }
): ContractComparison {
  return {
    addressResolution,
    comparableSource: 'unavailable',
    comparisonScope: 'UNAVAILABLE',
    scopeReason: '주소 또는 공공데이터를 확인하지 못해 비교 범위를 확정하지 못했습니다.',
    areaToleranceM2: areaToleranceFor(input.areaM2),
    searchComplete: false,
    confidence: 'UNAVAILABLE',
    confidenceReasons: ['비교 가능한 공공데이터 표본이 없습니다.'],
    screeningOutcome: 'INSUFFICIENT_INFORMATION',
    salePriceAssessment: {
      status: 'NOT_CHECKED',
      reasonCode: 'SALE_LOOKUP_NOT_SUPPORTED',
      retryable: false,
      sampleCount: 0,
      searchComplete: false,
      medianSalePriceKrw: null,
      minSalePriceKrw: null,
      maxSalePriceKrw: null,
      depositToMedianSalePricePercent: null,
      comparisonThresholdNotice: `${SALE_PRICE_REVIEW_THRESHOLD_PERCENT}%는 집계약괜찮아의 추가 확인용 기준이며 법률 또는 보증보험 심사 기준이 아닙니다.`,
      comparables: [],
      dataNotice: '주소와 임대차 비교 범위를 확정하지 못해 매매 신고자료를 조회하지 않았습니다.'
    },
    status: options.status,
    reasonCode: options.reasonCode,
    retryable: options.retryable,
    nextActions: options.nextActions ?? nextActionsForReason(options.reasonCode, options.retryable),
    sampleCount: 0,
    period: comparisonPeriod(now, monthsBack),
    depositKrw: {
      input: input.depositKrw,
      median: null,
      min: null,
      max: null,
      differenceFromMedian: null,
      differencePercentFromMedian: null
    },
    monthlyRentKrw: {
      input: input.monthlyRentKrw,
      comparisonMethod: input.monthlyRentKrw > 0 ? 'PAIRED_NEAREST_DEPOSIT' : 'NOT_APPLICABLE',
      comparableSampleCount: 0,
      maximumDepositDifferencePercent:
        input.monthlyRentKrw > 0 ? MAX_WOLSE_DEPOSIT_DIFFERENCE_PERCENT : null,
      median: null,
      min: null,
      max: null,
      differenceFromMedian: null,
      differencePercentFromMedian: null
    },
    comparisonSummary: options.comparisonSummary,
    comparables: [],
    dataNotice: options.dataNotice,
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
}

const NO_MATCH_REASONS = new Set<ComparableReasonCode>([
  'NO_REPORTED_DEALS',
  'NO_CONTRACT_TYPE_MATCH',
  'NO_LEGAL_DONG_MATCH',
  'NO_COMPLEX_MATCH',
  'NO_AREA_MATCH'
]);

const UNAVAILABLE_REASONS = new Set<ComparableReasonCode>([
  'API_KEY_MISSING',
  'API_AUTH_ERROR',
  'API_TIMEOUT',
  'API_HTTP_ERROR',
  'API_RESPONSE_INVALID',
  'API_REQUEST_FAILED',
  'INVALID_REQUEST'
]);

function searchOutcome(result: {
  source: 'live' | 'unavailable';
  status?: 'MATCHES_FOUND' | 'NO_MATCHES' | 'LIVE_DATA_UNAVAILABLE' | 'INVALID_REQUEST';
  deals: unknown[];
  reasonCode?: ComparableReasonCode;
  retryable?: boolean;
}): {
  status: ContractComparisonStatus;
  reasonCode: ComparableReasonCode;
  retryable: boolean;
} {
  if (
    result.source === 'unavailable' ||
    result.status === 'LIVE_DATA_UNAVAILABLE' ||
    result.status === 'INVALID_REQUEST'
  ) {
    return {
      status: 'LIVE_DATA_UNAVAILABLE',
      reasonCode:
        result.reasonCode && UNAVAILABLE_REASONS.has(result.reasonCode) ? result.reasonCode : 'API_REQUEST_FAILED',
      retryable: result.retryable ?? true
    };
  }

  if (result.status === 'NO_MATCHES' && result.deals.length > 0) {
    return { status: 'LIVE_DATA_UNAVAILABLE', reasonCode: 'API_RESPONSE_INVALID', retryable: true };
  }

  if (result.deals.length > 0) {
    return { status: 'COMPARED', reasonCode: 'MATCHES_FOUND', retryable: false };
  }

  return {
    status: 'NO_MATCHES',
    reasonCode: result.reasonCode && NO_MATCH_REASONS.has(result.reasonCode) ? result.reasonCode : 'NO_REPORTED_DEALS',
    retryable: false
  };
}

function summarize(input: ContractComparisonInput, result: ContractComparison): string {
  if (result.status === 'LIVE_DATA_UNAVAILABLE') {
    return `국토교통부 공공데이터를 조회하지 못해 계약 조건 비교를 수행하지 못했습니다.${result.retryable ? ' 잠시 후 다시 시도해 주세요.' : ''}`;
  }
  if (result.status === 'NO_MATCHES' || result.sampleCount === 0) {
    switch (result.reasonCode) {
      case 'NO_CONTRACT_TYPE_MATCH':
        return '공공데이터 조회는 완료됐지만 요청한 전세·월세 유형과 일치하는 신고자료가 없습니다.';
      case 'NO_LEGAL_DONG_MATCH':
        return '공공데이터 조회는 완료됐지만 확인된 법정동과 일치하는 신고자료가 없습니다. 주소의 법정동을 다시 확인해 주세요.';
      case 'NO_COMPLEX_MATCH':
        return '공공데이터 조회는 완료됐지만 요청한 단지명과 일치하는 신고자료가 없습니다. 공식 단지명을 확인하거나 단지명 조건을 빼고 다시 조회해 주세요.';
      case 'NO_AREA_MATCH':
        return '공공데이터 조회는 완료됐지만 요청한 면적 범위와 일치하는 신고자료가 없습니다. 아파트·오피스텔·연립다세대는 입력값이 전용면적인지 먼저 확인하고, 전용면적이 맞다면 허용 범위를 조정해 다시 확인해 주세요.';
      default:
        return '공공데이터 조회는 완료됐지만 해당 지역과 기간에 비교할 신고자료가 없습니다. 조회 기간을 넓혀 다시 확인해 주세요.';
    }
  }

  const depositDiff = result.depositKrw.differencePercentFromMedian;
  const rentDiff = result.monthlyRentKrw.differencePercentFromMedian;
  const scopeLabel =
    result.comparisonScope === 'SAME_REPORTED_PROPERTY'
      ? '동일 신고 건물·단지명'
      : result.comparisonScope === 'REQUESTED_PROPERTY_REFERENCE'
        ? '사용자 입력 건물·단지명 참고자료'
      : result.comparisonScope === 'SAME_LEGAL_DONG'
        ? '동일 법정동 참고자료'
        : '시군구 참고자료';
  const fragments = [`${scopeLabel} 최근 ${result.sampleCount}건 기준`];

  if (depositDiff !== null) {
    fragments.push(`보증금은 중앙값 대비 ${depositDiff >= 0 ? '+' : ''}${depositDiff}%`);
  }
  if (input.monthlyRentKrw > 0 && rentDiff !== null) {
    fragments.push(`월세는 중앙값 대비 ${rentDiff >= 0 ? '+' : ''}${rentDiff}%`);
  }

  const methodNotice =
    input.monthlyRentKrw > 0
      ? ` 월세는 입력 보증금과 차이가 ${MAX_WOLSE_DEPOSIT_DIFFERENCE_PERCENT}% 이내인 ${result.monthlyRentKrw.comparableSampleCount}건만 짝지어 비교했으며 전월세전환율을 적용한 등가 비교는 아닙니다.`
      : '';
  return `${fragments.join(', ')}입니다.${methodNotice} 비교 신뢰도는 ${result.confidence}이며, ${result.scopeReason}`;
}

function scopeForComparison(
  input: ContractComparisonInput,
  addressResolution: AddressResolution,
  decision: { buildingName?: string }
): {
  comparisonScope: ComparisonScope;
  scopeReason: string;
  resolvedBuildingName?: string;
  comparisonPropertyName?: string;
  legalDongName?: string;
} {
  const resolvedBuildingName = decision.buildingName?.trim();
  const requestedPropertyName = input.complexName?.trim();
  const legalDongName = addressResolution.candidates[0]?.eupmyeondong;
  if (resolvedBuildingName) {
    return {
      comparisonScope: 'SAME_REPORTED_PROPERTY',
      scopeReason: `도로명주소에서 확인한 건물·단지명 "${resolvedBuildingName}"과 법정동이 모두 일치하는 유사 면적 신고자료를 사용했습니다. 국토교통부 신고자료에는 건물관리번호가 없어 개별 동·호 동일성까지 입증하지는 않습니다.`,
      resolvedBuildingName,
      comparisonPropertyName: resolvedBuildingName,
      legalDongName
    };
  }

  if (requestedPropertyName) {
    return {
      comparisonScope: 'REQUESTED_PROPERTY_REFERENCE',
      scopeReason: `사용자가 입력한 건물·단지명 "${requestedPropertyName}"을 도로명주소에서 검증하지 못해 참고자료로만 비교했습니다. 계약 단위 스크리닝에는 정보가 부족합니다.`,
      comparisonPropertyName: requestedPropertyName,
      legalDongName
    };
  }

  if (legalDongName) {
    return {
      comparisonScope: 'SAME_LEGAL_DONG',
      scopeReason: `건물명을 확정하지 못해 ${legalDongName}의 유사 면적 거래를 참고자료로만 비교했습니다. 계약 단위 판단에는 정보가 부족합니다.`,
      legalDongName
    };
  }

  return {
    comparisonScope: 'DISTRICT_REFERENCE',
    scopeReason: '건물과 법정동을 확정하지 못해 시군구 거래를 참고자료로만 비교했습니다. 계약 단위 판단에는 정보가 부족합니다.'
  };
}

function relativeSpread(values: number[]): number | null {
  const valueMedian = median(values);
  const valueRange = range(values);
  if (valueMedian === null || valueMedian <= 0 || valueRange.min === null || valueRange.max === null) return null;
  return (valueRange.max - valueRange.min) / valueMedian;
}

function assessComparisonQuality(
  comparisonScope: ComparisonScope,
  status: ContractComparisonStatus,
  searchComplete: boolean,
  deals: ContractComparison['comparables'],
  now: Date,
  isWolse: boolean,
  monthlyRentComparableSampleCount: number
): { confidence: ComparisonConfidence; reasons: string[] } {
  if (status !== 'COMPARED' || deals.length === 0) {
    return { confidence: 'UNAVAILABLE', reasons: ['비교 가능한 공공데이터 표본이 없습니다.'] };
  }

  const reasons: string[] = [];
  if (comparisonScope !== 'SAME_REPORTED_PROPERTY') {
    reasons.push('도로명주소에서 검증한 건물·단지명 범위가 아니므로 계약 단위 비교 신뢰도가 낮습니다.');
    return { confidence: 'LOW', reasons };
  }
  if (deals.length < 5) {
    reasons.push(`동일 신고 건물·단지명 표본이 ${deals.length}건으로 5건보다 적습니다.`);
    return { confidence: 'LOW', reasons };
  }

  let confidence: ComparisonConfidence = 'HIGH';
  if (!searchComplete) {
    confidence = 'MEDIUM';
    reasons.push('요청 기간 전체 검색이 완료되지 않았습니다.');
  }

  const newestDate = deals.reduce((latest, deal) => (deal.contractDate > latest ? deal.contractDate : latest), '');
  const newestTime = Date.parse(`${newestDate}T00:00:00.000Z`);
  if (!Number.isFinite(newestTime) || now.getTime() - newestTime > 180 * 24 * 60 * 60 * 1000) {
    confidence = 'MEDIUM';
    reasons.push('가장 최근 표본이 180일보다 오래됐습니다.');
  }

  const spreads = [
    relativeSpread(deals.map((deal) => deal.depositKrw)),
    relativeSpread(deals.filter((deal) => deal.monthlyRentKrw > 0).map((deal) => deal.monthlyRentKrw))
  ].filter((value): value is number => value !== null);
  if (spreads.some((spread) => spread > 0.5)) {
    confidence = 'MEDIUM';
    reasons.push('표본 금액 분산이 커서 중앙값만으로 비교하기 어렵습니다.');
  }

  if (isWolse && monthlyRentComparableSampleCount < 3) {
    confidence = 'LOW';
    reasons.push(
      `입력 보증금과 차이가 ${MAX_WOLSE_DEPOSIT_DIFFERENCE_PERCENT}% 이내인 월세 표본이 ${monthlyRentComparableSampleCount}건입니다.`
    );
  }

  if (reasons.length === 0) {
    reasons.push('도로명주소에서 검증한 동일 신고 건물·단지명의 최근 표본 5건 이상과 전체 검색 결과를 사용했습니다.');
  }
  return { confidence, reasons };
}

function screeningOutcomeFor(
  comparisonScope: ComparisonScope,
  status: ContractComparisonStatus,
  sampleCount: number,
  confidence: ComparisonConfidence,
  input: ContractComparisonInput,
  monthlyRentComparableSampleCount: number,
  salePriceAssessment: SalePriceAssessment,
  depositDifferencePercent: number | null,
  rentDifferencePercent: number | null
): ScreeningOutcome {
  if (status !== 'COMPARED' || sampleCount < 3 || comparisonScope !== 'SAME_REPORTED_PROPERTY') {
    return 'INSUFFICIENT_INFORMATION';
  }

  if (input.monthlyRentKrw > 0 && monthlyRentComparableSampleCount < 3) {
    return 'ADDITIONAL_VERIFICATION_REQUIRED';
  }
  if (
    input.depositKrw > 0 &&
    (salePriceAssessment.status !== 'ASSESSED' ||
      salePriceAssessment.sampleCount < 3 ||
      !salePriceAssessment.searchComplete)
  ) {
    return 'ADDITIONAL_VERIFICATION_REQUIRED';
  }
  if (
    salePriceAssessment.depositToMedianSalePricePercent !== null &&
    salePriceAssessment.depositToMedianSalePricePercent >= SALE_PRICE_REVIEW_THRESHOLD_PERCENT
  ) {
    return 'ADDITIONAL_VERIFICATION_REQUIRED';
  }
  const hasTermsDifference =
    input.monthlyRentKrw > 0
      ? rentDifferencePercent !== null && Math.abs(rentDifferencePercent) >= 25
      : depositDifferencePercent !== null && Math.abs(depositDifferencePercent) >= 25;
  if (confidence !== 'HIGH' || hasTermsDifference) return 'ADDITIONAL_VERIFICATION_REQUIRED';
  return 'NO_ADDITIONAL_PRICE_SIGNAL_FOUND';
}

function assessSalePrice(
  saleResult: SaleComparableSearchResult | undefined,
  depositKrw: number,
  lookupSupported: boolean
): SalePriceAssessment {
  const thresholdNotice = `${SALE_PRICE_REVIEW_THRESHOLD_PERCENT}%는 집계약괜찮아의 추가 확인용 기준이며 법률 또는 보증보험 심사 기준이 아닙니다.`;
  if (!lookupSupported || !saleResult) {
    return {
      status: 'NOT_CHECKED',
      reasonCode: 'SALE_LOOKUP_NOT_SUPPORTED',
      retryable: false,
      sampleCount: 0,
      searchComplete: false,
      medianSalePriceKrw: null,
      minSalePriceKrw: null,
      maxSalePriceKrw: null,
      depositToMedianSalePricePercent: null,
      comparisonThresholdNotice: thresholdNotice,
      comparables: [],
      dataNotice: '검증된 동일 신고 건물·단지명 매매 자료 조회를 수행하지 못해 보증금 수준을 확인하지 못했습니다.'
    };
  }

  const prices = saleResult.deals.map((deal) => deal.salePriceKrw);
  const priceMedian = median(prices);
  const priceRange = range(prices);
  const depositRatio =
    priceMedian === null || priceMedian <= 0 ? null : Math.round((depositKrw / priceMedian) * 1000) / 10;
  return {
    status:
      saleResult.status === 'INVALID_REQUEST'
        ? 'INVALID_REQUEST'
        : saleResult.status === 'LIVE_DATA_UNAVAILABLE'
        ? 'LIVE_DATA_UNAVAILABLE'
        : saleResult.deals.length > 0
          ? 'ASSESSED'
          : 'NO_MATCHES',
    reasonCode: saleResult.reasonCode,
    retryable: saleResult.retryable,
    sampleCount: saleResult.deals.length,
    searchComplete: saleResult.searchComplete,
    medianSalePriceKrw: priceMedian,
    minSalePriceKrw: priceRange.min,
    maxSalePriceKrw: priceRange.max,
    depositToMedianSalePricePercent: depositRatio,
    comparisonThresholdNotice: thresholdNotice,
    comparables: saleResult.deals,
    dataNotice: saleResult.dataNotice
  };
}

export async function compareContractTerms(
  input: ContractComparisonInput,
  rentClient: MolitRentClient,
  now = new Date()
): Promise<ContractComparison> {
  const monthsBack = input.monthsBack ?? 12;
  if (!Number.isInteger(monthsBack) || monthsBack < 1 || monthsBack > 12) {
    throw new Error('조회 기간은 1~12개월이어야 합니다.');
  }

  const deadlineAtMs = Date.now() + loadConfig().contractLookupTimeoutMs;
  const addressResolution = await resolveAddressRegion(
    input.address,
    input.housingType,
    undefined,
    AbortSignal.timeout(Math.max(1, deadlineAtMs - Date.now()))
  );
  const to = toDealYmd(now);
  const from = toDealYmd(subtractMonths(now, monthsBack - 1));

  if (addressResolution.lookupStatus === 'AMBIGUOUS') {
    return emptyComparison(input, addressResolution, now, monthsBack, {
      status: 'ADDRESS_AMBIGUOUS',
      reasonCode: 'ADDRESS_AMBIGUOUS',
      retryable: false,
      comparisonSummary:
        addressResolution.clarificationQuestion ??
        '입력 주소와 일치하는 지역 후보가 여러 개라 임의로 선택하지 않았습니다.',
      dataNotice: addressResolution.dataNotice,
      nextActions: addressResolution.nextActions
    });
  }

  if (!addressResolution.lawdCode) {
    if (addressResolution.lookupStatus === 'LIVE_DATA_UNAVAILABLE') {
      const reasonCode = UNAVAILABLE_REASONS.has(addressResolution.lookupReasonCode as ComparableReasonCode)
        ? (addressResolution.lookupReasonCode as ComparableReasonCode)
        : 'API_REQUEST_FAILED';
      return emptyComparison(input, addressResolution, now, monthsBack, {
        status: 'LIVE_DATA_UNAVAILABLE',
        reasonCode,
        retryable: addressResolution.retryable,
        nextActions: addressResolution.nextActions,
        comparisonSummary:
          '도로명주소 API를 사용할 수 없어 주소 해석과 유사 거래 비교를 수행하지 못했습니다.',
        dataNotice: addressResolution.dataNotice
      });
    }

    return emptyComparison(input, addressResolution, now, monthsBack, {
      status: 'ADDRESS_UNRESOLVED',
      reasonCode: 'ADDRESS_UNRESOLVED',
      retryable: false,
      comparisonSummary: '주소를 법정동 코드로 해석할 정보가 부족해 유사 거래 비교를 수행하지 못했습니다.',
      dataNotice: addressResolution.dataNotice,
      nextActions: addressResolution.nextActions
    });
  }

  const decision = candidateDecision(input, addressResolution);
  if (decision.ambiguous) {
    const clarificationQuestion =
      '입력한 단지 또는 건물을 하나로 확정하기 어렵습니다. 정확한 도로명·지번주소나 공식 단지명을 알려주세요.';
    const clarifiedAddressResolution: AddressResolution = {
      ...addressResolution,
      clarificationQuestion,
      nextActions: [
        '도로명주소나 지번주소를 더 구체적으로 입력하세요.',
        '정확한 도로명·지번주소나 공식 단지명을 포함해 다시 입력하세요.'
      ]
    };
    return emptyComparison(input, clarifiedAddressResolution, now, monthsBack, {
      status: 'ADDRESS_AMBIGUOUS',
      reasonCode: 'ADDRESS_AMBIGUOUS',
      retryable: false,
      comparisonSummary: clarificationQuestion,
      dataNotice: `${addressResolution.dataNotice} 서로 다른 주소 후보 ${addressResolution.candidates.length}개를 확인했습니다.`,
      nextActions: clarifiedAddressResolution.nextActions
    });
  }

  const selectedAddressResolution = decision.selected
    ? withSelectedCandidate(addressResolution, decision.selected)
    : addressResolution;
  const scope = scopeForComparison(input, selectedAddressResolution, decision);
  const areaToleranceM2 = areaToleranceFor(input.areaM2);

  const rentSearch = rentClient.searchRentComparables({
    lawdCode: selectedAddressResolution.lawdCode ?? addressResolution.lawdCode,
    dealYmdFrom: from,
    dealYmdTo: to,
    housingType: input.housingType,
    contractType: input.monthlyRentKrw > 0 ? 'wolse' : 'jeonse',
    legalDongName: scope.legalDongName,
    areaM2: input.areaM2,
    areaToleranceM2,
    complexName: scope.comparisonPropertyName,
    limit: 10,
    deadlineAtMs
  });
  const canSearchSameBuildingSale =
    scope.comparisonScope === 'SAME_REPORTED_PROPERTY' &&
    Boolean(scope.resolvedBuildingName) &&
    typeof rentClient.searchSaleComparables === 'function';
  const saleSearch = canSearchSameBuildingSale
    ? rentClient.searchSaleComparables?.({
        lawdCode: selectedAddressResolution.lawdCode ?? addressResolution.lawdCode,
        dealYmdFrom: from,
        dealYmdTo: to,
        housingType: input.housingType,
        legalDongName: scope.legalDongName,
        areaM2: input.areaM2,
        areaToleranceM2,
        complexName: scope.resolvedBuildingName,
        limit: 10,
        deadlineAtMs
      })
    : Promise.resolve(undefined);
  const [comparableResult, saleResult] = await Promise.all([rentSearch, saleSearch]);
  const salePriceAssessment = assessSalePrice(saleResult, input.depositKrw, canSearchSameBuildingSale);

  const outcome = searchOutcome(comparableResult);
  const usableDeals = outcome.status === 'COMPARED' ? comparableResult.deals : [];
  const isWolse = input.monthlyRentKrw > 0;
  const monthlyRentComparables = isWolse
    ? pairedMonthlyRentComparables(input.depositKrw, usableDeals)
    : usableDeals;
  const deposits = usableDeals.map((deal) => deal.depositKrw);
  const rents = monthlyRentComparables.map((deal) => deal.monthlyRentKrw);
  const depositMedian = median(deposits);
  const rentMedian = median(rents);
  const depositRange = range(deposits);
  const rentRange = range(rents);
  const searchComplete = outcome.status !== 'LIVE_DATA_UNAVAILABLE' && comparableResult.searchComplete === true;
  const comparableDataNotice =
    outcome.reasonCode === 'API_RESPONSE_INVALID'
      ? '공공데이터 API 응답 상태와 거래 목록이 일치하지 않아 해당 거래를 비교에서 제외했습니다.'
      : comparableResult.dataNotice;
  const quality = assessComparisonQuality(
    scope.comparisonScope,
    outcome.status,
    searchComplete,
    usableDeals,
    now,
    isWolse,
    isWolse ? monthlyRentComparables.length : 0
  );
  const screeningOutcome = screeningOutcomeFor(
    scope.comparisonScope,
    outcome.status,
    usableDeals.length,
    quality.confidence,
    input,
    isWolse ? monthlyRentComparables.length : 0,
    salePriceAssessment,
    percentDifference(input.depositKrw, depositMedian),
    percentDifference(input.monthlyRentKrw, rentMedian)
  );

  const result: ContractComparison = {
    addressResolution: selectedAddressResolution,
    comparableSource: outcome.status === 'LIVE_DATA_UNAVAILABLE' ? 'unavailable' : comparableResult.source,
    comparisonScope: scope.comparisonScope,
    scopeReason: scope.scopeReason,
    resolvedBuildingName: scope.resolvedBuildingName,
    comparisonPropertyName: scope.comparisonPropertyName,
    areaToleranceM2,
    searchComplete,
    confidence: quality.confidence,
    confidenceReasons: quality.reasons,
    screeningOutcome,
    salePriceAssessment,
    status: outcome.status,
    reasonCode: outcome.reasonCode,
    retryable: outcome.retryable,
    filterStats: comparableResult.filterStats,
    nextActions: comparableResult.nextActions ?? nextActionsForReason(outcome.reasonCode, outcome.retryable),
    sampleCount: usableDeals.length,
    period: comparisonPeriod(now, monthsBack),
    depositKrw: {
      input: input.depositKrw,
      median: depositMedian,
      min: depositRange.min,
      max: depositRange.max,
      differenceFromMedian: depositMedian === null ? null : input.depositKrw - depositMedian,
      differencePercentFromMedian: percentDifference(input.depositKrw, depositMedian)
    },
    monthlyRentKrw: {
      input: input.monthlyRentKrw,
      comparisonMethod: isWolse ? 'PAIRED_NEAREST_DEPOSIT' : 'NOT_APPLICABLE',
      comparableSampleCount: isWolse ? monthlyRentComparables.length : 0,
      maximumDepositDifferencePercent: isWolse ? MAX_WOLSE_DEPOSIT_DIFFERENCE_PERCENT : null,
      median: rentMedian,
      min: rentRange.min,
      max: rentRange.max,
      differenceFromMedian: rentMedian === null ? null : input.monthlyRentKrw - rentMedian,
      differencePercentFromMedian: percentDifference(input.monthlyRentKrw, rentMedian)
    },
    comparisonSummary: '',
    comparables: usableDeals,
    dataNotice:
      isWolse
        ? `${comparableDataNotice} 월세는 입력과 보증금 차이 ${MAX_WOLSE_DEPOSIT_DIFFERENCE_PERCENT}% 이내인 신고자료 ${monthlyRentComparables.length}건만 비교했습니다. 전월세전환율을 적용한 등가 비교는 아닙니다.`
        : comparableDataNotice,
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };

  return {
    ...result,
    comparisonSummary: summarize(input, result)
  };
}
