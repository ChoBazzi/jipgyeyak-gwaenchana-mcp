import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createHttpApp } from '../src/httpApp.js';

const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'http-test', version: '1.0.0' }
  }
};

describe('HTTP MCP server', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createHttpApp(
      loadConfig({
        PORT: '0',
        MCP_HOST: '127.0.0.1',
        MCP_ALLOWED_ORIGINS: 'https://playmcp.kakao.com'
      })
    );
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it('accepts PlayMCP and non-browser requests while rejecting an unknown Origin', async () => {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    };
    const allowed = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...headers, origin: 'https://playmcp.kakao.com' },
      body: JSON.stringify(initializeRequest)
    });
    const noOrigin = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(initializeRequest)
    });
    const rejected = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...headers, origin: 'https://evil.example' },
      body: JSON.stringify(initializeRequest)
    });

    expect(allowed.status).toBe(200);
    expect(noOrigin.status).toBe(200);
    expect(rejected.status).toBe(403);
    expect(allowed.headers.get('x-powered-by')).toBeNull();
  });

  it('reports missing production dependencies without failing the liveness check', async () => {
    const health = await fetch(`${baseUrl}/health`);
    const readiness = await fetch(`${baseUrl}/ready`);

    expect(health.status).toBe(200);
    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toMatchObject({
      ok: false,
      dependencies: { molit: false, juso: false }
    });
  });

  it('limits repeated public MCP requests before they can exhaust external API quota', async () => {
    const limitedApp = createHttpApp(
      loadConfig({
        MCP_HOST: '127.0.0.1',
        MCP_ALLOWED_ORIGINS: 'https://playmcp.kakao.com',
        MCP_RATE_LIMIT_PER_MINUTE: '2'
      })
    );
    const limitedServer = limitedApp.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => limitedServer.once('listening', resolve));
    const address = limitedServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/mcp`;
    const request = () =>
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify(initializeRequest)
      });

    try {
      expect((await request()).status).toBe(200);
      expect((await request()).status).toBe(200);
      const rejected = await request();
      expect(rejected.status).toBe(429);
      expect(await rejected.json()).toMatchObject({
        jsonrpc: '2.0',
        error: { code: -32001 }
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        limitedServer.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
