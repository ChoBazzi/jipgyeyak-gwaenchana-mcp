import {
  CONTRACT_CHECK_DISCLAIMER,
  type CheckSignal,
  type ContractComparison,
  type ContractComparisonInput,
  type PrecontractCheckResult
} from '../domain/types.js';
import type { MolitRentClient } from './molitClient.js';
import { compareContractTerms } from './comparisonService.js';

function buildSignals(comparison: ContractComparison): CheckSignal[] {
  const signals: CheckSignal[] = [];

  if (comparison.addressResolution.candidates.length === 0) {
    signals.push({
      code: 'ADDRESS_MATCH_UNCERTAIN',
      label: '주소 매칭 확인 필요',
      detail: '입력 주소를 법정동 코드로 해석할 정보가 부족합니다.',
      suggestedVerification: '도로명주소, 지번주소, 건축물대장 주소가 서로 일치하는지 확인하세요.'
    });
  }

  if (comparison.sampleCount < 3) {
    signals.push({
      code: 'LOW_SAMPLE_COUNT',
      label: '유사 거래 표본 수 부족',
      detail: `현재 조건에서 유사 표본은 ${comparison.sampleCount}건입니다.`,
      suggestedVerification: '면적 허용 범위, 단지명 조건, 조회 기간을 넓혀 공공데이터 신고자료를 다시 확인하세요.'
    });
  }

  const depositDiff = comparison.depositKrw.differencePercentFromMedian;
  if (depositDiff !== null && Math.abs(depositDiff) >= 25) {
    signals.push({
      code: 'DEPOSIT_OUTSIDE_COMPARABLE_RANGE',
      label: '보증금 차이 확인 필요',
      detail: `입력 보증금이 유사 표본 중앙값 대비 ${depositDiff >= 0 ? '+' : ''}${depositDiff}%입니다.`,
      suggestedVerification: '관리비 포함 여부, 층/향/수리 상태, 권리관계, 보증보험 가능 여부를 분리해서 확인하세요.'
    });
  }

  const rentDiff = comparison.monthlyRentKrw.differencePercentFromMedian;
  if (comparison.monthlyRentKrw.input > 0 && rentDiff !== null && Math.abs(rentDiff) >= 25) {
    signals.push({
      code: 'MONTHLY_RENT_OUTSIDE_COMPARABLE_RANGE',
      label: '월세 차이 확인 필요',
      detail: `입력 월세가 유사 표본 중앙값 대비 ${rentDiff >= 0 ? '+' : ''}${rentDiff}%입니다.`,
      suggestedVerification: '관리비, 옵션, 단기계약 여부, 전월세 전환 조건이 비교 표본과 다른지 확인하세요.'
    });
  }

  if (comparison.comparables.some((deal) => deal.housingType === 'detachedMultiFamily' || deal.housingType === 'villa')) {
    signals.push({
      code: 'NON_APARTMENT_PUBLIC_DATA_LIMIT',
      label: '비아파트 공개 데이터 한계 확인',
      detail: '빌라/단독다가구 유형은 세대별 조건과 공개 데이터 해상도 차이가 클 수 있습니다.',
      suggestedVerification: '건축물대장 세대 구분, 위반건축물 여부, 개별 호실 조건을 별도로 확인하세요.'
    });
  }

  return signals;
}

export async function detectPrecontractCheckSignals(
  input: { comparison?: ContractComparison } | ContractComparisonInput,
  rentClient: MolitRentClient
): Promise<PrecontractCheckResult> {
  const comparison =
    'comparison' in input && input.comparison ? input.comparison : await compareContractTerms(input as ContractComparisonInput, rentClient);
  const checkSignals = buildSignals(comparison);

  return {
    checkSignals,
    itemsToVerify: [
      '등기부등본의 소유자, 근저당권, 압류/가압류 등 권리관계',
      '건축물대장의 용도, 위반건축물 표시, 전유/공용 면적',
      '중개대상물 확인설명서와 계약서 특약의 불일치 여부',
      '전입신고/확정일자 가능 시점과 보증보험 가입 가능 여부',
      '관리비 항목과 포함/별도 비용'
    ],
    comparison,
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
}
