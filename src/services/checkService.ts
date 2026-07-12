import {
  CONTRACT_CHECK_DISCLAIMER,
  type CheckSignal,
  type ContractComparison,
  type ContractComparisonInput,
  type ContractComparisonStatus,
  type PricePositionAssessment,
  type PrecontractCheckResult
} from '../domain/types.js';
import type { MolitRentClient } from './molitClient.js';
import { compareContractTerms } from './comparisonService.js';

function effectiveComparisonStatus(comparison: ContractComparison): ContractComparisonStatus {
  if (comparison.status) return comparison.status;
  if (!comparison.addressResolution.lawdCode) return 'ADDRESS_UNRESOLVED';
  if (comparison.comparableSource === 'unavailable') return 'LIVE_DATA_UNAVAILABLE';
  return comparison.sampleCount > 0 ? 'COMPARED' : 'NO_MATCHES';
}

function formatKrw(value: number): string {
  const eok = Math.floor(value / 100_000_000);
  const manwon = Math.round((value % 100_000_000) / 10_000);
  if (eok > 0 && manwon > 0) return `${eok}억 ${manwon.toLocaleString('ko-KR')}만원`;
  if (eok > 0) return `${eok}억원`;
  return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만원`;
}

function formatKrwRange(min: number, max: number): string {
  return min === max ? formatKrw(min) : `${formatKrw(min)}~${formatKrw(max)}`;
}

function pricePositionAssessment(comparison: ContractComparison): PricePositionAssessment {
  const isWolse = comparison.monthlyRentKrw.input > 0;
  const basis = isWolse ? 'WOLSE_MONTHLY_RENT_PAIRED_BY_DEPOSIT' : 'JEONSE_DEPOSIT';
  const inputKrw = isWolse ? comparison.monthlyRentKrw.input : comparison.depositKrw.input;
  const medianKrw = isWolse ? comparison.monthlyRentKrw.median : comparison.depositKrw.median;
  const minKrw = isWolse ? comparison.monthlyRentKrw.min : comparison.depositKrw.min;
  const maxKrw = isWolse ? comparison.monthlyRentKrw.max : comparison.depositKrw.max;
  const comparableSampleCount = isWolse
    ? comparison.monthlyRentKrw.comparableSampleCount
    : comparison.sampleCount;
  const subject = isWolse ? '월세' : '보증금';

  if (
    effectiveComparisonStatus(comparison) !== 'COMPARED' ||
    comparison.comparisonScope !== 'SAME_REPORTED_PROPERTY' ||
    medianKrw === null ||
    minKrw === null ||
    maxKrw === null ||
    comparableSampleCount === 0
  ) {
    return {
      basis: 'UNAVAILABLE',
      position: 'INSUFFICIENT_DATA',
      inputKrw,
      medianKrw,
      minKrw,
      maxKrw,
      comparableSampleCount,
      summary: `동일 신고 건물·단지명의 유사 조건 자료가 부족해 입력 ${subject}의 가격 위치를 계산하지 못했습니다.`
    };
  }

  const comparableRange = formatKrwRange(minKrw, maxKrw);
  if (inputKrw < minKrw) {
    return {
      basis,
      position: 'BELOW_COMPARABLE_RANGE',
      inputKrw,
      medianKrw,
      minKrw,
      maxKrw,
      comparableSampleCount,
      summary: `가격만 보면 입력 ${subject} ${formatKrw(inputKrw)}은 동일 신고 건물·단지명 유사 면적 최근 신고 범위 ${comparableRange}보다 ${formatKrwRange(minKrw - inputKrw, maxKrw - inputKrw)} 낮습니다.`
    };
  }
  if (inputKrw > maxKrw) {
    return {
      basis,
      position: 'ABOVE_COMPARABLE_RANGE',
      inputKrw,
      medianKrw,
      minKrw,
      maxKrw,
      comparableSampleCount,
      summary: `가격만 보면 입력 ${subject} ${formatKrw(inputKrw)}은 동일 신고 건물·단지명 유사 면적 최근 신고 범위 ${comparableRange}보다 ${formatKrwRange(inputKrw - maxKrw, inputKrw - minKrw)} 높습니다.`
    };
  }

  return {
    basis,
    position: 'WITHIN_COMPARABLE_RANGE',
    inputKrw,
    medianKrw,
    minKrw,
    maxKrw,
    comparableSampleCount,
    summary: `가격만 보면 입력 ${subject} ${formatKrw(inputKrw)}은 동일 신고 건물·단지명 유사 면적 최근 신고 범위 ${comparableRange} 안에 있으며 중앙값은 ${formatKrw(medianKrw)}입니다.`
  };
}

function buildSignals(comparison: ContractComparison): CheckSignal[] {
  const signals: CheckSignal[] = [];
  const status = effectiveComparisonStatus(comparison);

  if (status === 'ADDRESS_UNRESOLVED' || status === 'ADDRESS_AMBIGUOUS') {
    signals.push({
      code: 'ADDRESS_MATCH_UNCERTAIN',
      label: '주소 매칭 확인 필요',
      detail:
        status === 'ADDRESS_AMBIGUOUS'
          ? `입력 주소와 일치하는 후보가 ${comparison.addressResolution.candidates.length}개라 하나를 확정하지 않았습니다.`
          : '입력 주소를 법정동 코드로 해석할 정보가 부족합니다.',
      suggestedVerification: '도로명주소, 지번주소, 건축물대장 주소가 서로 일치하는지 확인하세요.'
    });
  }

  if (status === 'LIVE_DATA_UNAVAILABLE') {
    signals.push({
      code: 'LIVE_DATA_UNAVAILABLE',
      label: '공공데이터 API 조회 확인 필요',
      detail: comparison.dataNotice || '국토교통부 공공데이터를 조회하지 못했습니다.',
      suggestedVerification:
        comparison.nextActions?.[0] ?? '잠시 후 다시 조회하고, 계속 실패하면 공공데이터 API 설정을 확인하세요.'
    });
  }

  if ((status === 'COMPARED' || status === 'NO_MATCHES') && comparison.sampleCount < 3) {
    signals.push({
      code: 'LOW_SAMPLE_COUNT',
      label: '유사 거래 표본 수 부족',
      detail: `현재 조건에서 유사 표본은 ${comparison.sampleCount}건입니다.`,
      suggestedVerification:
        comparison.reasonCode === 'NO_AREA_MATCH'
          ? '아파트·오피스텔·연립다세대는 입력 면적이 전용면적인지 먼저 확인하고, 전용면적이 맞다면 허용 범위를 조정하세요.'
          : '면적 허용 범위, 단지명 조건, 조회 기간을 넓혀 공공데이터 신고자료를 다시 확인하세요.'
    });
  }

  if (status === 'COMPARED' && comparison.comparisonScope !== 'SAME_REPORTED_PROPERTY') {
    signals.push({
      code:
        comparison.comparisonScope === 'REQUESTED_PROPERTY_REFERENCE'
          ? 'PROPERTY_NAME_UNVERIFIED'
          : 'REGIONAL_REFERENCE_ONLY',
      label:
        comparison.comparisonScope === 'REQUESTED_PROPERTY_REFERENCE'
          ? '입력 건물·단지명 검증 필요'
          : '지역 참고자료로만 확인',
      detail: comparison.scopeReason,
      suggestedVerification: '정확한 도로명·지번주소와 공식 건물·단지명을 확인한 뒤 다시 비교하세요.'
    });
  }

  if (
    status === 'COMPARED' &&
    comparison.comparisonScope === 'SAME_REPORTED_PROPERTY' &&
    comparison.confidence !== 'HIGH'
  ) {
    signals.push({
      code: 'LOW_COMPARISON_CONFIDENCE',
      label: '비교 신뢰도 추가 확인 필요',
      detail: comparison.confidenceReasons.join(' '),
      suggestedVerification: '최근 동일 신고 건물·단지명 자료의 표본 수, 조회 완료 여부, 금액 분산을 함께 확인하세요.'
    });
  }

  const depositDiff = comparison.depositKrw.differencePercentFromMedian;
  const rentDiff = comparison.monthlyRentKrw.differencePercentFromMedian;
  const isWolse = comparison.monthlyRentKrw.input > 0;
  const hasVerifiedPropertyScope =
    status === 'COMPARED' && comparison.comparisonScope === 'SAME_REPORTED_PROPERTY';
  const canInterpretPriceDifference =
    hasVerifiedPropertyScope && comparison.searchComplete && comparison.confidence === 'HIGH';

  if (!isWolse && canInterpretPriceDifference && depositDiff !== null && Math.abs(depositDiff) >= 25) {
    signals.push({
      code: 'DEPOSIT_OUTSIDE_COMPARABLE_RANGE',
      label: '보증금 차이 확인 필요',
      detail: `입력 보증금이 유사 표본 중앙값 대비 ${depositDiff >= 0 ? '+' : ''}${depositDiff}%입니다.`,
      suggestedVerification: '관리비 포함 여부, 층/향/수리 상태, 권리관계, 보증보험 가능 여부를 분리해서 확인하세요.'
    });
  }

  if (isWolse && hasVerifiedPropertyScope && comparison.monthlyRentKrw.comparableSampleCount < 3) {
    signals.push({
      code: 'WOLSE_COMPARISON_LIMITED',
      label: '월세 조건 비교 표본 부족',
      detail: `입력 보증금과 차이가 ${comparison.monthlyRentKrw.maximumDepositDifferencePercent}% 이내인 월세 표본은 ${comparison.monthlyRentKrw.comparableSampleCount}건입니다. 보증금 수준이 다른 거래의 월세는 직접 비교하지 않았습니다.`,
      suggestedVerification: '비슷한 보증금·면적의 최근 월세 계약 사례와 관리비·옵션 차이를 추가로 확인하세요.'
    });
  } else if (isWolse && canInterpretPriceDifference && rentDiff !== null && Math.abs(rentDiff) >= 25) {
    signals.push({
      code: 'WOLSE_TERMS_DIFFER_FROM_MEDIAN',
      label: '월세 조건 조합 확인 필요',
      detail: `입력 월세가 비슷한 보증금의 유사 표본 중앙값 대비 ${rentDiff >= 0 ? '+' : ''}${rentDiff}%입니다.`,
      suggestedVerification:
        '관리비, 옵션, 층·향, 계약기간 차이를 확인하고 같은 보증금 수준의 최근 계약 사례를 요청하세요.'
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

  const saleAssessment = comparison.salePriceAssessment;
  if (comparison.comparisonScope === 'SAME_REPORTED_PROPERTY' && comparison.depositKrw.input > 0) {
    if (saleAssessment.status !== 'ASSESSED') {
      signals.push({
        code: 'SALE_PRICE_REFERENCE_UNAVAILABLE',
        label: '동일 신고 건물·단지명 매매가 별도 확인 필요',
        detail: saleAssessment.dataNotice,
        suggestedVerification: '동일 신고 건물·단지명과 비슷한 면적의 최근 매매 실거래가 및 현재 권리관계를 별도로 확인하세요.'
      });
    } else if (saleAssessment.sampleCount < 3 || !saleAssessment.searchComplete) {
      signals.push({
        code: 'SALE_PRICE_REFERENCE_LIMITED',
        label: '매매가 비교 표본 부족',
        detail: `동일 신고 건물·단지명 매매 표본은 ${saleAssessment.sampleCount}건이며 전체 검색 완료 여부는 ${saleAssessment.searchComplete ? '완료' : '미완료'}입니다.`,
        suggestedVerification: '조회 기간을 넓히고 동일 신고 건물·단지명과 비슷한 면적의 최근 매매 신고자료를 추가로 확인하세요.'
      });
    }

    const canInterpretSaleRatio =
      saleAssessment.status === 'ASSESSED' &&
      saleAssessment.sampleCount >= 3 &&
      saleAssessment.searchComplete;
    if (
      canInterpretSaleRatio &&
      saleAssessment.depositToMedianSalePricePercent !== null &&
      saleAssessment.depositToMedianSalePricePercent >= 80
    ) {
      signals.push({
        code: 'DEPOSIT_TO_SALE_PRICE_CHECK',
        label: '보증금과 매매가 수준 추가 확인',
        detail: `입력 보증금은 동일 신고 건물·단지명 유사 면적 매매가 중앙값의 ${saleAssessment.depositToMedianSalePricePercent}%입니다. ${saleAssessment.comparisonThresholdNotice}`,
        suggestedVerification: '선순위 권리와 다른 임차인의 보증금, 보증보험 가입 가능 여부를 최신 서류와 취급기관 기준으로 확인하세요.'
      });
    }
  }

  return signals;
}

function screeningSummary(
  comparison: ContractComparison,
  pricePosition: PricePositionAssessment
): string {
  if (pricePosition.position !== 'INSUFFICIENT_DATA') {
    const fragments = [pricePosition.summary];
    const sale = comparison.salePriceAssessment;
    if (
      sale.status === 'ASSESSED' &&
      sale.medianSalePriceKrw !== null &&
      sale.depositToMedianSalePricePercent !== null
    ) {
      fragments.push(
        `동일 신고 건물·단지명 유사 면적 매매가 중앙값은 ${formatKrw(sale.medianSalePriceKrw)}이며 입력 보증금은 그 ${sale.depositToMedianSalePricePercent}%입니다(매매 표본 ${sale.sampleCount}건). 이 비율은 집계약괜찮아 내부 추가 확인 기준 80%보다 ${sale.depositToMedianSalePricePercent >= 80 ? '높거나 같습니다' : '낮습니다'}.`
      );
    }
    if (pricePosition.position === 'BELOW_COMPARABLE_RANGE') {
      fragments.push('최근 신고 범위보다 낮은 이유가 층·상태 차이인지, 권리관계나 특약 같은 별도 조건 때문인지 확인하세요.');
    } else if (pricePosition.position === 'ABOVE_COMPARABLE_RANGE') {
      fragments.push('최근 신고 범위보다 높은 조건이므로 층·상태·옵션 차이와 보증금 조정 가능성을 확인하세요.');
    }
    if (
      comparison.confidence !== 'HIGH' ||
      pricePosition.comparableSampleCount < 5 ||
      sale.status !== 'ASSESSED' ||
      sale.sampleCount < 3
    ) {
      fragments.push(
        `다만 전월세 표본 ${pricePosition.comparableSampleCount}건, 매매 표본 ${sale.sampleCount}건으로 제한적이어서 가격 위치의 신뢰도는 ${comparison.confidence}입니다.`
      );
    }
    fragments.push(
      '이는 공공데이터 가격 조건 비교일 뿐 계약 안전이나 권리관계를 확인한 결과가 아니므로 등기부등본과 보증보험 가능 여부는 별도로 확인해야 합니다.'
    );
    return fragments.join(' ');
  }

  const status = effectiveComparisonStatus(comparison);
  const isWolse = comparison.monthlyRentKrw.input > 0;
  if (
    status === 'COMPARED' &&
    comparison.comparisonScope === 'SAME_REPORTED_PROPERTY' &&
    isWolse &&
    comparison.sampleCount > 0 &&
    comparison.monthlyRentKrw.comparableSampleCount === 0
  ) {
    const maximumDepositDifferencePercent = comparison.monthlyRentKrw.maximumDepositDifferencePercent ?? 25;
    const completionNotice = comparison.searchComplete
      ? ''
      : ' 요청 기간 전체 조회가 완료되지 않았고,';
    return `동일 신고 건물·단지명의 유사 면적 월세 신고자료 ${comparison.sampleCount}건은 확인했지만,${completionNotice} 입력 보증금 ${formatKrw(comparison.depositKrw.input)}과 차이가 ${maximumDepositDifferencePercent}% 이내인 표본은 0건입니다. 따라서 입력 월세 ${formatKrw(comparison.monthlyRentKrw.input)}이 높은지 낮은지 직접 비교할 수 없습니다. 보증금 수준이 다른 월세를 단순 비교하지 않았으며, 비슷한 보증금 조건의 최근 사례와 관리비·옵션 차이를 추가로 확인해야 합니다.`;
  }

  if (status === 'NO_MATCHES' && comparison.reasonCode === 'NO_AREA_MATCH') {
    return comparison.comparisonSummary;
  }

  switch (comparison.screeningOutcome) {
    case 'NO_ADDITIONAL_PRICE_SIGNAL_FOUND':
      return '도로명주소에서 확인한 건물·단지명의 공공데이터 가격 조건 비교에서는 추가 확인이 필요한 특이 신호가 확인되지 않았습니다. 이는 계약 안전이나 권리관계를 확인한 결과가 아니므로 등기부등본과 보증보험 가능 여부는 별도로 확인해야 합니다.';
    case 'ADDITIONAL_VERIFICATION_REQUIRED':
      return '유사 신고자료의 조건 차이 또는 비교 품질 때문에 계약 전에 추가 확인이 필요합니다. 아래 확인 신호와 질문을 검토하세요.';
    case 'INSUFFICIENT_INFORMATION':
      return comparison.comparisonScope === 'REQUESTED_PROPERTY_REFERENCE' ||
        comparison.comparisonScope === 'SAME_LEGAL_DONG' ||
        comparison.comparisonScope === 'DISTRICT_REFERENCE'
        ? '정확한 건물을 기준으로 계약 조건을 1차 점검하기에는 정보가 부족합니다. 현재 결과는 지역 참고자료이며 공식 건물명이나 상세 주소로 다시 확인하세요.'
        : '계약 조건을 1차 점검하기에는 비교 정보가 부족합니다. 주소, 검증된 신고 건물·단지명 표본 또는 공공데이터 조회 상태를 보완한 뒤 다시 확인하세요.';
  }
}

export async function detectPrecontractCheckSignals(
  input: { comparison?: ContractComparison } | ContractComparisonInput,
  rentClient: MolitRentClient
): Promise<PrecontractCheckResult> {
  const comparison =
    'comparison' in input && input.comparison ? input.comparison : await compareContractTerms(input as ContractComparisonInput, rentClient);
  const checkSignals = buildSignals(comparison);
  const pricePosition = pricePositionAssessment(comparison);

  return {
    screeningOutcome: comparison.screeningOutcome,
    screeningSummary: screeningSummary(comparison, pricePosition),
    pricePosition,
    checkSignals,
    itemsToVerify: [
      '등기부등본의 소유자, 근저당권, 압류/가압류 등 권리관계',
      '건축물대장의 용도, 위반건축물 표시, 전유/공용 면적',
      '중개대상물 확인설명서와 계약서 특약의 불일치 여부',
      '전입신고/확정일자 가능 시점과 보증보험 가입 가능 여부',
      '관리비 항목과 포함/별도 비용'
    ],
    notAutomaticallyVerifiedItems: [
      '등기부등본의 현재 소유자와 근저당권·압류·가압류는 자동으로 확인하지 않습니다.',
      '건축물대장의 위반건축물 표시와 실제 세대 구분은 자동으로 확인하지 않습니다.',
      '전입신고·확정일자 가능 여부와 보증보험 가입 가능 여부는 자동으로 확인하지 않습니다.',
      '임대인의 신원·계약 권한과 계약서 특약의 효력은 자동으로 확인하지 않습니다.'
    ],
    comparison,
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
}
