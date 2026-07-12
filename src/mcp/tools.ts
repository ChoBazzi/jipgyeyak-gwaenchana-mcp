import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { loadConfig } from '../config.js';
import {
  CONTRACT_CHECK_DISCLAIMER,
  type ComparableSearchInput
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
const EXPLICIT_UNIT_PATTERN = /(?:^|\s)\d{1,4}\s*동\s*\d{1,4}\s*호(?=\s|$)/u;
const TRAILING_UNIT_PAIR_PATTERN = /\d{1,4}\s*[-/]\s*\d{3,4}(?:\s*호)?\s*$/u;
const UNIT_PAIR_CONTEXT_PATTERN = /(?:[가-힣A-Za-z0-9]+(?:로|길)\s*\d|아파트|오피스텔|빌라|타워|주상복합|연립|다세대)/u;
const PropertyAddressSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !value.includes('@') && !CONTACT_PATTERN.test(value), {
    message: '주소에는 이메일이나 전화번호를 포함하지 마세요.'
  })
  .refine((value) => !/(?:^|\s)\d{1,4}\s*(?:동|호)(?![\p{L}\p{N}])/u.test(value), {
    message: '개인정보 보호를 위해 세부 동/호수는 제외하고 건물 주소까지만 입력하세요.'
  })
  .refine(
    (value) =>
      !EXPLICIT_UNIT_PATTERN.test(value) &&
      !(TRAILING_UNIT_PAIR_PATTERN.test(value) && UNIT_PAIR_CONTEXT_PATTERN.test(value)),
    {
      message: '개인정보 보호를 위해 세부 동/호수는 제외하고 건물 주소까지만 입력하세요.'
    }
  );
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
  legalDongName: z.string().trim().min(1).max(40).optional().describe('주소에서 확인한 법정동 이름. 예: 역삼동'),
  areaM2: z
    .number()
    .positive()
    .max(10_000)
    .optional()
    .describe('아파트·오피스텔·연립다세대는 전용면적, 단독다가구는 공공데이터 계약면적/연면적 기준 m2'),
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
    .int()
    .nonnegative()
    .max(MAX_KRW)
    .describe('사용자가 제공한 보증금 원 단위 정수. 누락된 값을 추측하지 않으며 월세도 0원이면 허용하지 않음'),
  monthlyRentKrw: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_KRW)
    .describe('사용자가 제공한 월세 원 단위 정수. 전세는 0이며 보증금도 0원이면 허용하지 않음'),
  areaM2: z
    .number()
    .positive()
    .max(10_000)
    .describe(
      '사용자가 제공한 면적 m2. 아파트·오피스텔·연립다세대는 전용면적만 사용하고, 단독다가구는 공공데이터 계약면적/연면적 기준을 사용하며 누락값이나 다른 면적 종류를 추측하지 않음'
    ),
  monthsBack: z.number().int().positive().max(12).optional().describe('최근 몇 개월을 볼지, 최대 12개월'),
  complexName: ComplexNameSchema
    .optional()
    .describe('사용자가 특정한 실제 단지명 또는 건물명. 지역명과 주택 유형만 있는 표현에는 입력하지 않음')
}).refine((input) => input.depositKrw > 0 || input.monthlyRentKrw > 0, {
  message: '보증금과 월세가 동시에 0원일 수 없습니다.',
  path: ['depositKrw']
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
      '집계약괜찮아 주소/지역명을 도로명주소 API 또는 내장 키워드 매핑으로 법정동 후보와 lawdCode 앞 5자리로 해석합니다. 서로 다른 지역 후보가 남거나 단독 동명만으로 확정할 수 없으면 첫 후보를 선택하지 않고 lookupStatus AMBIGUOUS, clarificationQuestion, clarificationOptions를 반환합니다. 이때 clarificationQuestion을 사용자에게 다시 질문하고 보완된 주소로 재호출합니다. lookupReasonCode와 retryable로 주소 무자료와 API 불가도 구분합니다.',
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
      '집계약괜찮아 유사 전월세 신고 사례를 국토교통부 Open API에서 조회합니다. legalDongName으로 시군구 응답을 법정동까지 좁힐 수 있습니다. complexName은 특정 단지/건물명에만 사용하며, 지역명과 주택 유형만 있는 표현은 complexName에서 제외합니다. status, reasonCode, 단계별 filterStats와 nextActions로 무자료와 API 실패를 구분합니다.',
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
      '집계약괜찮아 입력 계약 조건을 도로명주소에서 확인한 건물·단지명 및 법정동이 일치하는 최근 전월세·매매 신고자료와 비교합니다. 국토교통부 신고자료에는 건물관리번호가 없어 개별 동·호 동일성을 입증하지 않습니다. 주소, 주택 유형, 보증금, 월세, 면적이 모두 있을 때만 호출하고 누락값을 추측하지 않습니다. 아파트·오피스텔·연립다세대는 전용면적만 사용합니다. 입력 건물·단지명을 검증하지 못한 자료는 참고자료로 표시해 계약 단위 판정에 사용하지 않습니다. comparisonScope, confidence, screeningOutcome, salePriceAssessment를 반환합니다. 주소 후보가 여러 개면 ADDRESS_AMBIGUOUS와 clarificationQuestion을 반환하므로 사용자에게 다시 질문한 뒤 재호출합니다. 전세사기 여부나 계약 안전성을 판정하지 않습니다.',
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
      '집계약괜찮아의 대표 계약 전 스크리닝 도구입니다. 도로명주소에서 검증한 건물·단지명과 법정동 기준의 전월세·매매 공공데이터 가격 조건 비교를 수행하고 NO_ADDITIONAL_PRICE_SIGNAL_FOUND, ADDITIONAL_VERIFICATION_REQUIRED, INSUFFICIENT_INFORMATION 중 하나와 checkSignals, itemsToVerify를 반환하므로 compare_contract_terms를 먼저 호출할 필요가 없습니다. NO_ADDITIONAL_PRICE_SIGNAL_FOUND도 권리관계나 계약 안전 확인을 뜻하지 않습니다. 등기부등본·건축물대장·보증보험은 자동 확인하지 않으며 전세사기 여부나 계약 안전성을 판정하지 않습니다.',
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
      '집계약괜찮아 임대인/중개사에게 물어볼 질문과 확인 서류 목록을 checkSignals에 맞춰 생성합니다. 자동으로 확인하지 않은 등기부·건축물대장·보증보험 항목을 별도로 표시합니다. 계약 안전성을 판정하거나 보장하는 도구가 아니며 disclaimer를 항상 포함합니다.',
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
    async (input) => {
      const parsedInput = CompareContractTermsSchema.parse(input);
      return jsonResult(await compareContractTerms(parsedInput, rentClient));
    }
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
