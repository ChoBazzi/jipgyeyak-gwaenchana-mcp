import { CONTRACT_CHECK_DISCLAIMER, type CheckSignal, type ChecklistResult, type HousingType } from '../domain/types.js';

export function generateQuestionChecklist(input: {
  housingType: HousingType;
  contractType: 'jeonse' | 'wolse';
  checkSignals?: CheckSignal[];
  userConcerns?: string[];
}): ChecklistResult {
  const questions = [
    '계약서상 임대인과 등기부등본 소유자가 같은지 확인할 수 있을까요?',
    '잔금일 전까지 권리관계 변동이 생기면 어떻게 고지받을 수 있을까요?',
    '전입신고와 확정일자는 언제부터 가능한가요?',
    '관리비에 포함되는 항목과 별도 청구 항목은 무엇인가요?'
  ];

  if (input.contractType === 'jeonse') {
    questions.push('보증보험 가입 가능 여부와 필요한 임대인 협조 사항을 확인할 수 있을까요?');
  } else {
    questions.push('월세 외 고정 비용과 옵션 사용료가 별도로 있는지 확인할 수 있을까요?');
  }

  if (input.housingType === 'villa' || input.housingType === 'detachedMultiFamily') {
    questions.push('건축물대장상 위반건축물 표시나 세대 구분 이슈가 있는지 확인할 수 있을까요?');
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
