import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SERVICE_NAME } from '../domain/types.js';
import { registerTools } from './tools.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'jipgyeyak-gwaenchana-mcp',
    version: '0.1.0'
  });

  registerTools(server);

  return server;
}

export function getServerDisplayName(): string {
  return `${SERVICE_NAME} MCP`;
}
