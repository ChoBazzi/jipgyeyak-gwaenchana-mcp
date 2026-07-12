import 'dotenv/config';

export const DEFAULT_MOLIT_OPEN_DATA_BASE_URL = 'https://apis.data.go.kr/1613000';
export const DEFAULT_MOLIT_OPEN_DATA_TIMEOUT_MS = 10000;
export const DEFAULT_MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS = 10000;
export const DEFAULT_JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
export const DEFAULT_JUSO_API_TIMEOUT_MS = 3000;
export const DEFAULT_CONTRACT_LOOKUP_TIMEOUT_MS = 15000;
export const DEFAULT_MCP_ALLOWED_ORIGINS = ['https://playmcp.kakao.com'];
export const DEFAULT_MCP_RATE_LIMIT_PER_MINUTE = 120;
export const DEFAULT_MCP_MAX_CONCURRENT_REQUESTS = 16;
const MAX_MOLIT_LOOKUP_TIMEOUT_MS = 10000;
const MAX_CONTRACT_LOOKUP_TIMEOUT_MS = 15000;
const MAX_MCP_RATE_LIMIT_PER_MINUTE = 1000;
const MAX_MCP_CONCURRENT_REQUESTS = 64;

export interface AppConfig {
  port: number;
  host: string;
  molitApiKey?: string;
  molitBaseUrl: string;
  molitApiTimeoutMs: number;
  molitTotalTimeoutMs: number;
  jusoApiKey?: string;
  jusoApiBaseUrl: string;
  jusoApiTimeoutMs: number;
  contractLookupTimeoutMs: number;
  allowedOrigins: string[];
  mcpRateLimitPerMinute: number;
  mcpMaxConcurrentRequests: number;
}

function positiveInteger(value: string | undefined, fallback: number, maximum?: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return maximum === undefined ? parsed : Math.min(parsed, maximum);
}

function parseAllowedOrigins(value: string | undefined): string[] {
  const candidates = value?.split(',') ?? DEFAULT_MCP_ALLOWED_ORIGINS;

  const origins = candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => {
      try {
        const url = new URL(candidate);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === candidate;
      } catch {
        return false;
      }
    });

  return origins.length > 0 ? origins : DEFAULT_MCP_ALLOWED_ORIGINS;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? env.MCP_PORT ?? '8080', 10);
  const jusoApiTimeoutMs = Number.parseInt(env.JUSO_API_TIMEOUT_MS ?? String(DEFAULT_JUSO_API_TIMEOUT_MS), 10);

  return {
    port: Number.isFinite(port) ? port : 8080,
    host: env.MCP_HOST || '0.0.0.0',
    molitApiKey: env.MOLIT_OPEN_DATA_API_KEY || undefined,
    molitBaseUrl: env.MOLIT_OPEN_DATA_BASE_URL || DEFAULT_MOLIT_OPEN_DATA_BASE_URL,
    molitApiTimeoutMs: positiveInteger(
      env.MOLIT_OPEN_DATA_TIMEOUT_MS,
      DEFAULT_MOLIT_OPEN_DATA_TIMEOUT_MS,
      MAX_MOLIT_LOOKUP_TIMEOUT_MS
    ),
    molitTotalTimeoutMs: positiveInteger(
      env.MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS,
      DEFAULT_MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS,
      MAX_MOLIT_LOOKUP_TIMEOUT_MS
    ),
    jusoApiKey: env.JUSO_API_KEY || undefined,
    jusoApiBaseUrl: env.JUSO_API_BASE_URL || DEFAULT_JUSO_API_BASE_URL,
    jusoApiTimeoutMs: Number.isFinite(jusoApiTimeoutMs) && jusoApiTimeoutMs > 0 ? jusoApiTimeoutMs : DEFAULT_JUSO_API_TIMEOUT_MS,
    contractLookupTimeoutMs: positiveInteger(
      env.CONTRACT_LOOKUP_TIMEOUT_MS,
      DEFAULT_CONTRACT_LOOKUP_TIMEOUT_MS,
      MAX_CONTRACT_LOOKUP_TIMEOUT_MS
    ),
    allowedOrigins: parseAllowedOrigins(env.MCP_ALLOWED_ORIGINS),
    mcpRateLimitPerMinute: positiveInteger(
      env.MCP_RATE_LIMIT_PER_MINUTE,
      DEFAULT_MCP_RATE_LIMIT_PER_MINUTE,
      MAX_MCP_RATE_LIMIT_PER_MINUTE
    ),
    mcpMaxConcurrentRequests: positiveInteger(
      env.MCP_MAX_CONCURRENT_REQUESTS,
      DEFAULT_MCP_MAX_CONCURRENT_REQUESTS,
      MAX_MCP_CONCURRENT_REQUESTS
    )
  };
}
