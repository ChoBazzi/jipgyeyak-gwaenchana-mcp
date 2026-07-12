import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JUSO_API_BASE_URL,
  DEFAULT_CONTRACT_LOOKUP_TIMEOUT_MS,
  DEFAULT_MOLIT_OPEN_DATA_BASE_URL,
  DEFAULT_MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS,
  DEFAULT_MOLIT_OPEN_DATA_TIMEOUT_MS,
  DEFAULT_MCP_MAX_CONCURRENT_REQUESTS,
  DEFAULT_MCP_RATE_LIMIT_PER_MINUTE,
  loadConfig
} from '../src/config.js';

describe('loadConfig', () => {
  it('uses the MOLIT Open Data service root as the default base URL', () => {
    const config = loadConfig({});

    expect(config.molitBaseUrl).toBe(DEFAULT_MOLIT_OPEN_DATA_BASE_URL);
    expect(config.molitBaseUrl).toBe('https://apis.data.go.kr/1613000');
    expect(config.molitApiTimeoutMs).toBe(DEFAULT_MOLIT_OPEN_DATA_TIMEOUT_MS);
    expect(config.molitApiTimeoutMs).toBe(10000);
    expect(config.molitTotalTimeoutMs).toBe(DEFAULT_MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS);
    expect(config.molitTotalTimeoutMs).toBe(10000);
    expect(config.contractLookupTimeoutMs).toBe(DEFAULT_CONTRACT_LOOKUP_TIMEOUT_MS);
    expect(config.contractLookupTimeoutMs).toBe(15000);
    expect(config.allowedOrigins).toEqual(['https://playmcp.kakao.com']);
    expect(config.mcpRateLimitPerMinute).toBe(DEFAULT_MCP_RATE_LIMIT_PER_MINUTE);
    expect(config.mcpMaxConcurrentRequests).toBe(DEFAULT_MCP_MAX_CONCURRENT_REQUESTS);
    expect(config.jusoApiBaseUrl).toBe(DEFAULT_JUSO_API_BASE_URL);
    expect(config.jusoApiBaseUrl).toBe('https://business.juso.go.kr/addrlink/addrLinkApi.do');
    expect(config.jusoApiTimeoutMs).toBe(3000);
  });

  it('loads MOLIT timeout configuration and rejects invalid values', () => {
    expect(loadConfig({ MOLIT_OPEN_DATA_TIMEOUT_MS: '7500' }).molitApiTimeoutMs).toBe(7500);
    expect(loadConfig({ MOLIT_OPEN_DATA_TIMEOUT_MS: 'invalid' }).molitApiTimeoutMs).toBe(10000);
    expect(loadConfig({ MOLIT_OPEN_DATA_TIMEOUT_MS: '0' }).molitApiTimeoutMs).toBe(10000);
    expect(loadConfig({ MOLIT_OPEN_DATA_TIMEOUT_MS: '15000' }).molitApiTimeoutMs).toBe(10000);
    expect(loadConfig({ MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS: '1800' }).molitTotalTimeoutMs).toBe(1800);
    expect(loadConfig({ MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS: '15000' }).molitTotalTimeoutMs).toBe(10000);
    expect(loadConfig({ CONTRACT_LOOKUP_TIMEOUT_MS: '20000' }).contractLookupTimeoutMs).toBe(15000);
    expect(loadConfig({ MCP_RATE_LIMIT_PER_MINUTE: '5000' }).mcpRateLimitPerMinute).toBe(1000);
    expect(loadConfig({ MCP_MAX_CONCURRENT_REQUESTS: '500' }).mcpMaxConcurrentRequests).toBe(64);
  });

  it('loads only valid HTTP origins for DNS rebinding protection', () => {
    expect(
      loadConfig({
        MCP_ALLOWED_ORIGINS: 'https://playmcp.kakao.com, http://localhost:3000,not-a-url,ftp://example.com'
      }).allowedOrigins
    ).toEqual(['https://playmcp.kakao.com', 'http://localhost:3000']);
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
