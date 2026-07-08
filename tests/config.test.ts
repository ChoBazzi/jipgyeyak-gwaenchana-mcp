import { describe, expect, it } from 'vitest';
import { DEFAULT_MOLIT_OPEN_DATA_BASE_URL, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses the MOLIT Open Data service root as the default base URL', () => {
    const config = loadConfig({});

    expect(config.molitBaseUrl).toBe(DEFAULT_MOLIT_OPEN_DATA_BASE_URL);
    expect(config.molitBaseUrl).toBe('https://apis.data.go.kr/1613000');
  });
});
