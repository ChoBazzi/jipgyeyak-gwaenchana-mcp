import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { loadConfig } from '../config.js';
import {
  CONTRACT_CHECK_DISCLAIMER,
  type ComparableSearchInput,
  type ContractComparisonInput
} from '../domain/types.js';
import { resolveAddressRegion } from '../services/addressResolver.js';
import { detectPrecontractCheckSignals } from '../services/checkService.js';
import { generateQuestionChecklist } from '../services/checklistService.js';
import { compareContractTerms } from '../services/comparisonService.js';
import { FallbackMolitRentClient, type MolitRentClient } from '../services/molitClient.js';
import { assertValidDealYmdRange, DEAL_YMD_PATTERN } from '../utils/date.js';

const HousingTypeSchema = z.enum(['apartment', 'officetel', 'villa', 'detachedMultiFamily']);
const ContractTypeSchema = z.enum(['jeonse', 'wolse']);
const DealYmdSchema = z.string().regex(DEAL_YMD_PATTERN, '유효한 YYYYMM 형식이어야 합니다.');
const MAX_KRW = 10_000_000_000_000;
const MAX_TOOL_RESULT_BYTES = 24_000;
const CONTACT_PATTERN = /(?:\+?82[-.\s]?)?0?(?:1[016789]|2|[3-6][1-5]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const UNIT_PAIR_PATTERN = /(?:^|\s)\d{2,4}\s*[-/]\s*\d{4}(?:\s*호)?(?=\s|$)/;
const PropertyAddressSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !value.includes('@') && !CONTACT_PATTERN.test(value), {
    message: '주소에는 이메일이나 전화번호를 포함하지 마세요.'
  })
  .refine((value) => !/\d{1,4}\s*(?:동|호)(?![\p{L}\p{N}])/u.test(value), {
    message: '개인정보 보호를 위해 세부 동/호수는 제외하고 건물 주소까지만 입력하세요.'
  })
  .refine((value) => !UNIT_PAIR_PATTERN.test(value), {
    message: '개인정보 보호를 위해 동-호수 형태의 세대 정보는 제외하세요.'
  });
const ComplexNameSchema = z.string().trim().min(1).max(100);

const ResolveAddressRegionSchema = z.object({
  address: PropertyAddressSchema.describe(
    '확인할 건물 주소 또는 지역명. 세부 동/호수, 임대인·임차인 이름, 전화번호 등 개인정보는 입력하지 않음'
  ),
  housingType: HousingTypeSchema.optional().describe('주택 유형')
});

export const SearchRentComparablesSchema = z.object({
  lawdCode: z.string().regex(/^\d{5}$/).describe('법정동 코드 앞 5자리'),
  dealYmdFrom: DealYmdSchema.describe('조회 시작 월 YYYYMM'),
  dealYmdTo: DealYmdSchema.describe('조회 종료 월 YYYYMM'),
  housingType: HousingTypeSchema.describe('주택 유형'),
  contractType: ContractTypeSchema.optional().describe('계약 유형: jeonse 또는 wolse'),
  areaM2: z.number().positive().max(10_000).optional().describe('사용자가 제공한 전용/계약 면적 m2'),
  areaToleranceM2: z.number().positive().max(1_000).optional().describe('면적 허용 오차 m2'),
  complexName: ComplexNameSchema
    .optional()
    .describe('사용자가 특정한 실제 단지명 또는 건물명. 지역명과 주택 유형만 있는 표현에는 입력하지 않음'),
  limit: z.number().int().positive().max(20).optional().describe('반환할 최대 사례 수, 최대 20건')
});

export const CompareContractTermsSchema = z.object({
  address: PropertyAddressSchema.describe(
    '확인할 건물 주소 또는 지역명. 세부 동/호수, 이름, 연락처 등 개인정보는 입력하지 않음'
  ),
  housingType: HousingTypeSchema.describe('주택 유형'),
  depositKrw: z
    .number()
    .nonnegative()
    .max(MAX_KRW)
    .describe('사용자가 제공한 보증금 원화 금액. 누락된 값을 추측하지 않음'),
  monthlyRentKrw: z
    .number()
    .nonnegative()
    .max(MAX_KRW)
    .describe('사용자가 제공한 월세 원화 금액. 전세는 0, 누락된 값은 추측하지 않음'),
  areaM2: z
    .number()
    .positive()
    .max(10_000)
    .describe('사용자가 제공한 전용/계약 면적 m2. 누락된 값을 추측하지 않음'),
  monthsBack: z.number().int().positive().max(12).optional().describe('최근 몇 개월을 볼지, 최대 12개월'),
  complexName: ComplexNameSchema
    .optional()
    .describe('사용자가 특정한 실제 단지명 또는 건물명. 지역명과 주택 유형만 있는 표현에는 입력하지 않음')
});

const CheckSignalSchema = z.object({
  code: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(100),
  detail: z.string().trim().min(1).max(500),
  suggestedVerification: z.string().trim().min(1).max(500)
});

export const DetectPrecontractCheckSignalsSchema = CompareContractTermsSchema;

export const GenerateQuestionChecklistSchema = z.object({
  housingType: HousingTypeSchema.describe('주택 유형'),
  contractType: ContractTypeSchema.describe('계약 유형'),
  checkSignals: z
    .array(CheckSignalSchema)
    .max(20)
    .optional()
    .describe('detect_precontract_check_signals의 checkSignals'),
  userConcerns: z
    .array(z.string().trim().min(1).max(200))
    .max(10)
    .optional()
    .describe('사용자가 특히 확인하고 싶은 우려사항, 최대 10개')
});

export function jsonResult(value: unknown) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > MAX_TOOL_RESULT_BYTES) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ok: false,
            code: 'RESULT_TOO_LARGE',
            message: '조회 결과가 응답 제한을 초과했습니다. 조회 기간이나 조건을 좁혀 다시 요청해 주세요.',
            disclaimer: CONTRACT_CHECK_DISCLAIMER
          })
        }
      ],
      isError: true
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text
      }
    ],
    isError: false
  };
}

export const TOOL_DEFINITIONS = [
  {
    name: 'resolve_address_region',
    description:
      '집계약괜찮아 주소/지역명을 도로명주소 API 또는 내장 키워드 매핑으로 법정동 후보와 lawdCode 앞 5자리로 해석합니다. lookupStatus, lookupReasonCode, retryable로 주소 무자료와 API 불가를 구분하며, 정보가 부족하면 후보를 만들지 않고 부족 사유와 disclaimer를 함께 반환합니다.',
    annotations: {
      title: '집계약괜찮아 주소 지역 해석',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'search_rent_comparables',
    description:
      '집계약괜찮아 유사 전월세 신고 사례를 국토교통부 Open API에서 조회합니다. complexName은 특정 단지/건물명에만 사용하며, 지역명과 주택 유형만 있는 표현은 complexName에서 제외합니다. status, reasonCode, 단계별 filterStats와 nextActions로 무자료와 API 실패를 구분합니다.',
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
      '집계약괜찮아 입력 계약 조건을 최근 유사 표본의 보증금/월세 중앙값 및 범위와 비교합니다. 사용자가 주소, 주택 유형, 보증금, 월세, 면적을 모두 제공한 경우에만 호출하고 누락값을 추측하지 않습니다. 주소 후보가 여러 개면 임의 선택하지 않고 ADDRESS_AMBIGUOUS와 보완 질문을 반환합니다. 법률/금융 조언이 아닌 계약 전 확인 보조 disclaimer를 포함합니다.',
    annotations: {
      title: '집계약괜찮아 계약 조건 비교',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'detect_precontract_check_signals',
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
    baseUrl: config.molitBaseUrl,
    timeoutMs: config.molitApiTimeoutMs,
    totalTimeoutMs: config.molitTotalTimeoutMs
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
    async (input) => jsonResult(await resolveAddressRegion(input.address, input.housingType))
  );

  server.registerTool(
    'search_rent_comparables',
    {
      description: TOOL_DEFINITIONS[1].description,
      inputSchema: SearchRentComparablesSchema.shape,
      annotations: TOOL_DEFINITIONS[1].annotations
    },
    async (input) => {
      const parsedInput = SearchRentComparablesSchema.parse(input);
      assertValidDealYmdRange(parsedInput.dealYmdFrom, parsedInput.dealYmdTo);
      return jsonResult(await rentClient.searchRentComparables(parsedInput as ComparableSearchInput));
    }
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
    'detect_precontract_check_signals',
    {
      description: TOOL_DEFINITIONS[3].description,
      inputSchema: DetectPrecontractCheckSignalsSchema.shape,
      annotations: TOOL_DEFINITIONS[3].annotations
    },
    async (input) =>
      jsonResult(
        await detectPrecontractCheckSignals(DetectPrecontractCheckSignalsSchema.parse(input), rentClient)
      )
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
