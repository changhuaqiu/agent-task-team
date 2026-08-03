# ACP 运行时统一接入任务

## 基础设施

- [x] 固定 `@agentclientprotocol/sdk`、Claude ACP 适配器和 Codex ACP 适配器版本。
- [x] 建立 `src/server/agent/acp/` 公共模块与 mock ACP agent。
- [x] 实现 stdio transport、连接生命周期和子进程回收。
- [x] 实现 ACP update → `AgentEvent` 完整映射及未知事件保护。
- [x] 在单次 turn 内关联 `toolCallId → tool name`，补全无 title 的 result update。
- [x] 实现 permission、cancel、timeout、authentication 与 protocol error 处理。
- [x] 建立声明式 Agent Catalog 和启动探测。

## 三种运行时

- [x] OpenCode 使用 `opencode acp` 接入并完成真实 smoke test。
- [x] Claude 使用 `@agentclientprotocol/claude-agent-acp` 接入并完成真实 smoke test。
- [x] Codex 使用 `@agentclientprotocol/codex-acp` 接入并完成真实 smoke test。
- [x] 为每种运行时记录版本、认证方式、握手能力和已验证行为。

## 集成与收敛

- [x] daemon 仅通过内部 `AgentBackend` 调用 `AcpBackend`。
- [ ] ContextManager、A2A、任务派发与 session repository 接入 ACP session/invocation 关联。
- [ ] 三种运行时分别通过新会话、恢复、工具、权限、取消、异常退出和完成事件验收。
- [x] 删除 `claude.ts`、`opencode.ts`、`codex.ts` 的 bespoke 实现。
- [x] 删除按 engine 分支的 factory 和手工运行时能力矩阵。
- [x] 更新架构与 daemon 长期文档。
- [x] 运行安装、类型检查、构建、单元测试和集成测试。

## 健壮性加固

- [x] Catalog 启动参数精确锁版本并在加载时校验。
- [x] 权限改为显式策略，默认 fail-closed，并覆盖 allow/deny/策略异常。
- [x] 将自主交付 WorkContract 的代码修改授权映射为单次 ACP edit/execute 决策，并记录权限审计事件。
- [x] 执行生命周期统一 finalize，取消采用 ACP cancel → TERM → KILL 的有界清理。
- [x] 增加并发、事件队列、单事件、总输出和 stderr tail 上限。
- [x] OpenCode/Codex 临时配置使用隔离目录、收紧权限并幂等清理。
- [x] daemon shutdown 终止全部在途 run；未实际 resume 时不得自动重放 prompt。
- [x] 增加 spawn 失败、close 缺失、消费者提前退出、输出过载和并发过载测试。
- [x] 增加 Claude 形态的 tool call/update 名称继承测试。
- [x] 将 ACP timeout 改为活动续期的 idle timeout，并增加独立 hard max。
- [x] runtime 原生工具判断改为大小写无关，禁止重复拦截。
- [x] 增加持续活动不触发 idle timeout、真正静默仍超时的测试。
- [x] 合并同一 Invocation 内连续 ACP 文本 chunk，并保留工具事件边界。
