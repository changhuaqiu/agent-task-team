# ACP 运行时统一接入任务

## 基础设施

- [ ] 固定 `@agentclientprotocol/sdk`、Claude ACP 适配器和 Codex ACP 适配器版本。
- [ ] 建立 `src/server/agent/acp/` 公共模块与 mock ACP agent。
- [ ] 实现 stdio transport、连接生命周期和子进程回收。
- [ ] 实现 ACP update → `AgentEvent` 完整映射及未知事件保护。
- [ ] 实现 permission、cancel、timeout、authentication 与 protocol error 处理。
- [ ] 建立声明式 Agent Catalog 和启动探测。

## 三种运行时

- [ ] OpenCode 使用 `opencode acp` 接入并完成真实 smoke test。
- [ ] Claude 使用 `@agentclientprotocol/claude-agent-acp` 接入并完成真实 smoke test。
- [ ] Codex 使用 `@agentclientprotocol/codex-acp` 接入并完成真实 smoke test。
- [ ] 为每种运行时记录版本、认证方式、握手能力和已验证行为。

## 集成与收敛

- [ ] daemon 仅通过内部 `AgentBackend` 调用 `AcpBackend`。
- [ ] ContextManager、A2A、任务派发与 session repository 接入 ACP session/invocation 关联。
- [ ] 三种运行时分别通过新会话、恢复、工具、权限、取消、异常退出和完成事件验收。
- [ ] 删除 `claude.ts`、`opencode.ts`、`codex.ts` 的 bespoke 实现。
- [ ] 删除按 engine 分支的 factory 和手工运行时能力矩阵。
- [ ] 更新架构与 daemon 长期文档。
- [ ] 运行安装、类型检查、构建、单元测试和集成测试。

