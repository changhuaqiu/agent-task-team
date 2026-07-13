import { describe, it, expect } from 'vitest';
import { checkCapabilities } from './capabilityRouter';
import { CODEX_CAPS, CLAUDE_CAPS, OPENCODE_CAPS } from './capabilities';
import type { AgentBackend, ExecOptions } from './types';

function makeBackend(caps: typeof CODEX_CAPS): AgentBackend {
  return { capabilities: caps, execute: (() => ({})) as any };
}

describe('checkCapabilities — resume 降级', () => {
  it('codex 不支持 resume 时，剔除 resumeSessionId 并返回警告', () => {
    const backend = makeBackend(CODEX_CAPS);
    const opts: ExecOptions = { resumeSessionId: 'sess-123' };
    const result = checkCapabilities(backend, { prompt: 'hi', opts });
    expect(result.opts.resumeSessionId).toBeUndefined();
    expect(result.warnings.some((w) => w.field === 'resumeSessionId')).toBe(true);
  });

  it('claude 支持 resume 时，保留 resumeSessionId 且无相关警告', () => {
    const backend = makeBackend(CLAUDE_CAPS);
    const opts: ExecOptions = { resumeSessionId: 'sess-456' };
    const result = checkCapabilities(backend, { prompt: 'hi', opts });
    expect(result.opts.resumeSessionId).toBe('sess-456');
    expect(result.warnings.some((w) => w.field === 'resumeSessionId')).toBe(false);
  });
});

describe('checkCapabilities — systemPrompt 降级', () => {
  it('codex 不支持 systemPrompt 时，拼进 prompt 头并返回警告', () => {
    const backend = makeBackend(CODEX_CAPS);
    const opts: ExecOptions = { systemPrompt: '你是审查员' };
    const result = checkCapabilities(backend, { prompt: '审查这段代码', opts });
    expect(result.opts.systemPrompt).toBeUndefined();
    expect(result.prompt).toContain('你是审查员');
    expect(result.prompt).toContain('审查这段代码');
    expect(result.warnings.some((w) => w.field === 'systemPrompt')).toBe(true);
  });

  it('claude 支持 systemPrompt 时，保留在 opts 且不拼 prompt', () => {
    const backend = makeBackend(CLAUDE_CAPS);
    const opts: ExecOptions = { systemPrompt: '你是审查员' };
    const result = checkCapabilities(backend, { prompt: '审查代码', opts });
    expect(result.opts.systemPrompt).toBe('你是审查员');
    expect(result.prompt).toBe('审查代码');
  });
});

describe('checkCapabilities — maxTurns 降级', () => {
  it('codex 不支持 maxTurns 时，剔除并返回警告', () => {
    const backend = makeBackend(CODEX_CAPS);
    const opts: ExecOptions = { maxTurns: 10 };
    const result = checkCapabilities(backend, { prompt: 'hi', opts });
    expect(result.opts.maxTurns).toBeUndefined();
    expect(result.warnings.some((w) => w.field === 'maxTurns')).toBe(true);
  });

  it('claude 支持 maxTurns 时，保留且无警告', () => {
    const backend = makeBackend(CLAUDE_CAPS);
    const opts: ExecOptions = { maxTurns: 10 };
    const result = checkCapabilities(backend, { prompt: 'hi', opts });
    expect(result.opts.maxTurns).toBe(10);
    expect(result.warnings.some((w) => w.field === 'maxTurns')).toBe(false);
  });
});

describe('checkCapabilities — PTY 降级', () => {
  it('opencode requiresPty 且环境无 PTY 时，返回 best-effort 警告（不阻断执行）', () => {
    const backend = makeBackend(OPENCODE_CAPS);
    const result = checkCapabilities(backend, { prompt: 'hi', opts: {} }, { hasPty: () => false });
    expect(result.warnings.some((w) => w.field === 'requiresPty')).toBe(true);
    expect(result.opts).toEqual({});
  });

  it('opencode requiresPty 且环境有 PTY 时，无警告', () => {
    const backend = makeBackend(OPENCODE_CAPS);
    const result = checkCapabilities(backend, { prompt: 'hi', opts: {} }, { hasPty: () => true });
    expect(result.warnings.some((w) => w.field === 'requiresPty')).toBe(false);
  });
});
