# 实施任务拆解 — CLI 中转层

> 分 3 phase；Phase 1 解阻塞（ENOENT），可独立交付。每项完成同步更新测试与 `docs/wiki/01-architecture.md`。

## Phase 1：平台中转 + 能力声明（解 ENOENT）

- [ ] T1 `pnpm add cross-spawn @types/cross-spawn`
- [ ] T2 实现 `src/server/agent/cliBridge.ts`：`spawnCli(cmd, args, opts)` 封装 cross-spawn；Windows 自动解析 `.cmd`；Unix 透传 + 单测（Win/Unix 双分支）
- [ ] T3 定义 `src/server/agent/capabilities.ts`：`CapabilitySet` 类型 + `CLAUDE_CAPS` / `OPENCODE_CAPS` / `CODEX_CAPS` 三个常量（按 spec 5.2 矩阵）+ 单测
- [ ] T4 `types.ts`：`AgentBackend` 接口加 `readonly capabilities: CapabilitySet`
- [ ] T5 改 `claude.ts`：`spawn` → `cliBridge.spawnCli`；加 `capabilities` getter 返回 `CLAUDE_CAPS`；既有行为不变
- [ ] T6 改 `codex.ts`：同 T5，返回 `CODEX_CAPS`
- [ ] T7 改 `opencode.ts`：spawn 三分支（go binary / script / fallback）统一经 `spawnCli`；返回 `OPENCODE_CAPS`；保留 go-binary 解析逻辑
- [ ] T8 集成测试：Windows 下 opencode 不再 ENOENT；三 CLI 均能 spawn（mock 或真实调用）

## Phase 2：能力路由 + 降级

- [ ] T9 实现 `src/server/agent/capabilityRouter.ts`：`checkCapabilities(backend, opts) → { opts: normalized, warnings: Warning[] }`
  - [ ] T9.1 resume 不支持 → 剔除 resumeSessionId + 警告
  - [ ] T9.2 systemPrompt 不支持 → 拼进 prompt 头 + 警告
  - [ ] T9.3 maxTurns 不支持 → 剔除 + 警告
  - [ ] T9.4 requiresPty + 环境无 PTY → 警告 + best-effort 非 PTY
- [ ] T10 `daemon.ts`：调 `backend.execute()` 前先过 `checkCapabilities`，写结构化日志（engine / 字段 / 动作）
- [ ] T11 单测：每个降级分支 + 警告内容；不破坏现有 dispatch 流程

## Phase 3：探测并入 + 能力补全 + Windows PTY

- [ ] T12 把 `cli-probe.ts` 的安装/版本探测并入中转层（统一 `CliBridge.probe(engine)`）
- [ ] T13 实测 opencode 的 resume / maxTurns / permissionMode，补全 `OPENCODE_CAPS` 的 ❓
- [ ] T14 实测 codex 是否真无 systemPrompt 降级路径（或是否有等价 flag）
- [ ] T15 Windows PTY 方案调研（node-pty / winpty / conpty），让 opencode 在 Windows 也能走 PTY（如确需）
- [ ] T16 `docs/wiki/01-architecture.md` 完成「CLI 中转层」章节（四层图 + 能力矩阵 + 降级表）
- [ ] T17 全部 checklist 勾选，准备归档
