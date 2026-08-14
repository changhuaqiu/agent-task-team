// src/server/agent/cliBridge.ts
// 所有 AgentBackend 启动子进程的唯一入口。
// 封装 cross-spawn：Windows 下自动解析 .cmd / .bat（解决 spawn ENOENT），
// Unix 透传。框架内部禁止直接调 child_process.spawn 启动 CLI。
// 详见 specs/cli-bridge-layer/spec.md。

import spawn from 'cross-spawn';
import type { ChildProcess, SpawnOptions } from 'child_process';
/**
 * 跨平台 spawn CLI。
 *
 * @param command 可执行名（如 'opencode' / 'claude' / 'codex'），无需手动加 .cmd
 * @param args 参数数组
 * @param options 透传给 cross-spawn 的 SpawnOptions（env / cwd / stdio 等）
 * @returns 原生 ChildProcess（与 child_process.spawn 兼容，不破坏事件流）
 */
export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  return spawn(command, args, options);
}
