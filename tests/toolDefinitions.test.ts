import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from '../src/mcp/tools.js';

describe('MCP tool definitions', () => {
  it('includes the service name and annotations on every PlayMCP tool', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(5);

    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description).toContain('집계약괜찮아');
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      });
      expect(tool.annotations.title).toContain('집계약괜찮아');
    }
  });
});
