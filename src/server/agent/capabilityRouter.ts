// src/server/agent/capabilityRouter.ts
// stub —— TDD RED 阶段：让测试能 import 并失败（不做任何降级）。

import type { AgentBackend, ExecOptions } from './types';

export interface CapabilityWarning {
  engine: string;
  field: string;
  action: string;
  message: string;
}

export interface CheckResult {
  prompt: string;
  opts: ExecOptions;
  warnings: CapabilityWarning[];
}

export interface CheckDeps {
  /** PTY 可用性检测（注入以便测试）；默认探测真实环境 */
  hasPty?: () => boolean;
}

/** 默认 PTY 检测：Windows 默认无；Unix 检测 `script` 命令（Phase 3 改进）*/
function defaultHasPty(): boolean {
  if (process.platform === 'win32') return false;
  try {
    require('child_process').execSync('which script', { timeout: 2000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function checkCapabilities(
  backend: AgentBackend,
  input: { prompt: string; opts: ExecOptions },
  deps: CheckDeps = {},
): CheckResult {
  const caps = backend.capabilities;
  const opts = { ...input.opts };
  let prompt = input.prompt;
  const warnings: CapabilityWarning[] = [];

  // resume 降级：CLI 不支持 resume 时剔除，开新会话
  if (opts.resumeSessionId && !caps.supportsResume) {
    warnings.push({
      engine: caps.engine,
      field: 'resumeSessionId',
      action: 'dropped',
      message: `${caps.engine} 不支持 resume，已剔除 resumeSessionId，将开新会话`,
    });
    delete opts.resumeSessionId;
  }

  // systemPrompt 降级：CLI 不支持 systemPrompt 时拼进 prompt 头
  if (opts.systemPrompt && !caps.supportsSystemPrompt) {
    prompt = `${opts.systemPrompt}\n\n${prompt}`;
    warnings.push({
      engine: caps.engine,
      field: 'systemPrompt',
      action: 'inlined-into-prompt',
      message: `${caps.engine} 不支持 systemPrompt，已拼进 prompt 头`,
    });
    delete opts.systemPrompt;
  }

  // maxTurns 降级：CLI 不支持 maxTurns 时剔除
  if (opts.maxTurns != null && !caps.supportsMaxTurns) {
    warnings.push({
      engine: caps.engine,
      field: 'maxTurns',
      action: 'dropped',
      message: `${caps.engine} 不支持 maxTurns，已剔除`,
    });
    delete opts.maxTurns;
  }

  // PTY 降级：CLI 需要 PTY 但环境无 → best-effort 警告（不阻断执行）
  if (caps.requiresPty) {
    const hasPty = deps.hasPty ?? defaultHasPty;
    if (!hasPty()) {
      warnings.push({
        engine: caps.engine,
        field: 'requiresPty',
        action: 'best-effort-no-pty',
        message: `${caps.engine} 需要 PTY 但当前环境无，best-effort 执行（输出可能被抑制）`,
      });
    }
  }

  return { prompt, opts, warnings };
}
