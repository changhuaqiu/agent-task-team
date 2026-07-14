# CLI 中转层与能力声明（CLI Bridge Layer）

> 归档状态：superseded（2026-07-14）｜替代规格：`specs/acp-runtime-integration/`

> 状态：草案（draft）｜ 关联：`src/server/agent/{claude,opencode,codex,factory,types}.ts`、`src/server/daemon.ts`、`src/server/cli-probe.ts`
> 设计模式：Adapter + Bridge（平台差异 / CLI 差异各自封装，框架内部统一接口）

## 1. 目标

抽一个**统一中转层**，把「平台差异（Win / Mac / Linux）」和「CLI 差异（claude / opencode / codex）」各自封装，框架内部只见统一接口 + 能力声明。顺带解决当前 **Windows spawn ENOENT**（opencode.cmd 找不到）。

## 2. 背景

- **现状短板**：`spawn` 分散在 `claude.ts` / `opencode.ts` / `codex.ts`，各自不处理 Windows `.cmd` → opencode ENOENT；且三 CLI 能力差异大（prompt 模式 / 输出格式 / resume / PTY），但框架没有统一感知
- **现有半成品**：`AgentBackend` 接口（`types.ts`）+ `createBackend`（`factory.ts`）已有，缺底层平台中转 + 能力声明
- **业界方案**：Windows `.cmd` 用 `cross-spawn`（npm/pnpm 同款）；CLI 差异用 Adapter 模式

## 3. 范围

### 3.1 包含
- `CliBridge`：平台中转（cross-spawn，Win .cmd / Unix 透明 / PTY 路由）
- `CapabilitySet`：能力声明类型 + 各 backend 实例
- `AgentBackend.capabilities` 契约（新增 getter）
- `CapabilityRouter`：框架调度前按 opts 需求 vs capabilities 匹配，不满足则降级

### 3.2 不包含（YAGNI / 后续）
- 新增 CLI 适配（只对接现有 3 个）
- CLI 安装器改动（`cli-probe` 探测 Phase 3 并入中转层，但不改安装逻辑）
- 远程 / 容器化 CLI 执行（另议）

## 4. 约束

- 技术栈 TypeScript / Next.js，**不破坏 `AgentBackend.execute()` 接口**
- 唯一新增运行时依赖：`cross-spawn`
- **降级策略 = 忽略 + 警告日志**（graceful），不报错拒绝，保证任务能跑
- Windows `.cmd` / Unix 透明；PTY 路由 Phase 1 先非 PTY，Windows PTY 留 Phase 3
- 遵循 `docs/standards/technical.md`

## 5. 设计

### 5.1 四层架构（关注点分离）
```
框架内部（daemon / orchestrator / context-budget 层）
   │  只认 AgentBackend.execute()，不感知平台/CLI
   ▼
┌─ CapabilityRouter（B 核心，Phase 2）──────────┐
│  按 opts 需求 vs backend.capabilities 匹配     │
│  不满足 → 降级（忽略 + 警告）                   │
└──────────────────────────────────────────────┘
   ▼
┌─ AgentBackend 接口（约束）────────────────────┐
│  execute(prompt, opts) → AgentRun             │
│  readonly capabilities: CapabilitySet   ← 新增│
└──────────────────────────────────────────────┘
   ▼  (claude / opencode / codex 各自实现)
┌─ CLI 适配层（差异在此）───────────────────────┐
│  参数构造、stdin 格式、输出解析                 │
└──────────────────────────────────────────────┘
   │  统一调 spawnCli()
   ▼
┌─ CliBridge（平台中转，Phase 1）───────────────┐
│  spawnCli(cmd, args, opts) → ChildProcess     │
│  Windows .cmd(cross-spawn) / Unix / PTY 路由   │
└──────────────────────────────────────────────┘
```

### 5.2 能力矩阵（三 CLI 实测，作为各 backend 的 CapabilitySet 初值）

| 字段 | claude | opencode | codex |
|---|---|---|---|
| `promptMode` | stdin-stream-json | arg | arg |
| `outputMode` | stream-json | events | ndjson |
| `supportsResume` | ✅ | ❓待测 | ❌ |
| `supportsModel` | ✅ | ✅ | ✅ |
| `supportsSystemPrompt` | ✅ | ✅ | ❌ |
| `systemPromptMode` | flag | file | none |
| `supportsMaxTurns` | ✅ | ❓待测 | ❌ |
| `supportsPermissionMode` | ✅ | ❓ | ✅（固定 --full-auto）|
| `requiresPty` | ❌ | ✅ | ❌ |

### 5.3 核心契约
```ts
interface CapabilitySet {
  engine: 'claude' | 'opencode' | 'codex';
  promptMode: 'stdin-stream-json' | 'arg';
  outputMode: 'stream-json' | 'ndjson' | 'events';
  supportsResume: boolean;
  supportsModel: boolean;
  supportsSystemPrompt: boolean;
  systemPromptMode: 'flag' | 'file' | 'none';
  supportsMaxTurns: boolean;
  supportsPermissionMode: boolean;
  requiresPty: boolean;
}

interface CliBridge {
  spawnCli(cmd: string, args: string[], opts: SpawnOpts): ChildProcess;
}

interface AgentBackend {
  execute(prompt: string, opts: ExecOptions): AgentRun;     // 已有，不变
  readonly capabilities: CapabilitySet;                     // 新增
}
```

### 5.4 降级规则（CapabilityRouter，Phase 2）
| opts 字段 | CLI 不支持时 |
|---|---|
| `resumeSessionId` | 忽略（开新会话）+ 警告 |
| `systemPrompt` | 回退：拼进 prompt 头部 + 警告 |
| `maxTurns` | 忽略 + 警告 |
| `requiresPty` 但环境无 PTY | 警告 + 尝试非 PTY（best-effort） |

所有降级写结构化日志（engine + 字段 + 动作），便于排查。

## 6. 分阶段实现

- **Phase 1（解阻塞）**：`CliBridge`（cross-spawn 平台中转）+ `CapabilitySet` 定义 + 3 backend 声明能力 + spawn 改走 `spawnCli()` → 解决 ENOENT + 平台统一
- **Phase 2**：`CapabilityRouter`（按能力调度 + 降级 + 日志），daemon 调 execute 前过一遍
- **Phase 3**：`cli-probe` 探测并入中转层 + opencode/codex ❓ 能力实测补全 + Windows PTY 方案

## 7. 影响面

- **新增**：`src/server/agent/cliBridge.ts`、`capabilities.ts`（CapabilitySet + 三 backend 值）、`capabilityRouter.ts`（Phase 2）
- **改**：`claude.ts` / `opencode.ts` / `codex.ts`（spawn 改走 cliBridge + 声明 capabilities）、`types.ts`（AgentBackend 加 capabilities getter）、`daemon.ts`（Phase 2 接 Router）
- **依赖**：+ `cross-spawn`、`@types/cross-spawn`
- **测试**：各文件配套 `.test.ts`；Windows + Unix 双平台 spawn 用例
- **文档**：`docs/wiki/01-architecture.md` 加「CLI 中转层」章节

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| cross-spawn 依赖 | npm/pnpm 同款，极稳 |
| opencode/codex 能力 ❓ 待实测 | Phase 3 补；初值保守（不支持），实测后再放开 |
| Windows PTY 复杂（opencode requiresPty） | Phase 1 先非 PTY 跑通；Windows PTY 留 Phase 3（可能用 node-pty 或 winpty）|
| 降级被滥用（任务实际需要 resume 却静默忽略） | 警告日志 + UI 可选提示；关键场景可配 strict 模式（报错）留接口 |
