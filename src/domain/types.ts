export const SERVICE_NAME = '집계약괜찮아';

export const CONTRACT_CHECK_DISCLAIMER =
  '집계약괜찮아는 계약 전 확인을 돕는 정보만 제공합니다. 제공 결과는 전세사기 여부나 계약 안전성을 판정 또는 보장하지 않습니다. 법률, 금융, 세무 또는 투자 조언이 아니며, 실제 계약 전에는 등기부등본, 건축물대장, 중개대상물 확인설명서, 공적 신고자료와 전문가 확인을 별도로 진행해야 합니다.';

export type HousingType = 'apartment' | 'officetel' | 'villa' | 'detachedMultiFamily';
export type ContractType = 'jeonse' | 'wolse';
export type AddressLookupStatus = 'MATCHED' | 'AMBIGUOUS' | 'NO_MATCHES' | 'LIVE_DATA_UNAVAILABLE';
export type AddressLookupReasonCode =
  | 'MATCHES_FOUND'
  | 'BRAND_ASSISTED_MATCH_FOUND'
  | 'MULTIPLE_ADDRESS_MATCHES'
  | 'LOCAL_MATCH_FOUND'
  | 'NO_ADDRESS_MATCH'
  | 'API_KEY_MISSING'
  | 'API_AUTH_ERROR'
  | 'API_TIMEOUT'
  | 'API_HTTP_ERROR'
  | 'API_RESPONSE_INVALID'
  | 'API_REQUEST_FAILED'
  | 'INVALID_REQUEST';

export interface RegionCandidate {
  regionName: string;
  lawdCode: string;
  legalDongCode: string;
  sido: string;
  sigungu: string;
  eupmyeondong: string;
  confidence: 'high' | 'medium' | 'low';
  matchReason: string;
  source?: 'local' | 'juso';
  roadAddress?: string;
  jibunAddress?: string;
  buildingName?: string;
  administrativeCode?: string;
  buildingManagementNumber?: string;
}

export interface AddressClarificationOption {
  regionName: string;
  lawdCode: string;
  eupmyeondong: string;
}

export interface AddressResolution {
  normalizedAddress: string;
  normalizedRegionName: string | null;
  lawdCode: string | null;
  candidates: RegionCandidate[];
  source: 'local' | 'juso';
  lookupStatus: AddressLookupStatus;
  lookupReasonCode: AddressLookupReasonCode;
  retryable: boolean;
  nextActions: string[];
  clarificationQuestion?: string;
  clarificationOptions?: AddressClarificationOption[];
  dataNotice: string;
  disclaimer: string;
}

export interface RentDeal {
  id: string;
  lawdCode: string;
  regionName: string;
  housingType: HousingType;
  contractDate: string;
  contractType: ContractType;
  depositKrw: number;
  monthlyRentKrw: number;
  areaM2: number;
  floor?: number;
  builtYear?: number;
  complexName?: string;
  source: 'live';
  sourceNotice?: string;
}

export interface SaleDeal {
  id: string;
  lawdCode: string;
  regionName: string;
  housingType: HousingType;
  contractDate: string;
  salePriceKrw: number;
  areaM2: number;
  floor?: number;
  builtYear?: number;
  complexName?: string;
  source: 'live';
}

export interface SaleComparableSearchInput {
  lawdCode: string;
  dealYmdFrom: string;
  dealYmdTo: string;
  housingType: HousingType;
  legalDongName?: string;
  areaM2?: number;
  areaToleranceM2?: number;
  complexName?: string;
  limit?: number;
  deadlineAtMs?: number;
}

export interface ComparableSearchInput {
  lawdCode: string;
  dealYmdFrom: string;
  dealYmdTo: string;
  housingType: HousingType;
  contractType?: ContractType;
  legalDongName?: string;
  areaM2?: number;
  areaToleranceM2?: number;
  complexName?: string;
  limit?: number;
  deadlineAtMs?: number;
}

export type ComparableSearchStatus = 'MATCHES_FOUND' | 'NO_MATCHES' | 'LIVE_DATA_UNAVAILABLE' | 'INVALID_REQUEST';

export type ComparableReasonCode =
  | 'MATCHES_FOUND'
  | 'NO_REPORTED_DEALS'
  | 'NO_CONTRACT_TYPE_MATCH'
  | 'NO_LEGAL_DONG_MATCH'
  | 'NO_COMPLEX_MATCH'
  | 'NO_AREA_MATCH'
  | 'API_KEY_MISSING'
  | 'API_AUTH_ERROR'
  | 'API_TIMEOUT'
  | 'API_HTTP_ERROR'
  | 'API_RESPONSE_INVALID'
  | 'API_REQUEST_FAILED'
  | 'INVALID_REQUEST';

export interface ComparableFilterStats {
  raw: number;
  afterContractType: number;
  afterLegalDong?: number;
  afterComplexName: number;
  afterArea: number;
}

export interface ComparableSearchResult {
  source: 'live' | 'unavailable';
  requiresLiveData: boolean;
  status?: ComparableSearchStatus;
  reasonCode?: ComparableReasonCode;
  retryable?: boolean;
  filterStats?: ComparableFilterStats;
  nextActions?: string[];
  searchComplete?: boolean;
  requestedMonthCount?: number;
  searchedMonthCount?: number;
  dataNotice: string;
  deals: RentDeal[];
  totalMatched: number;
  disclaimer: string;
}

export interface SaleComparableSearchResult {
  source: 'live' | 'unavailable';
  status: ComparableSearchStatus;
  reasonCode: ComparableReasonCode;
  retryable: boolean;
  filterStats?: ComparableFilterStats;
  nextActions: string[];
  searchComplete: boolean;
  requestedMonthCount?: number;
  searchedMonthCount?: number;
  dataNotice: string;
  deals: SaleDeal[];
  totalMatched: number;
  disclaimer: string;
}

export interface ContractComparisonInput {
  address: string;
  housingType: HousingType;
  depositKrw: number;
  monthlyRentKrw: number;
  areaM2: number;
  monthsBack?: number;
  complexName?: string;
}

export type ContractComparisonStatus =
  | 'COMPARED'
  | 'NO_MATCHES'
  | 'ADDRESS_UNRESOLVED'
  | 'ADDRESS_AMBIGUOUS'
  | 'LIVE_DATA_UNAVAILABLE';

export type ContractComparisonReasonCode = ComparableReasonCode | 'ADDRESS_UNRESOLVED' | 'ADDRESS_AMBIGUOUS';

export type ComparisonScope =
  | 'SAME_REPORTED_PROPERTY'
  | 'REQUESTED_PROPERTY_REFERENCE'
  | 'SAME_LEGAL_DONG'
  | 'DISTRICT_REFERENCE'
  | 'UNAVAILABLE';
export type ComparisonConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE';
export type ScreeningOutcome =
  | 'NO_ADDITIONAL_PRICE_SIGNAL_FOUND'
  | 'ADDITIONAL_VERIFICATION_REQUIRED'
  | 'INSUFFICIENT_INFORMATION';
export type PriceComparisonPosition =
  | 'BELOW_COMPARABLE_RANGE'
  | 'WITHIN_COMPARABLE_RANGE'
  | 'ABOVE_COMPARABLE_RANGE'
  | 'INSUFFICIENT_DATA';

export interface PricePositionAssessment {
  basis: 'JEONSE_DEPOSIT' | 'WOLSE_MONTHLY_RENT_PAIRED_BY_DEPOSIT' | 'UNAVAILABLE';
  position: PriceComparisonPosition;
  inputKrw: number;
  medianKrw: number | null;
  minKrw: number | null;
  maxKrw: number | null;
  comparableSampleCount: number;
  summary: string;
}

export interface SalePriceAssessment {
  status: 'ASSESSED' | 'NO_MATCHES' | 'LIVE_DATA_UNAVAILABLE' | 'INVALID_REQUEST' | 'NOT_CHECKED';
  reasonCode: ComparableReasonCode | 'SALE_LOOKUP_NOT_SUPPORTED';
  retryable: boolean;
  sampleCount: number;
  searchComplete: boolean;
  medianSalePriceKrw: number | null;
  minSalePriceKrw: number | null;
  maxSalePriceKrw: number | null;
  depositToMedianSalePricePercent: number | null;
  comparisonThresholdNotice: string;
  comparables: SaleDeal[];
  dataNotice: string;
}

export interface ContractComparison {
  addressResolution: AddressResolution;
  comparableSource: 'live' | 'unavailable';
  comparisonScope: ComparisonScope;
  scopeReason: string;
  resolvedBuildingName?: string;
  comparisonPropertyName?: string;
  areaToleranceM2: number;
  searchComplete: boolean;
  confidence: ComparisonConfidence;
  confidenceReasons: string[];
  screeningOutcome: ScreeningOutcome;
  salePriceAssessment: SalePriceAssessment;
  status?: ContractComparisonStatus;
  reasonCode?: ContractComparisonReasonCode;
  retryable?: boolean;
  filterStats?: ComparableFilterStats;
  nextActions?: string[];
  sampleCount: number;
  period: {
    from: string;
    to: string;
    monthsBack: number;
  };
  depositKrw: {
    input: number;
    median: number | null;
    min: number | null;
    max: number | null;
    differenceFromMedian: number | null;
    differencePercentFromMedian: number | null;
  };
  monthlyRentKrw: {
    input: number;
    comparisonMethod: 'PAIRED_NEAREST_DEPOSIT' | 'NOT_APPLICABLE';
    comparableSampleCount: number;
    maximumDepositDifferencePercent: number | null;
    median: number | null;
    min: number | null;
    max: number | null;
    differenceFromMedian: number | null;
    differencePercentFromMedian: number | null;
  };
  comparisonSummary: string;
  comparables: RentDeal[];
  dataNotice: string;
  disclaimer: string;
}

export interface CheckSignal {
  code: string;
  label: string;
  detail: string;
  suggestedVerification: string;
}

export interface PrecontractCheckResult {
  screeningOutcome: ScreeningOutcome;
  screeningSummary: string;
  pricePosition: PricePositionAssessment;
  checkSignals: CheckSignal[];
  itemsToVerify: string[];
  notAutomaticallyVerifiedItems: string[];
  comparison?: ContractComparison;
  disclaimer: string;
}

export interface ChecklistResult {
  questionsForLessorOrAgent: string[];
  documentsToReview: string[];
  notAutomaticallyVerifiedItems: string[];
  disclaimer: string;
}
