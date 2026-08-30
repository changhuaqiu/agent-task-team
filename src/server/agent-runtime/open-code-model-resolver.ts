import { spawnSync } from 'node:child_process';
import { RuntimeSetupError } from './runtime-setup-error';

export interface ResolveOpenCodeModelOptions {
  command?: string;
  runtimeEnv?: Record<string, string>;
  configuredModel?: string;
  modelCatalog?: string[];
  defaultProvider?: string;
}

const DEFAULT_OPENCODE_PROVIDER = 'deepseek';
const MODEL_DISCOVERY_CACHE_MS = 15_000;
const modelDiscoveryCache = new Map<string, { expiresAt: number; models: string[] }>();
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function discoveryEnv(runtimeEnv: Record<string, string>): NodeJS.ProcessEnv {
  const allowed = [
    'APPDATA', 'COMSPEC', 'HOME', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'SYSTEMROOT',
    'TEMP', 'TMP', 'USERPROFILE', 'WINDIR',
  ] as const;
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const key of allowed) {
    const value = process.env[key];
    if (typeof value === 'string') env[key] = value;
  }
  return { ...env, ...runtimeEnv };
}

function discoverOpenCodeModels(
  command: string,
  provider: string,
  runtimeEnv: Record<string, string>,
): string[] {
  const cacheKey = `${command}:${provider}:${runtimeEnv.OPENCODE_CONFIG ?? ''}`;
  const cached = modelDiscoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  if (!/^[a-zA-Z0-9._-]+$/.test(command) || !/^[a-zA-Z0-9._-]+$/.test(provider)) {
    throw new RuntimeSetupError(
      'runtime_model_unavailable',
      'OpenCode 模型目录参数无效。请检查 Agent 的运行配置。',
    );
  }
  const executable = process.platform === 'win32'
    ? process.env.COMSPEC ?? 'cmd.exe'
    : command;
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `${command} --pure models ${provider}`]
    : ['--pure', 'models', provider];
  const result = spawnSync(executable, args, {
    env: discoveryEnv(runtimeEnv),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  const models = result.status === 0
    ? String(result.stdout ?? '')
      .replace(ANSI_ESCAPE, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith(`${provider}/`))
    : [];
  if (models.length > 0) {
    modelDiscoveryCache.set(cacheKey, {
      models,
      expiresAt: Date.now() + MODEL_DISCOVERY_CACHE_MS,
    });
  }
  return models;
}

/** Resolve the text model used by both daemon-generated and ACP fallback configs. */
export function resolveOpenCodeModel(options: ResolveOpenCodeModelOptions = {}): string {
  const command = options.command?.trim() || 'opencode';
  const runtimeEnv = options.runtimeEnv ?? {};
  const configured = options.configuredModel?.trim()
    || process.env.ATH_OPENCODE_FALLBACK_MODEL?.trim();
  const provider = configured?.split('/')[0]
    || options.defaultProvider?.trim()
    || DEFAULT_OPENCODE_PROVIDER;
  const catalog = options.modelCatalog
    ?? discoverOpenCodeModels(command, provider, runtimeEnv);
  const textModels = catalog.filter((model) => (
    model.startsWith(`${provider}/`) && !/(?:vision|image|embedding|audio)/i.test(model)
  ));
  const selected = configured
    ? textModels.find((model) => model === configured)
    : textModels[0];
  if (selected) return selected;
  throw new RuntimeSetupError(
    'runtime_model_unavailable',
    configured
      ? `OpenCode 当前不可用模型：${configured}。请在 Agent 中选择已验证的账号和模型。`
      : `OpenCode 没有检测到可用的 ${provider} 文本模型。请在 Agent 中选择已验证的账号和模型。`,
  );
}
