import { describe, expect, it } from 'vitest';
import { generateQuestionChecklist } from '../src/services/checklistService.js';

describe('generateQuestionChecklist', () => {
  it('generates questions and document checks with the common disclaimer', () => {
    const result = generateQuestionChecklist({
      housingType: 'villa',
      contractType: 'jeonse',
      checkSignals: [
        {
          code: 'LOW_SAMPLE_COUNT',
          label: '유사 거래 표본 수 부족',
          detail: '현재 조건에서 유사 표본은 1건입니다.',
          suggestedVerification: '조회 기간을 조정하거나 live 신고자료로 다시 확인하세요.'
        }
      ],
      userConcerns: ['보증보험']
    });

    expect(result.questionsForLessorOrAgent.join('\n')).toContain('보증보험');
    expect(result.questionsForLessorOrAgent.join('\n')).toContain('위반건축물');
    expect(result.documentsToReview).toContain('등기부등본');
    expect(result.disclaimer).toContain('계약 전 확인');
  });
});
