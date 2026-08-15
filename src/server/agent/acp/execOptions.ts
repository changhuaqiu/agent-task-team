import type { EngineId, ExecOptions } from '../types';

interface AcpExecOptionsInput {
  engine: EngineId;
  cwd: string;
  env: Record<string, string>;
  systemPrompt?: string;
  resumeSessionId?: string;
  timeoutMs: number;
}

export function buildAcpExecOptions(input: AcpExecOptionsInput): ExecOptions {
  return {
    cwd: input.cwd,
    systemPrompt: input.engine === 'opencode' ? undefined : input.systemPrompt || undefined,
    resumeSessionId: input.resumeSessionId || undefined,
    timeout: input.timeoutMs > 0 ? input.timeoutMs : undefined,
    env: input.env,
  };
}
