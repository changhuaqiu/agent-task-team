import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRuntimeConfig,
  cleanupRuntimeConfig,
  makeInvocationId,
  type AccountProvider,
  type RuntimeConfigInput,
} from './opencode-config';

// Use a temp dir for test isolation
const TEST_DATA_DIR = path.join(process.cwd(), '.ath-test-oc-config');

afterEach(() => {
  // Clean up test data dir
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch { /* best effort */ }
});

// Helper to invoke generateRuntimeConfig with a test data dir
function generate(input: RuntimeConfigInput, invocationId = 'test-inv-001') {
  const origDataDir = process.env.ATH_DATA_DIR;
  process.env.ATH_DATA_DIR = TEST_DATA_DIR;
  try {
    return generateRuntimeConfig(invocationId, input);
  } finally {
    if (origDataDir === undefined) {
      delete process.env.ATH_DATA_DIR;
    } else {
      process.env.ATH_DATA_DIR = origDataDir;
    }
  }
}

// ─── generateRuntimeConfig: standard providers without baseUrl ───

describe('generateRuntimeConfig: native providers without baseUrl', () => {
  it('returns { generated: false } for anthropic without baseUrl', () => {
    const result = generate({
      provider: 'anthropic',
      apiKey: 'sk-ant-123',
      models: ['claude-sonnet-4-20250514'],
    });
    expect(result.generated).toBe(false);
    expect(result.configPath).toBeUndefined();
    expect(result.configDir).toBeUndefined();
    expect(Object.keys(result.env)).toHaveLength(0);
  });

  it('returns { generated: false } for openai without baseUrl', () => {
    const result = generate({
      provider: 'openai',
      apiKey: 'sk-oai-456',
      models: ['gpt-4o'],
    });
    expect(result.generated).toBe(false);
  });

  it('returns { generated: false } for google without baseUrl', () => {
    const result = generate({
      provider: 'google',
      apiKey: 'ai-go-789',
      models: ['gemini-2.5-pro'],
    });
    expect(result.generated).toBe(false);
  });
});

// ─── generateRuntimeConfig: native providers WITH baseUrl ───

describe('generateRuntimeConfig: native providers with baseUrl', () => {
  it('returns { generated: true } for anthropic WITH baseUrl', () => {
    const result = generate({
      provider: 'anthropic',
      apiKey: 'sk-ant-123',
      baseUrl: 'https://custom.anthropic.com',
      models: ['claude-sonnet-4-20250514'],
      defaultModel: 'claude-sonnet-4-20250514',
    });
    expect(result.generated).toBe(true);
    expect(result.configPath).toBeTruthy();
    expect(result.configDir).toBeTruthy();
    expect(result.env.OPENCODE_CONFIG).toBe(result.configPath);
  });

  it('uses native SDK npm package for anthropic with baseUrl', () => {
    const result = generate({
      provider: 'anthropic',
      apiKey: 'sk-ant-123',
      baseUrl: 'https://custom.anthropic.com',
      models: ['claude-sonnet-4-20250514'],
      defaultModel: 'claude-sonnet-4-20250514',
    });
    const config = JSON.parse(fs.readFileSync(result.configPath!, 'utf-8'));
    const providerKey = Object.keys(config.provider)[0];
    expect(config.provider[providerKey].npm).toBe('@ai-sdk/anthropic');
  });
});

// ─── generateRuntimeConfig: non-native providers ───

describe('generateRuntimeConfig: non-native providers', () => {
  it('returns { generated: true } for kimi provider', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key-123',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    expect(result.generated).toBe(true);
    expect(result.configPath).toBeTruthy();
  });

  it('returns { generated: true } for opencode provider', () => {
    const result = generate({
      provider: 'opencode',
      apiKey: 'oc-key-456',
      models: ['opencode-v1'],
      defaultModel: 'opencode-v1',
    });
    expect(result.generated).toBe(true);
  });

  it('returns { generated: true } for other provider', () => {
    const result = generate({
      provider: 'other',
      apiKey: 'generic-key',
      baseUrl: 'https://custom.llm.api/v1',
      models: ['custom-model-1', 'custom-model-2'],
      defaultModel: 'custom-model-1',
    });
    expect(result.generated).toBe(true);
  });
});

// ─── Config JSON structure ───

describe('generateRuntimeConfig: config JSON structure', () => {
  it('uses {env:ATH_OC_API_KEY} placeholder — never raw API key', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'secret-key-that-must-not-appear',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    const content = fs.readFileSync(result.configPath!, 'utf-8');
    expect(content).not.toContain('secret-key-that-must-not-appear');
    expect(content).toContain('{env:ATH_OC_API_KEY}');
  });

  it('uses {env:ATH_OC_BASE_URL} placeholder for baseUrl', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    const content = fs.readFileSync(result.configPath!, 'utf-8');
    expect(content).toContain('{env:ATH_OC_BASE_URL}');
    expect(content).not.toContain('https://api.moonshot.cn/v1');
  });

  it('omits baseURL when no baseUrl provided', () => {
    const result = generate({
      provider: 'opencode',
      apiKey: 'oc-key',
      models: ['oc-v1'],
      defaultModel: 'oc-v1',
    });
    const config = JSON.parse(fs.readFileSync(result.configPath!, 'utf-8'));
    const providerKey = Object.keys(config.provider)[0];
    expect(config.provider[providerKey].options.baseURL).toBeUndefined();
  });

  it('has correct model format: provider-compat/model-name', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    const config = JSON.parse(fs.readFileSync(result.configPath!, 'utf-8'));
    expect(config.model).toBe('kimi-compat/moonshot-v2');
  });

  it('has correct models map', () => {
    const result = generate({
      provider: 'other',
      apiKey: 'key',
      baseUrl: 'https://api.host',
      models: ['model-a', 'model-b'],
      defaultModel: 'model-a',
    });
    const config = JSON.parse(fs.readFileSync(result.configPath!, 'utf-8'));
    const providerKey = Object.keys(config.provider)[0];
    expect(config.provider[providerKey].models).toEqual({
      'model-a': { name: 'model-a' },
      'model-b': { name: 'model-b' },
    });
  });

  it('uses @ai-sdk/openai-compatible for non-native providers', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    const config = JSON.parse(fs.readFileSync(result.configPath!, 'utf-8'));
    const providerKey = Object.keys(config.provider)[0];
    expect(config.provider[providerKey].npm).toBe('@ai-sdk/openai-compatible');
  });

  it('has $schema field', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    const config = JSON.parse(fs.readFileSync(result.configPath!, 'utf-8'));
    expect(config.$schema).toBe('https://opencode.ai/config.json');
  });

  it('uses first model as default when defaultModel not specified', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      models: ['moonshot-v2', 'moonshot-v1'],
    });
    const config = JSON.parse(fs.readFileSync(result.configPath!, 'utf-8'));
    expect(config.model).toBe('kimi-compat/moonshot-v2');
  });

  it('adds default model when models array is empty', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      models: [],
    });
    const config = JSON.parse(fs.readFileSync(result.configPath!, 'utf-8'));
    expect(config.model).toBe('kimi-compat/default');
    const providerKey = Object.keys(config.provider)[0];
    expect(config.provider[providerKey].models).toEqual({
      default: { name: 'default' },
    });
  });
});

// ─── Env vars ───

describe('generateRuntimeConfig: env vars', () => {
  it('includes OPENCODE_CONFIG pointing to config path', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    expect(result.env.OPENCODE_CONFIG).toBe(result.configPath);
  });

  it('includes ATH_OC_API_KEY with the raw API key', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'my-secret-key',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    expect(result.env.ATH_OC_API_KEY).toBe('my-secret-key');
  });

  it('includes ATH_OC_BASE_URL when baseUrl provided', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    expect(result.env.ATH_OC_BASE_URL).toBe('https://api.moonshot.cn/v1');
  });

  it('does NOT include ATH_OC_BASE_URL when no baseUrl', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    expect(result.env.ATH_OC_BASE_URL).toBeUndefined();
  });
});

// ─── Config file written to disk ───

describe('generateRuntimeConfig: disk operations', () => {
  it('writes config file to disk', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    expect(fs.existsSync(result.configPath!)).toBe(true);
    const stat = fs.statSync(result.configPath!);
    expect(stat.isFile()).toBe(true);
  });

  it('writes valid JSON', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      models: ['moonshot-v2'],
      defaultModel: 'moonshot-v2',
    });
    const content = fs.readFileSync(result.configPath!, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('uses .ath/oc-config-{invocationId}/opencode.json path', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      models: ['moonshot-v2'],
    }, 'my-inv-42');
    expect(result.configPath).toMatch(/\.ath-test-oc-config\/oc-config-my-inv-42\/opencode\.json$/);
    expect(result.configDir).toMatch(/\.ath-test-oc-config\/oc-config-my-inv-42$/);
  });
});

// ─── cleanupRuntimeConfig ───

describe('cleanupRuntimeConfig', () => {
  it('removes the config directory', () => {
    const result = generate({
      provider: 'kimi',
      apiKey: 'mk-key',
      models: ['moonshot-v2'],
    });
    expect(fs.existsSync(result.configDir!)).toBe(true);
    cleanupRuntimeConfig(result.configDir!);
    expect(fs.existsSync(result.configDir!)).toBe(false);
  });

  it('does not throw on non-existent directory', () => {
    expect(() => cleanupRuntimeConfig('/tmp/nonexistent-dir-xyz-12345')).not.toThrow();
  });
});

// ─── makeInvocationId ───

describe('makeInvocationId', () => {
  it('includes the agentId', () => {
    const id = makeInvocationId('agent-007');
    expect(id).toContain('agent-007');
  });

  it('produces unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(makeInvocationId('agent'));
    }
    // All 100 should be unique
    expect(ids.size).toBe(100);
  });
});
