import { CONTRACT_CHECK_DISCLAIMER, type CheckSignal, type ChecklistResult, type HousingType } from '../domain/types.js';

function questionsForSignal(signal: CheckSignal): string[] {
  switch (signal.code) {
    case 'LOW_SAMPLE_COUNT':
      return ['최근 동일 신고 건물·단지명과 비슷한 면적의 실제 계약 사례를 몇 건 확인할 수 있고, 각 계약 조건은 어떻게 다른가요?'];
    case 'PROPERTY_NAME_UNVERIFIED':
    case 'REGIONAL_REFERENCE_ONLY':
      return ['이 매물의 공식 건물명과 정확한 지번주소를 서류 기준으로 확인해 주실 수 있을까요?'];
    case 'LOW_COMPARISON_CONFIDENCE':
      return ['최근 동일 신고 건물·단지명 계약이 적거나 금액 차이가 큰 이유를 층·향·수리 상태·옵션별로 설명해 주실 수 있을까요?'];
    case 'DEPOSIT_OUTSIDE_COMPARABLE_RANGE':
      return ['최근 동일 신고 건물·단지명의 비슷한 면적 계약보다 보증금이 차이 나는 이유와 이를 확인할 서류가 있나요?'];
    case 'WOLSE_COMPARISON_LIMITED':
      return ['비슷한 보증금과 면적의 최근 월세 계약 사례, 관리비, 옵션 비용을 각각 확인할 수 있을까요?'];
    case 'WOLSE_TERMS_DIFFER_FROM_MEDIAN':
      return ['비슷한 보증금의 최근 계약보다 월세가 차이 나는 이유를 관리비·옵션·계약기간별로 설명해 주실 수 있을까요?'];
    case 'LIVE_DATA_UNAVAILABLE':
      return ['공공데이터를 다시 확인할 때까지 최근 실거래 신고자료나 계약 사례를 서류로 확인할 수 있을까요?'];
    case 'SALE_PRICE_REFERENCE_UNAVAILABLE':
    case 'SALE_PRICE_REFERENCE_LIMITED':
      return ['동일 신고 건물·단지명과 비슷한 면적의 최근 매매 실거래가를 몇 건 확인할 수 있고, 현재 보증금과 비교하면 어느 수준인가요?'];
    case 'DEPOSIT_TO_SALE_PRICE_CHECK':
      return ['선순위 대출과 다른 임차인의 보증금을 포함한 총 권리관계를 최신 등기부등본과 확인설명서로 설명해 주실 수 있을까요?'];
    default:
      return [`${signal.label}: ${signal.suggestedVerification}`];
  }
}

export function generateQuestionChecklist(input: {
  housingType: HousingType;
  contractType: 'jeonse' | 'wolse';
  checkSignals?: CheckSignal[];
  userConcerns?: string[];
}): ChecklistResult {
  const questions = [
    '계약서상 임대인과 등기부등본 소유자가 같은지 확인할 수 있을까요?',
    '등기부등본에 잡힌 대출이나 압류가 있다면 보증금보다 먼저 갚아야 하는 돈인지 쉽게 설명해 주실 수 있을까요?',
    '잔금일 전까지 권리관계 변동이 생기면 어떻게 고지받을 수 있을까요?',
    '전입신고와 확정일자는 언제부터 가능한가요?',
    '관리비에 포함되는 항목과 따로 내야 하는 돈을 월 금액으로 나눠 알려주실 수 있을까요?'
  ];

  if (input.contractType === 'jeonse') {
    questions.push('보증보험 가입이 가능한 집인지, 안 된다면 안 되는 이유를 서류 기준으로 확인할 수 있을까요?');
  } else {
    questions.push('월세 외에 매달 고정으로 나가는 비용과 옵션 사용료가 각각 얼마인지 확인할 수 있을까요?');
  }

  if (input.housingType === 'villa' || input.housingType === 'detachedMultiFamily') {
    questions.push('건축물대장에 위반건축물 표시가 있는지, 이 집이 실제로 독립된 세대로 확인되는지 설명해 주실 수 있을까요?');
  }

  for (const signal of input.checkSignals ?? []) {
    questions.push(...questionsForSignal(signal));
  }

  for (const concern of input.userConcerns ?? []) {
    questions.push(`사용자 우려사항 "${concern}"에 대해 계약서나 서류에서 확인 가능한 근거가 있을까요?`);
  }

  return {
    questionsForLessorOrAgent: [...new Set(questions)],
    documentsToReview: [
      '등기부등본',
      '건축물대장',
      '중개대상물 확인설명서',
      '임대차계약서 초안 및 특약',
      '관리비 고지서 또는 관리규약',
      '신분증/위임장 등 계약 권한 확인 서류'
    ],
    notAutomaticallyVerifiedItems: [
      '등기부등본의 현재 권리관계는 집계약괜찮아가 자동으로 확인하지 않습니다.',
      '건축물대장의 위반건축물 여부와 세대 구분은 집계약괜찮아가 자동으로 확인하지 않습니다.',
      '보증보험 가입 가능 여부와 전입신고·확정일자 가능 시점은 집계약괜찮아가 자동으로 확인하지 않습니다.'
    ],
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
}
