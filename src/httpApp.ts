import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';
import type { AppConfig } from './config.js';
import { loadConfig } from './config.js';
import { createMcpServer, getServerDisplayName } from './mcp/server.js';

export function createHttpApp(config: AppConfig = loadConfig()): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));

  let rateWindowStartedAt = Date.now();
  let requestCount = 0;
  let concurrentRequests = 0;
  app.use('/mcp', (_req, res, next) => {
    const now = Date.now();
    if (now - rateWindowStartedAt >= 60_000) {
      rateWindowStartedAt = now;
      requestCount = 0;
    }

    if (
      requestCount >= config.mcpRateLimitPerMinute ||
      concurrentRequests >= config.mcpMaxConcurrentRequests
    ) {
      const retryAfterSeconds = Math.max(1, Math.ceil((rateWindowStartedAt + 60_000 - now) / 1000));
      res.setHeader('retry-after', String(retryAfterSeconds));
      res.status(429).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Request limit exceeded. Retry later.' },
        id: null
      });
      return;
    }

    requestCount += 1;
    concurrentRequests += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      concurrentRequests -= 1;
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: getServerDisplayName() });
  });

  app.get('/ready', (_req, res) => {
    const dependencies = {
      molit: Boolean(config.molitApiKey),
      juso: Boolean(config.jusoApiKey)
    };
    const ok = dependencies.molit && dependencies.juso;
    res.status(ok ? 200 : 503).json({ ok, dependencies });
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      allowedOrigins: config.allowedOrigins,
      enableDnsRebindingProtection: true
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP request failed', error instanceof Error ? error.message : 'unknown error');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST for stateless Streamable HTTP.' },
      id: null
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed for stateless Streamable HTTP.' },
      id: null
    });
  });

  return app;
}
