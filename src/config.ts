import 'dotenv/config';

export const DEFAULT_MOLIT_OPEN_DATA_BASE_URL = 'https://apis.data.go.kr/1613000';
export const DEFAULT_JUSO_API_BASE_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
export const DEFAULT_JUSO_API_TIMEOUT_MS = 3000;

export interface AppConfig {
  port: number;
  host: string;
  molitApiKey?: string;
  molitBaseUrl: string;
  jusoApiKey?: string;
  jusoApiBaseUrl: string;
  jusoApiTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? env.MCP_PORT ?? '8080', 10);
  const jusoApiTimeoutMs = Number.parseInt(env.JUSO_API_TIMEOUT_MS ?? String(DEFAULT_JUSO_API_TIMEOUT_MS), 10);

  return {
    port: Number.isFinite(port) ? port : 8080,
    host: env.MCP_HOST || '0.0.0.0',
    molitApiKey: env.MOLIT_OPEN_DATA_API_KEY || undefined,
    molitBaseUrl: env.MOLIT_OPEN_DATA_BASE_URL || DEFAULT_MOLIT_OPEN_DATA_BASE_URL,
    jusoApiKey: env.JUSO_API_KEY || undefined,
    jusoApiBaseUrl: env.JUSO_API_BASE_URL || DEFAULT_JUSO_API_BASE_URL,
    jusoApiTimeoutMs: Number.isFinite(jusoApiTimeoutMs) && jusoApiTimeoutMs > 0 ? jusoApiTimeoutMs : DEFAULT_JUSO_API_TIMEOUT_MS
  };
}
