import 'dotenv/config';

export const DEFAULT_MOLIT_OPEN_DATA_BASE_URL = 'https://apis.data.go.kr/1613000';

export interface AppConfig {
  port: number;
  molitApiKey?: string;
  molitBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = env.MCP_PORT ? Number.parseInt(env.MCP_PORT, 10) : 3000;

  return {
    port: Number.isFinite(port) ? port : 3000,
    molitApiKey: env.MOLIT_OPEN_DATA_API_KEY || undefined,
    molitBaseUrl: env.MOLIT_OPEN_DATA_BASE_URL || DEFAULT_MOLIT_OPEN_DATA_BASE_URL
  };
}
