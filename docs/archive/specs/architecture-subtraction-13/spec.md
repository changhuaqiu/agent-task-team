# Architecture Subtraction — Round 13

> Status: implemented
> Date: 2026-08-15

## Goal

删除 `ATH_TMUX_ENABLED` 驱动的平行厂商 CLI 执行链，让 daemon 的每次 Agent 执行都只能进入 ACP Catalog 与 `AcpBackend`。

## Evidence

- tmux 分支在 ACP backend 构造前直接拼装 OpenCode、Claude、Codex 私有 CLI 参数并 `return`，不是 ACP 的观察 Adapter。
- 该分支绕过 `createAcpBackend()`、统一 AgentEvent、session 完成确认和正常 Invocation 终结路径。
- `TmuxGateway`、`AgentPaneRegistry` 仅由该分支使用，没有其他生产消费者。
- `opencode-prompt-delivery.ts` 仅为该分支构造 legacy `opencode run` 参数，专属测试只验证这条已被 ACP 替代的路径。
- 长期文档把 tmux 描述成“仍经 ACP backend 的可选观察”，与代码直接执行厂商 CLI 的事实冲突。

## Contract

1. 删除 daemon 中 `ATH_TMUX_ENABLED` 初始化、厂商 CLI 参数拼装与 tmux 提前返回分支。
2. 删除 `tmux-gateway.ts`、`agent-pane-registry.ts`、`opencode-prompt-delivery.ts` 及其自嗨测试。
3. session 确认释放、Runtime Event coordinator 和 ACP backend 构造不再受 tmux 条件分支影响。
4. runtime context snapshot 的 transport 收窄为唯一 `acp`。
5. 清理环境变量、架构图、活动 ContextManager 规格与长期文档中的当前态 tmux 契约。
6. 保留 WebUI 的 Runtime/ACP 终端投影；删除的是平行执行链，不是展示能力。

## Exit Criteria

- 生产代码无 `ATH_TMUX_ENABLED`、`ATH_TMUX_PATH`、TmuxGateway、AgentPaneRegistry 或厂商 CLI 参数执行分支。
- daemon 每个已支持 engine 都必须经 ACP Catalog 与 `AcpBackend`。
- context runtime transport 只接受 `acp`。
- 冻结安装、类型、定向测试、全量测试和生产构建完成。
- 独立复审无 Critical/Important。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit`：通过。
- daemon/ACP/session/runtime snapshot/架构门禁定向测试：独立复审运行 4 个文件、79/79 通过；本地扩展门禁复测 10/10 通过。
- `pnpm build`：通过，正式路由保持不变。
- `pnpm test`：1471 通过、2 跳过、1 个既有基线失败；唯一失败为 `src/server/autonomous-delivery/control-runtime.test.ts:131`，与本轮无关。
- 独立复审：Critical 0、Important 0；ACP-only 调用图、session/envelope 终结、WebUI 投影与历史 snapshot 兼容均已复核。
