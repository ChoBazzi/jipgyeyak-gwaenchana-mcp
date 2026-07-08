import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { loadConfig } from '../config.js';
import { SERVICE_NAME, type ComparableSearchInput, type ContractComparisonInput } from '../domain/types.js';
import { resolveAddressRegion } from '../services/addressResolver.js';
import { detectPrecontractCheckSignals } from '../services/checkService.js';
import { generateQuestionChecklist } from '../services/checklistService.js';
import { compareContractTerms } from '../services/comparisonService.js';
import { FallbackMolitRentClient, type MolitRentClient } from '../services/molitClient.js';

const HousingTypeSchema = z.enum(['apartment', 'officetel', 'villa', 'detachedMultiFamily']);
const ContractTypeSchema = z.enum(['jeonse', 'wolse']);

const ResolveAddressRegionSchema = z.object({
  address: z.string().min(1).describe('확인할 주소 또는 지역명'),
  housingType: HousingTypeSchema.optional().describe('주택 유형')
});

const SearchRentComparablesSchema = z.object({
  lawdCode: z.string().regex(/^\d{5}$/).describe('법정동 코드 앞 5자리'),
  dealYmdFrom: z.string().regex(/^\d{6}$/).describe('조회 시작 월 YYYYMM'),
  dealYmdTo: z.string().regex(/^\d{6}$/).describe('조회 종료 월 YYYYMM'),
  housingType: HousingTypeSchema.describe('주택 유형'),
  areaM2: z.number().positive().optional().describe('전용/계약 면적 m2'),
  areaToleranceM2: z.number().positive().optional().describe('면적 허용 오차 m2'),
  complexName: z.string().optional().describe('단지명 또는 건물명'),
  limit: z.number().int().positive().max(50).optional().describe('반환할 최대 사례 수')
});

const CompareContractTermsSchema = z.object({
  address: z.string().min(1).describe('확인할 주소 또는 지역명'),
  housingType: HousingTypeSchema.describe('주택 유형'),
  depositKrw: z.number().nonnegative().describe('보증금 원화 금액'),
  monthlyRentKrw: z.number().nonnegative().describe('월세 원화 금액'),
  areaM2: z.number().positive().describe('전용/계약 면적 m2'),
  monthsBack: z.number().int().positive().max(36).optional().describe('최근 몇 개월을 볼지'),
  complexName: z.string().optional().describe('단지명 또는 건물명')
});

const CheckSignalSchema = z.object({
  code: z.string(),
  label: z.string(),
  detail: z.string(),
  suggestedVerification: z.string()
});

const DetectPrecontractRedFlagsSchema = CompareContractTermsSchema.extend({
  comparison: z.unknown().optional().describe('compare_contract_terms 결과를 그대로 전달할 수 있습니다.')
}).partial({ address: true, housingType: true, depositKrw: true, monthlyRentKrw: true, areaM2: true });

const GenerateQuestionChecklistSchema = z.object({
  housingType: HousingTypeSchema.describe('주택 유형'),
  contractType: ContractTypeSchema.describe('계약 유형'),
  checkSignals: z.array(CheckSignalSchema).optional().describe('detect_precontract_red_flags의 checkSignals'),
  userConcerns: z.array(z.string()).optional().describe('사용자가 특히 확인하고 싶은 우려사항')
});

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function assertContractInput(input: unknown): ContractComparisonInput {
  return CompareContractTermsSchema.parse(input);
}

export const TOOL_DEFINITIONS = [
  {
    name: 'resolve_address_region',
    description:
      '집계약괜찮아 주소/지역명을 법정동 후보와 lawdCode 앞 5자리로 해석합니다. 정보가 부족하면 후보를 만들지 않고 부족 사유와 disclaimer를 함께 반환합니다.',
    annotations: {
      title: '집계약괜찮아 주소 지역 해석',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'search_rent_comparables',
    description:
      '집계약괜찮아 유사 전월세 신고 사례를 국토교통부 Open API에서 조회합니다. API 키가 없거나 실패하면 seed data 없이 정보 부족 안내와 disclaimer를 반환합니다.',
    annotations: {
      title: '집계약괜찮아 유사 전월세 사례 조회',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'compare_contract_terms',
    description:
      '집계약괜찮아 입력 계약 조건을 최근 유사 표본의 보증금/월세 중앙값 및 범위와 비교합니다. 법률/금융 조언이 아닌 계약 전 확인 보조 disclaimer를 포함합니다.',
    annotations: {
      title: '집계약괜찮아 계약 조건 비교',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'detect_precontract_red_flags',
    description:
      '집계약괜찮아 계약 전 확인이 필요한 checkSignals와 itemsToVerify를 비단정적으로 정리합니다. 위험 단정이나 법률 조언 대신 확인 보조 disclaimer를 반환합니다.',
    annotations: {
      title: '집계약괜찮아 계약 전 확인 신호',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'generate_question_checklist',
    description:
      '집계약괜찮아 임대인/중개사에게 물어볼 질문과 확인 서류 목록을 생성합니다. 계약 전 확인 보조 정보이며 disclaimer를 항상 포함합니다.',
    annotations: {
      title: '집계약괜찮아 질문 체크리스트',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
] as const;

export function createRentClientFromEnv(): MolitRentClient {
  const config = loadConfig();
  return new FallbackMolitRentClient({
    apiKey: config.molitApiKey,
    baseUrl: config.molitBaseUrl
  });
}

export function registerTools(server: McpServer, rentClient: MolitRentClient = createRentClientFromEnv()): void {
  server.registerTool(
    'resolve_address_region',
    {
      description: TOOL_DEFINITIONS[0].description,
      inputSchema: ResolveAddressRegionSchema.shape,
      annotations: TOOL_DEFINITIONS[0].annotations
    },
    async (input) => jsonResult(resolveAddressRegion(input.address, input.housingType))
  );

  server.registerTool(
    'search_rent_comparables',
    {
      description: TOOL_DEFINITIONS[1].description,
      inputSchema: SearchRentComparablesSchema.shape,
      annotations: TOOL_DEFINITIONS[1].annotations
    },
    async (input) => jsonResult(await rentClient.searchRentComparables(input as ComparableSearchInput))
  );

  server.registerTool(
    'compare_contract_terms',
    {
      description: TOOL_DEFINITIONS[2].description,
      inputSchema: CompareContractTermsSchema.shape,
      annotations: TOOL_DEFINITIONS[2].annotations
    },
    async (input) => jsonResult(await compareContractTerms(input as ContractComparisonInput, rentClient))
  );

  server.registerTool(
    'detect_precontract_red_flags',
    {
      description: TOOL_DEFINITIONS[3].description,
      inputSchema: DetectPrecontractRedFlagsSchema.shape,
      annotations: TOOL_DEFINITIONS[3].annotations
    },
    async (input) => {
      if ('comparison' in input && input.comparison) {
        return jsonResult(await detectPrecontractCheckSignals({ comparison: input.comparison as never }, rentClient));
      }

      return jsonResult(await detectPrecontractCheckSignals(assertContractInput(input), rentClient));
    }
  );

  server.registerTool(
    'generate_question_checklist',
    {
      description: TOOL_DEFINITIONS[4].description,
      inputSchema: GenerateQuestionChecklistSchema.shape,
      annotations: TOOL_DEFINITIONS[4].annotations
    },
    async (input) => jsonResult(generateQuestionChecklist(input))
  );
}
