import {
  CONTRACT_CHECK_DISCLAIMER,
  type AddressResolution,
  type ComparableReasonCode,
  type ContractComparison,
  type ContractComparisonInput,
  type ContractComparisonReasonCode,
  type ContractComparisonStatus,
  type RegionCandidate
} from '../domain/types.js';
import { loadConfig } from '../config.js';
import { dealYmdToRangeStart, subtractMonths, toDealYmd, toIsoDate } from '../utils/date.js';
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
    case 'NO_COMPLEX_MATCH':
      return ['단지명을 빼거나 공식 단지명으로 바꿔 다시 조회하세요.'];
    case 'NO_AREA_MATCH':
      return ['면적 허용 범위를 넓혀 다시 조회하세요.'];
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
  if (candidates.length === 1) {
    return { selected: candidates[0], buildingName: candidates[0]?.buildingName, ambiguous: false };
  }

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

  const requestedBuilding = normalizeBuildingName(input.complexName);
  const buildingCandidates = candidates.filter((candidate) => {
    const buildingName = normalizeBuildingName(candidate.buildingName);
    if (!buildingName) return false;
    if (requestedBuilding) {
      return buildingName.includes(requestedBuilding) || requestedBuilding.includes(buildingName);
    }
    return requestedAddress.includes(buildingName);
  });
  if (representsOneNamedComplex(buildingCandidates)) {
    const selected = buildingCandidates[0];
    return { selected, buildingName: selected?.buildingName, ambiguous: false };
  }

  return { ambiguous: true };
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
  deals: unknown[];
  reasonCode?: ComparableReasonCode;
  retryable?: boolean;
}): {
  status: ContractComparisonStatus;
  reasonCode: ComparableReasonCode;
  retryable: boolean;
} {
  if (result.deals.length > 0) {
    return { status: 'COMPARED', reasonCode: 'MATCHES_FOUND', retryable: false };
  }

  if (result.source === 'unavailable') {
    return {
      status: 'LIVE_DATA_UNAVAILABLE',
      reasonCode:
        result.reasonCode && UNAVAILABLE_REASONS.has(result.reasonCode) ? result.reasonCode : 'API_REQUEST_FAILED',
      retryable: result.retryable ?? true
    };
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
      case 'NO_COMPLEX_MATCH':
        return '공공데이터 조회는 완료됐지만 요청한 단지명과 일치하는 신고자료가 없습니다. 공식 단지명을 확인하거나 단지명 조건을 빼고 다시 조회해 주세요.';
      case 'NO_AREA_MATCH':
        return '공공데이터 조회는 완료됐지만 요청한 면적 범위와 일치하는 신고자료가 없습니다. 면적 허용 범위를 넓혀 다시 확인해 주세요.';
      default:
        return '공공데이터 조회는 완료됐지만 해당 지역과 기간에 비교할 신고자료가 없습니다. 조회 기간을 넓혀 다시 확인해 주세요.';
    }
  }

  const depositDiff = result.depositKrw.differencePercentFromMedian;
  const rentDiff = result.monthlyRentKrw.differencePercentFromMedian;
  const fragments = [`최근 ${result.sampleCount}건의 유사 표본 기준`];

  if (depositDiff !== null) {
    fragments.push(`보증금은 중앙값 대비 ${depositDiff >= 0 ? '+' : ''}${depositDiff}%`);
  }
  if (input.monthlyRentKrw > 0 && rentDiff !== null) {
    fragments.push(`월세는 중앙값 대비 ${rentDiff >= 0 ? '+' : ''}${rentDiff}%`);
  }

  const methodNotice =
    input.monthlyRentKrw > 0
      ? ' 보증금과 월세를 각각 비교한 값이며 전월세전환율을 적용한 등가 비교는 아닙니다.'
      : '';
  return `${fragments.join(', ')}입니다.${methodNotice} 표본 출처와 주소 매칭 정확도를 함께 확인하세요.`;
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
    return emptyComparison(input, addressResolution, now, monthsBack, {
      status: 'ADDRESS_AMBIGUOUS',
      reasonCode: 'ADDRESS_AMBIGUOUS',
      retryable: false,
      comparisonSummary:
        '입력 주소와 일치하는 후보가 여러 개라 임의로 선택하지 않았습니다. 도로명주소나 지번주소를 더 구체적으로 입력해 주세요.',
      dataNotice: `${addressResolution.dataNotice} 서로 다른 주소 후보 ${addressResolution.candidates.length}개를 확인했습니다.`
    });
  }

  const selectedAddressResolution = decision.selected
    ? withSelectedCandidate(addressResolution, decision.selected)
    : addressResolution;
  const primaryAddressCandidate = selectedAddressResolution.candidates[0];
  const resolvedBuildingName =
    selectedAddressResolution.source === 'juso' && primaryAddressCandidate?.confidence === 'high'
      ? decision.buildingName ?? primaryAddressCandidate.buildingName
      : undefined;

  const comparableResult = await rentClient.searchRentComparables({
    lawdCode: selectedAddressResolution.lawdCode ?? addressResolution.lawdCode,
    dealYmdFrom: from,
    dealYmdTo: to,
    housingType: input.housingType,
    contractType: input.monthlyRentKrw > 0 ? 'wolse' : 'jeonse',
    areaM2: input.areaM2,
    areaToleranceM2: 7,
    complexName: input.complexName ?? resolvedBuildingName,
    limit: 10,
    deadlineAtMs
  });

  const deposits = comparableResult.deals.map((deal) => deal.depositKrw);
  const rents = comparableResult.deals.map((deal) => deal.monthlyRentKrw);
  const depositMedian = median(deposits);
  const rentMedian = median(rents);
  const depositRange = range(deposits);
  const rentRange = range(rents);
  const outcome = searchOutcome(comparableResult);

  const result: ContractComparison = {
    addressResolution: selectedAddressResolution,
    comparableSource: comparableResult.source,
    status: outcome.status,
    reasonCode: outcome.reasonCode,
    retryable: outcome.retryable,
    filterStats: comparableResult.filterStats,
    nextActions: comparableResult.nextActions ?? nextActionsForReason(outcome.reasonCode, outcome.retryable),
    sampleCount: comparableResult.deals.length,
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
      median: rentMedian,
      min: rentRange.min,
      max: rentRange.max,
      differenceFromMedian: rentMedian === null ? null : input.monthlyRentKrw - rentMedian,
      differencePercentFromMedian: percentDifference(input.monthlyRentKrw, rentMedian)
    },
    comparisonSummary: '',
    comparables: comparableResult.deals,
    dataNotice:
      input.monthlyRentKrw > 0
        ? `${comparableResult.dataNotice} 월세 계약은 보증금과 월세를 각각 비교한 단순 참고값이며 전월세전환율을 적용한 등가 비교가 아닙니다.`
        : comparableResult.dataNotice,
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };

  return {
    ...result,
    comparisonSummary: summarize(input, result)
  };
}
