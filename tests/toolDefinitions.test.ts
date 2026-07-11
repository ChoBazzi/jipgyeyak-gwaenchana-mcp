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

  it('guides the agent not to invent missing contract values or generic complex names', () => {
    const searchTool = TOOL_DEFINITIONS.find((tool) => tool.name === 'search_rent_comparables');
    const compareTool = TOOL_DEFINITIONS.find((tool) => tool.name === 'compare_contract_terms');

    expect(searchTool?.description).toContain('지역명과 주택 유형만');
    expect(compareTool?.description).toContain('추측하지');
  });
});
