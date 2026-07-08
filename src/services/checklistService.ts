import { CONTRACT_CHECK_DISCLAIMER, type CheckSignal, type ChecklistResult, type HousingType } from '../domain/types.js';

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
    questions.push(`${signal.label}: ${signal.suggestedVerification}`);
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
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };
}
