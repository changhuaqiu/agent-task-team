import { describe, expect, it } from 'vitest';
import { buildAcpExecOptions } from './execOptions';

describe('buildAcpExecOptions', () => {
  it('preserves the daemon execution boundary fields for adapter runtimes', () => {
    const env = { CODEX_HOME: '/isolated/codex' };
    expect(buildAcpExecOptions({
      engine: 'codex',
      cwd: '/project/worktree',
      env,
      systemPrompt: 'system context',
      resumeSessionId: 'runtime-session-1',
      timeoutMs: 180_000,
    })).toEqual({
      cwd: '/project/worktree',
      env,
      systemPrompt: 'system context',
      resumeSessionId: 'runtime-session-1',
      timeout: 180_000,
    });
  });

  it('keeps OpenCode instructions out of the ACP systemPrompt channel', () => {
    expect(buildAcpExecOptions({
      engine: 'opencode',
      cwd: '/project',
      env: {},
      systemPrompt: 'loaded through OPENCODE_CONFIG',
      timeoutMs: 0,
    })).toEqual({
      cwd: '/project',
      env: {},
      systemPrompt: undefined,
      resumeSessionId: undefined,
      timeout: undefined,
    });
  });
});
