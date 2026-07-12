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
    expect(result.questionsForLessorOrAgent.join('\n')).toContain('쉽게 설명');
    expect(result.questionsForLessorOrAgent.join('\n')).toContain('따로 내야 하는 돈');
    expect(result.questionsForLessorOrAgent.join('\n')).toContain('최근 동일 신고 건물·단지명');
    expect(result.documentsToReview).toContain('등기부등본');
    expect(result.notAutomaticallyVerifiedItems.join('\n')).toContain('등기부등본');
    expect(result.notAutomaticallyVerifiedItems.join('\n')).toContain('자동으로 확인하지 않습니다');
    expect(result.disclaimer).toContain('계약 전 확인');
  });

  it('turns comparison limitations into concrete follow-up questions', () => {
    const result = generateQuestionChecklist({
      housingType: 'officetel',
      contractType: 'wolse',
      checkSignals: [
        {
          code: 'REGIONAL_REFERENCE_ONLY',
          label: '지역 참고자료로만 확인',
          detail: '건물명을 확정하지 못했습니다.',
          suggestedVerification: '정확한 건물명을 확인하세요.'
        },
        {
          code: 'WOLSE_COMPARISON_LIMITED',
          label: '월세 조건 비교 표본 부족',
          detail: '비슷한 보증금 표본이 없습니다.',
          suggestedVerification: '비슷한 조건을 확인하세요.'
        }
      ]
    });

    expect(result.questionsForLessorOrAgent.join('\n')).toContain('공식 건물명');
    expect(result.questionsForLessorOrAgent.join('\n')).toContain('비슷한 보증금');
  });
});
