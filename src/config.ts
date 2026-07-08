import 'dotenv/config';

export const DEFAULT_MOLIT_OPEN_DATA_BASE_URL = 'https://apis.data.go.kr/1613000';

export interface AppConfig {
  port: number;
  host: string;
  molitApiKey?: string;
  molitBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? env.MCP_PORT ?? '8080', 10);

  return {
    port: Number.isFinite(port) ? port : 8080,
    host: env.MCP_HOST || '0.0.0.0',
    molitApiKey: env.MOLIT_OPEN_DATA_API_KEY || undefined,
    molitBaseUrl: env.MOLIT_OPEN_DATA_BASE_URL || DEFAULT_MOLIT_OPEN_DATA_BASE_URL
  };
}
