import { describe, expect, it } from 'vitest';
import { isNativeRuntimeTool } from './nativeTools';

describe('isNativeRuntimeTool', () => {
  it.each(['Read', 'read', 'WRITE', 'write', 'Bash', 'bash'])(
    'treats %s as a runtime-native tool',
    (name) => expect(isNativeRuntimeTool(name)).toBe(true),
  );

  it('accepts MCP tools and rejects platform custom tools', () => {
    expect(isNativeRuntimeTool('mcp__github__search')).toBe(true);
    expect(isNativeRuntimeTool('publish_release_notes')).toBe(false);
  });
});
