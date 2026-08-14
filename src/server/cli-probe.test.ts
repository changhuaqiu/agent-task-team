import { describe, it, expect } from 'vitest';
import { buildProbeEnv, tryCliProbe } from './cli-probe';

describe('buildProbeEnv', () => {
  it('maps anthropic to ANTHROPIC_API_KEY', () => {
    const env = buildProbeEnv('anthropic', 'sk-ant-123');
    expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-123' });
  });

  it('maps anthropic with baseUrl', () => {
    const env = buildProbeEnv('anthropic', 'sk-ant-123', 'https://custom.api.com/v1');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-123');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://custom.api.com');
  });

  it('strips /v1 from anthropic baseUrl (SDK adds it)', () => {
    const env = buildProbeEnv('anthropic', 'sk-key', 'https://host/v1');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://host');
  });

  it('does not strip /v1 from anthropic baseUrl if not trailing', () => {
    const env = buildProbeEnv('anthropic', 'sk-key', 'https://host/v1/proxy');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://host/v1/proxy');
  });

  it('omits baseUrl when undefined for anthropic', () => {
    const env = buildProbeEnv('anthropic', 'sk-ant');
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL');
  });

  it('maps openai to OPENAI_API_KEY', () => {
    const env = buildProbeEnv('openai', 'sk-oai-456');
    expect(env).toEqual({ OPENAI_API_KEY: 'sk-oai-456' });
  });

  it('maps openai with baseUrl', () => {
    const env = buildProbeEnv('openai', 'sk-oai-456', 'https://api.custom.com');
    expect(env.OPENAI_API_KEY).toBe('sk-oai-456');
    expect(env.OPENAI_BASE_URL).toBe('https://api.custom.com');
    expect(env.OPENAI_API_BASE).toBe('https://api.custom.com');
  });

  it('maps google to GEMINI_API_KEY and GOOGLE_API_KEY', () => {
    const env = buildProbeEnv('google', 'ai-go-789');
    expect(env.GEMINI_API_KEY).toBe('ai-go-789');
    expect(env.GOOGLE_API_KEY).toBe('ai-go-789');
  });

  it('maps google with baseUrl', () => {
    const env = buildProbeEnv('google', 'ai-go-789', 'https://genai.host');
    expect(env.GEMINI_BASE_URL).toBe('https://genai.host');
  });

  it('maps kimi to MOONSHOT_API_KEY', () => {
    const env = buildProbeEnv('kimi', 'mk-key', 'https://kimi.base');
    expect(env.MOONSHOT_API_KEY).toBe('mk-key');
    expect(env.CAT_CAFE_KIMI_BASE_URL).toBe('https://kimi.base');
  });

  it('maps kimi without baseUrl', () => {
    const env = buildProbeEnv('kimi', 'mk-key');
    expect(env).toEqual({ MOONSHOT_API_KEY: 'mk-key' });
  });

  it('maps opencode to OPENCODE_API_KEY', () => {
    const env = buildProbeEnv('opencode', 'oc-key');
    expect(env).toEqual({ OPENCODE_API_KEY: 'oc-key' });
  });

  it('maps other to API_KEY', () => {
    const env = buildProbeEnv('other', 'generic');
    expect(env).toEqual({ API_KEY: 'generic' });
  });

  it('maps other with baseUrl', () => {
    const env = buildProbeEnv('other', 'generic', 'https://base');
    expect(env.API_KEY).toBe('generic');
    expect(env.API_BASE_URL).toBe('https://base');
  });

  it('sets env var even with empty string apiKey', () => {
    const env = buildProbeEnv('anthropic', '');
    expect(env.ANTHROPIC_API_KEY).toBe('');
  });
});

describe('tryCliProbe', () => {
  it('returns ok:true for successful CLI run', async () => {
    const result = await tryCliProbe('claude', {
      execFn: async () => ({ stdout: 'pong' }),
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok:true for rate limit (proves auth worked)', async () => {
    const err = Object.assign(new Error('rate limit exceeded'), { code: 1, stderr: '' });
    const result = await tryCliProbe('claude', {
      execFn: async () => { throw err; },
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok:true for budget exceeded in stderr', async () => {
    const err = Object.assign(new Error('command failed'), { code: 1, stderr: 'budget exceeded for session' });
    const result = await tryCliProbe('claude', {
      execFn: async () => { throw err; },
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    'model gemini-missing unavailable',
    'model foo is not supported',
    'invalid_request_error: bad model',
  ])('does not authenticate an explicitly rejected model: %s', async (message) => {
    const result = await tryCliProbe('opencode', {
      execFn: async () => ({ stdout: message }),
    });
    expect(result.ok).toBe(false);
  });

  it('does not authenticate an unavailable model reported through command failure', async () => {
    const err = Object.assign(new Error('command failed'), {
      code: 1,
      stderr: 'model google-compat/missing unavailable',
    });
    const result = await tryCliProbe('opencode', {
      execFn: async () => { throw err; },
    });
    expect(result.ok).toBe(false);
  });

  it('returns ok:false for unauthorized stdout', async () => {
    const result = await tryCliProbe('claude', {
      execFn: async () => ({ stdout: 'Error: 401 Unauthorized' }),
    });
    expect(result.ok).toBe(false);
  });

  it('returns ok:false for exception stdout', async () => {
    const result = await tryCliProbe('claude', {
      execFn: async () => ({ stdout: 'exception occurred' }),
    });
    expect(result.ok).toBe(false);
  });

  it('returns ok:false for error-prefixed stdout', async () => {
    const result = await tryCliProbe('claude', {
      execFn: async () => ({ stdout: 'Error: something broke' }),
    });
    expect(result.ok).toBe(false);
  });

  it('returns ok:false for timeout (code=null)', async () => {
    const err = Object.assign(new Error('killed'), { code: null });
    const result = await tryCliProbe('claude', {
      execFn: async () => { throw err; },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/超时/);
  });

  it('returns ok:false for empty stdout', async () => {
    const result = await tryCliProbe('claude', {
      execFn: async () => ({ stdout: '   ' }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/无响应/);
  });

  it('returns ok:false for unknown CLI', async () => {
    const result = await tryCliProbe('nonexistent-cli', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown/i);
  });

  it('rejects model with special characters', async () => {
    const result = await tryCliProbe('claude', {
      model: 'claude; rm -rf /',
      execFn: async () => ({ stdout: 'pong' }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid model/i);
  });

  it('rejects model with path traversal', async () => {
    const result = await tryCliProbe('claude', {
      model: '../evil; rm -rf /',
      execFn: async () => ({ stdout: 'pong' }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid model/i);
  });

  it('accepts valid model names', async () => {
    const result = await tryCliProbe('claude', {
      model: 'claude-sonnet-4-6',
      execFn: async () => ({ stdout: 'pong' }),
    });
    expect(result.ok).toBe(true);
  });

  it('accepts model with org prefix (slash)', async () => {
    const result = await tryCliProbe('claude', {
      model: 'zhipuai-coding-plan/glm-5.1',
      execFn: async () => ({ stdout: 'pong' }),
    });
    expect(result.ok).toBe(true);
  });

  it('passes env and timeout to execFn', async () => {
    let receivedCmd: string;
    let receivedOpts: any;
    await tryCliProbe('claude', {
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      timeout: 5000,
      execFn: async (cmd, opts) => {
        receivedCmd = cmd;
        receivedOpts = opts;
        return { stdout: 'pong' };
      },
    });
    expect(receivedCmd!).toContain('claude');
    expect(receivedOpts.env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(receivedOpts.timeout).toBe(5000);
  });

  it('uses default timeout of 30000', async () => {
    let receivedOpts: any;
    await tryCliProbe('claude', {
      execFn: async (_cmd, opts) => {
        receivedOpts = opts;
        return { stdout: 'pong' };
      },
    });
    expect(receivedOpts.timeout).toBe(30_000);
  });

  it('builds correct shell command for claude with model', async () => {
    let receivedCmd: string;
    await tryCliProbe('claude', {
      model: 'claude-opus-4',
      execFn: async (cmd) => {
        receivedCmd = cmd;
        return { stdout: 'pong' };
      },
    });
    expect(receivedCmd!).toContain('claude');
    expect(receivedCmd!).toContain('--model claude-opus-4');
  });

  it('builds correct shell command for codex', async () => {
    let receivedCmd: string;
    await tryCliProbe('codex', {
      execFn: async (cmd) => {
        receivedCmd = cmd;
        return { stdout: 'pong' };
      },
    });
    expect(receivedCmd!).toContain('codex exec');
  });

  it.each(['gemini', 'kimi', 'other'])(
    'does not retain the retired %s verification bypass',
    async (cli) => {
      await expect(tryCliProbe(cli)).resolves.toEqual({
        ok: false,
        error: `unknown CLI: ${cli}`,
      });
    },
  );

  it('builds correct shell command for opencode', async () => {
    let receivedCmd: string;
    await tryCliProbe('opencode', {
      execFn: async (cmd) => {
        receivedCmd = cmd;
        return { stdout: 'pong' };
      },
    });
    expect(receivedCmd!).toContain('opencode run');
  });
});
