import { describe, expect, it } from 'vitest';
import {
  CompareContractTermsSchema,
  DetectPrecontractCheckSignalsSchema,
  GenerateQuestionChecklistSchema,
  SearchRentComparablesSchema,
  TOOL_DEFINITIONS,
  jsonResult
} from '../src/mcp/tools.js';
import { CONTRACT_CHECK_DISCLAIMER } from '../src/domain/types.js';

describe('MCP tool definitions', () => {
  it('includes the service name and annotations on every PlayMCP tool', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(5);

    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description).toContain('집계약괜찮아');
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      });
      expect(tool.annotations.title).toContain('집계약괜찮아');
    }
  });

  it('guides the agent not to invent missing contract values or generic complex names', () => {
    const searchTool = TOOL_DEFINITIONS.find((tool) => tool.name === 'search_rent_comparables');
    const compareTool = TOOL_DEFINITIONS.find((tool) => tool.name === 'compare_contract_terms');
    const signalTool = TOOL_DEFINITIONS.find((tool) => tool.name === 'detect_precontract_check_signals');
    const checklistTool = TOOL_DEFINITIONS.find((tool) => tool.name === 'generate_question_checklist');

    expect(searchTool?.description).toContain('지역명과 주택 유형만');
    expect(searchTool?.description).toContain('reasonCode');
    expect(searchTool?.description).toContain('filterStats');
    expect(compareTool?.description).toContain('추측하지');
    expect(compareTool?.description).toContain('ADDRESS_AMBIGUOUS');
    expect(compareTool?.description).toContain('clarificationQuestion');
    expect(compareTool?.description).toContain('사용자에게 다시 질문');
    expect(compareTool?.description).toContain('전세사기 여부');
    expect(compareTool?.description).toContain('판정하지 않습니다');
    expect(signalTool?.description).toContain('전세사기 여부');
    expect(signalTool?.description).toContain('먼저 호출할 필요가 없습니다');
    expect(checklistTool?.description).toContain('계약 안전성을 판정');
    expect(CONTRACT_CHECK_DISCLAIMER).toContain('전세사기 여부나 계약 안전성을 판정 또는 보장하지 않습니다');
  });

  it('publishes bounded inputs and requires complete contract data for check signals', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toContain('detect_precontract_check_signals');
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).not.toContain('detect_precontract_red_flags');

    expect(
      SearchRentComparablesSchema.safeParse({
        lawdCode: '11680',
        dealYmdFrom: '202507',
        dealYmdTo: '202607',
        housingType: 'apartment',
        limit: 21
      }).success
    ).toBe(false);
    expect(DetectPrecontractCheckSignalsSchema.safeParse({}).success).toBe(false);
    expect(DetectPrecontractCheckSignalsSchema.safeParse({ comparison: {} }).success).toBe(false);
    expect(
      CompareContractTermsSchema.safeParse({
        address: '서울특별시 강남구 삼성로 212 101동 1001호',
        housingType: 'apartment',
        depositKrw: 500_000_000,
        monthlyRentKrw: 0,
        areaM2: 76
      }).success
    ).toBe(false);
    for (const address of [
      '서울특별시 강남구 삼성로 212 101동1203호',
      '서울특별시 강남구 삼성로 212 은마아파트 101-1203',
      '서울특별시 강남구 삼성로 212 101/1203'
    ]) {
      expect(
        CompareContractTermsSchema.safeParse({
          address,
          housingType: 'apartment',
          depositKrw: 500_000_000,
          monthlyRentKrw: 0,
          areaM2: 76
        }).success
      ).toBe(false);
    }
    for (const address of [
      '서울특별시 강남구 삼성로 212 02-1234-5678',
      '서울특별시 강남구 삼성로 212 +82 10-1234-5678'
    ]) {
      expect(
        CompareContractTermsSchema.safeParse({
          address,
          housingType: 'apartment',
          depositKrw: 500_000_000,
          monthlyRentKrw: 0,
          areaM2: 76
        }).success
      ).toBe(false);
    }
    expect(
      CompareContractTermsSchema.safeParse({
        address: '서울특별시 강남구 삼성로 212-2',
        housingType: 'apartment',
        depositKrw: 500_000_000,
        monthlyRentKrw: 0,
        areaM2: 76
      }).success
    ).toBe(true);
    expect(
      CompareContractTermsSchema.safeParse({
        address: '서울특별시 강남구 역삼동 101-1001',
        housingType: 'apartment',
        depositKrw: 500_000_000,
        monthlyRentKrw: 0,
        areaM2: 76
      }).success
    ).toBe(true);
    expect(
      CompareContractTermsSchema.safeParse({
        address: '서울특별시 노원구 상계1동 100-1',
        housingType: 'apartment',
        depositKrw: 500_000_000,
        monthlyRentKrw: 0,
        areaM2: 76
      }).success
    ).toBe(true);
    expect(
      CompareContractTermsSchema.safeParse({
        address: '서울특별시 강남구 역삼동 101-1',
        housingType: 'apartment',
        depositKrw: 100_000_000.5,
        monthlyRentKrw: 0,
        areaM2: 76
      }).success
    ).toBe(false);
    expect(
      CompareContractTermsSchema.safeParse({
        address: '서울특별시 강남구 역삼동 101-1',
        housingType: 'apartment',
        depositKrw: 0,
        monthlyRentKrw: 0,
        areaM2: 76
      }).success
    ).toBe(false);
    expect(
      CompareContractTermsSchema.safeParse({
        address: '서울특별시 강남구 역삼동 101-1',
        housingType: 'apartment',
        depositKrw: 0,
        monthlyRentKrw: 1_000_000,
        areaM2: 76
      }).success
    ).toBe(true);
    expect(
      GenerateQuestionChecklistSchema.safeParse({
        housingType: 'apartment',
        contractType: 'jeonse',
        userConcerns: Array.from({ length: 11 }, () => '확인할 내용')
      }).success
    ).toBe(false);
  });

  it('returns a bounded tool error instead of an oversized payload', () => {
    const result = jsonResult({ oversized: 'x'.repeat(30_000) });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('RESULT_TOO_LARGE');
    expect(Buffer.byteLength(result.content[0]?.text ?? '', 'utf8')).toBeLessThan(1000);
  });
});
