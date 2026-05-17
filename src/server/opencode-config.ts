import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type AccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

export interface RuntimeConfigInput {
  provider?: AccountProvider;
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  defaultModel?: string;
  systemPrompt?: string;
  skillPaths?: string[];
}

export interface RuntimeConfigResult {
  generated: boolean;
  configPath?: string;
  configDir?: string;
  env: Record<string, string>;
}

const NATIVE_PROVIDERS: AccountProvider[] = ['anthropic', 'openai', 'google'];
const OC_API_KEY_ENV = 'ATH_OC_API_KEY';
const OC_BASE_URL_ENV = 'ATH_OC_BASE_URL';

const NATIVE_NPM_MAP: Record<string, string> = {
  anthropic: '@ai-sdk/anthropic',
  openai: '@ai-sdk/openai',
  google: '@ai-sdk/google',
};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  kimi: 'Kimi (Moonshot)',
  opencode: 'OpenCode',
  other: 'Custom Provider',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google AI',
};

function getDataDir(): string {
  return process.env.ATH_DATA_DIR ?? path.join(process.cwd(), '.ath');
}

export function generateRuntimeConfig(
  invocationId: string,
  input: RuntimeConfigInput,
): RuntimeConfigResult {
  const skillPaths = Array.from(new Set(input.skillPaths ?? [])).filter(Boolean);
  const hasProviderCredentials = !!input.provider && !!input.apiKey;
  const isNative = input.provider ? NATIVE_PROVIDERS.includes(input.provider) : false;
  const needsProviderConfig = hasProviderCredentials && (!isNative || !!input.baseUrl);

  // Generate config if we need provider config, have a system prompt to inject,
  // or need to mount project-local OpenCode skills from an Agent Task Team workdir.
  if (!needsProviderConfig && !input.systemPrompt && skillPaths.length === 0) {
    return { generated: false, env: {} };
  }

  const configDir = path.join(getDataDir(), `oc-config-${invocationId}`);
  const configPath = path.join(configDir, 'opencode.json');

  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
  };

  // Provider config (only for non-native or custom baseUrl)
  if (needsProviderConfig && input.provider && input.apiKey) {
    const providerName = `${input.provider}-compat`;
    const modelsMap: Record<string, { name: string }> = {};
    for (const model of input.models ?? []) {
      modelsMap[model] = { name: model };
    }
    if (Object.keys(modelsMap).length === 0) {
      modelsMap['default'] = { name: 'default' };
    }
    const effectiveModel = input.defaultModel || input.models?.[0] || 'default';

    config.model = `${providerName}/${effectiveModel}`;
    config.provider = {
      [providerName]: {
        ...(isNative ? {} : { name: PROVIDER_DISPLAY_NAMES[input.provider] || 'Custom Provider' }),
        npm: isNative ? NATIVE_NPM_MAP[input.provider] : '@ai-sdk/openai-compatible',
        models: modelsMap,
        options: {
          apiKey: `{env:${OC_API_KEY_ENV}}`,
          ...(input.baseUrl ? { baseURL: `{env:${OC_BASE_URL_ENV}}` } : {}),
        },
      },
    };
  }

  if (skillPaths.length > 0) {
    config.skills = { paths: skillPaths };
    config.permission = {
      skill: {
        '*': 'allow',
      },
    };
  }

  // System prompt as instructions file
  if (input.systemPrompt) {
    const instructionsPath = path.join(configDir, 'system-prompt.md');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(instructionsPath, input.systemPrompt, 'utf-8');
    config.instructions = [instructionsPath];
  }

  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  const env: Record<string, string> = {
    OPENCODE_CONFIG: configPath,
  };
  if (needsProviderConfig && input.apiKey) {
    env[OC_API_KEY_ENV] = input.apiKey;
    if (input.baseUrl) {
      env[OC_BASE_URL_ENV] = input.baseUrl;
    }
  }

  return { generated: true, configPath, configDir, env };
}

export function cleanupRuntimeConfig(configDir: string): void {
  try {
    fs.rmSync(configDir, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
}

export function makeInvocationId(agentId: string): string {
  return `${agentId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}
