import { describe, expect, it } from 'vitest';
import { DEFAULT_JUSO_API_BASE_URL, DEFAULT_MOLIT_OPEN_DATA_BASE_URL, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses the MOLIT Open Data service root as the default base URL', () => {
    const config = loadConfig({});

    expect(config.molitBaseUrl).toBe(DEFAULT_MOLIT_OPEN_DATA_BASE_URL);
    expect(config.molitBaseUrl).toBe('https://apis.data.go.kr/1613000');
    expect(config.jusoApiBaseUrl).toBe(DEFAULT_JUSO_API_BASE_URL);
    expect(config.jusoApiBaseUrl).toBe('https://business.juso.go.kr/addrlink/addrLinkApi.do');
    expect(config.jusoApiTimeoutMs).toBe(3000);
  });

  it('uses deployment-friendly PORT and host defaults', () => {
    expect(loadConfig({}).port).toBe(8080);
    expect(loadConfig({}).host).toBe('0.0.0.0');
    expect(loadConfig({ PORT: '9090', MCP_PORT: '3017', MCP_HOST: '127.0.0.1' })).toMatchObject({
      port: 9090,
      host: '127.0.0.1'
    });
    expect(loadConfig({ MCP_PORT: '3017' }).port).toBe(3017);
  });

  it('loads Juso API runtime configuration', () => {
    expect(
      loadConfig({
        JUSO_API_KEY: 'runtime-key',
        JUSO_API_BASE_URL: 'https://example.test/juso',
        JUSO_API_TIMEOUT_MS: '4500'
      })
    ).toMatchObject({
      jusoApiKey: 'runtime-key',
      jusoApiBaseUrl: 'https://example.test/juso',
      jusoApiTimeoutMs: 4500
    });

    expect(loadConfig({ JUSO_API_TIMEOUT_MS: 'invalid' }).jusoApiTimeoutMs).toBe(3000);
  });
});
