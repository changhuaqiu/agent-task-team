import { describe, expect, it } from 'vitest';
import {
  normalizePersistedRuntimeSelection,
  resolveRuntimeSelection,
} from './runtime-selection';

describe('runtime selection boundary', () => {
  it('defaults an omitted selection to OpenCode', () => {
    expect(resolveRuntimeSelection(undefined, undefined)).toEqual({
      engine: 'opencode',
      runtimeId: 'opencode-local',
    });
  });

  it('accepts a supported matching engine and runtime', () => {
    expect(resolveRuntimeSelection('codex', 'codex-cli')).toEqual({
      engine: 'codex',
      runtimeId: 'codex-cli',
    });
  });

  it.each([
    ['gemini', undefined],
    [undefined, 'gemini-cli'],
    ['unknown', undefined],
    ['codex', 'claude-cli'],
    [null, undefined],
    ['', undefined],
    [undefined, null],
    [undefined, ''],
    [undefined, 42],
    [undefined, { id: 'opencode-local' }],
  ])('rejects unsupported or mismatched raw input %s/%s', (engine, runtimeId) => {
    expect(() => resolveRuntimeSelection(engine, runtimeId)).toThrow();
  });

  it('normalizes only the persisted Gemini compatibility pair', () => {
    expect(normalizePersistedRuntimeSelection('gemini', 'gemini-cli')).toEqual({
      engine: 'opencode',
      runtimeId: 'opencode-local',
    });
    expect(() => normalizePersistedRuntimeSelection('unknown', undefined)).toThrow(
      /unsupported persisted Agent engine/,
    );
  });
});
