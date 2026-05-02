import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

type AccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

const SAFE_MODEL_RE = /^[\w.\-/]+$/;

const CLI_OK_PATTERNS = [
  /budget/i,
  /exceeded/i,
  /rate.?limit/i,
  /max.?tokens/i,
  /not.?supported/i,
  /invalid_request_error/i,
  /model.*(not|unsupported|unavailable)/i,
  /pong/i,
];

const STDOUT_ERROR_PATTERNS = [
  /^error/i,
  /exception/i,
  /unauthorized/i,
  /authentication/i,
  /forbidden/i,
];

const CLI_PROBE_CMD: Record<string, (model?: string) => string> = {
  claude: (m) => `echo "reply pong" | claude -p${m ? ` --model ${m}` : ''} --max-budget-usd 0.05`,
  codex: (m) => `codex exec${m ? ` --model ${m}` : ''} "reply pong"`,
  gemini: (m) => `gemini -p "reply pong"${m ? ` --model ${m}` : ''}`,
  kimi: (m) => `kimi --print${m ? ` --model ${m}` : ''} --prompt "reply pong"`,
  opencode: (m) => `opencode run${m ? ` --model ${m}` : ''} "reply pong"`,
  other: () => 'echo "ok"',
};

export function buildProbeEnv(
  provider: AccountProvider,
  apiKey: string,
  baseUrl?: string,
): Record<string, string> {
  const env: Record<string, string> = {};

  switch (provider) {
    case 'anthropic':
      env.ANTHROPIC_API_KEY = apiKey;
      if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl.replace(/\/v1\/?$/, '');
      break;
    case 'openai':
      env.OPENAI_API_KEY = apiKey;
      if (baseUrl) {
        env.OPENAI_BASE_URL = baseUrl;
        env.OPENAI_API_BASE = baseUrl;
      }
      break;
    case 'google':
      env.GEMINI_API_KEY = apiKey;
      env.GOOGLE_API_KEY = apiKey;
      env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
      if (baseUrl) env.GEMINI_BASE_URL = baseUrl;
      break;
    case 'kimi':
      env.MOONSHOT_API_KEY = apiKey;
      if (baseUrl) env.CAT_CAFE_KIMI_BASE_URL = baseUrl;
      break;
    case 'opencode':
      env.OPENCODE_API_KEY = apiKey;
      break;
    case 'other':
      env.API_KEY = apiKey;
      if (baseUrl) env.API_BASE_URL = baseUrl;
      break;
  }

  return env;
}

export type ExecFn = (
  cmd: string,
  opts: { timeout: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr?: string }>;

export type CliProbeOptions = {
  model?: string;
  env?: Record<string, string>;
  timeout?: number;
  execFn?: ExecFn;
};

export async function tryCliProbe(
  cliName: string,
  options: CliProbeOptions = {},
): Promise<{ ok: boolean; error?: string; output?: string }> {
  const buildCmd = CLI_PROBE_CMD[cliName];
  if (!buildCmd) return { ok: false, error: `unknown CLI: ${cliName}` };

  if (options.model && !SAFE_MODEL_RE.test(options.model)) {
    return { ok: false, error: `invalid model name: ${options.model}` };
  }

  const cmd = buildCmd(options.model);
  const timeout = options.timeout ?? 30_000;
  const execFn = options.execFn ?? execAsync;

  const execOpts: { timeout: number; env?: NodeJS.ProcessEnv } = { timeout };
  if (options.env && Object.keys(options.env).length > 0) {
    execOpts.env = { ...process.env, ...options.env };
  }

  try {
    const { stdout, stderr } = await execFn(cmd, execOpts);
    const trimmed = stdout.trim();
    const combined = `${trimmed} ${(stderr ?? '').trim()}`.trim();

    if (trimmed.length === 0) {
      return { ok: false, error: `${cliName} CLI 无响应`, output: combined };
    }

    if (CLI_OK_PATTERNS.some((re) => re.test(combined))) {
      return { ok: true, output: combined };
    }

    if (STDOUT_ERROR_PATTERNS.some((re) => re.test(trimmed))) {
      return { ok: false, error: `${cliName} CLI 异常: ${trimmed.slice(0, 80)}`, output: combined };
    }

    return { ok: true, output: combined };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const combined = `${msg} ${stderr}`.trim();

    if (CLI_OK_PATTERNS.some((re) => re.test(msg) || re.test(stderr))) {
      return { ok: true, output: combined };
    }

    if ((err as { code?: number | null }).code === null) {
      return { ok: false, error: `${cliName} CLI 响应超时`, output: combined };
    }

    return { ok: false, error: msg.slice(0, 100), output: combined };
  }
}
