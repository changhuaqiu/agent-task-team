# ACP 运行时统一接入任务

## 基础设施

- [x] 固定 `@agentclientprotocol/sdk`、Claude ACP 适配器和 Codex ACP 适配器版本。
- [x] 建立 `src/server/agent/acp/` 生产模块与 `src/test-helpers/acp/` mock ACP agent。
- [x] 实现 stdio transport、连接生命周期和子进程回收。
- [x] 实现 ACP update → `AgentEvent` 完整映射及未知事件保护。
- [x] 在单次 turn 内关联 `toolCallId → tool name`，补全无 title 的 result update。
- [x] 实现 permission、cancel、timeout、authentication 与 protocol error 处理。
- [x] 建立声明式 Agent Catalog 和启动探测。

## 三种运行时

- [x] OpenCode 使用 `opencode acp` 接入并完成真实 smoke test。
- [x] Claude 使用 `@agentclientprotocol/claude-agent-acp` 接入并完成真实 smoke test。
- [x] Codex 使用 `@agentclientprotocol/codex-acp` 接入并完成真实 smoke test。

## 统一 Harness Catalog

- [x] 将 Buzz 的内建与预设 ACP Harness 纳入同一发现目录，未安装项保留为候选。
- [x] 只有 OpenCode、Claude、Codex 暴露已真实验证的能力；其他预设在 probe 前保持未验证。
- [x] 支持用户创建、编辑和删除 Custom Harness，并由同一目录驱动 Agent 运行；Catalog 不保存秘密环境值，更新/删除会注销旧运行实例。
- [x] 为每种运行时记录版本、认证方式、握手能力和已验证行为。

## 集成与收敛

- [x] daemon 仅通过内部 `AgentBackend` 调用 `AcpBackend`。
- [ ] ContextManager、A2A、任务派发与 session repository 接入 ACP session/invocation 关联。
- [ ] 三种运行时分别通过新会话、恢复、工具、权限、取消、异常退出和完成事件验收。
- [x] 删除 `claude.ts`、`opencode.ts`、`codex.ts` 的 bespoke 实现。
- [x] 删除按 engine 分支的 factory 和手工运行时能力矩阵。
- [x] 删除单调用者的 `cliBridge` 透传模块，由唯一 `AcpBackend` 直接拥有 `cross-spawn`。
- [x] 更新架构与 daemon 长期文档。
- [x] 运行安装、类型检查、构建、单元测试和集成测试。

## 健壮性加固

- [x] Catalog 启动参数精确锁版本并在加载时校验。
- [x] 权限改为显式策略，默认 fail-closed，并覆盖 allow/deny/策略异常。
- [x] 将自主交付 WorkContract 的代码修改授权映射为单次 ACP edit/execute 决策，并记录权限审计事件。
- [x] 执行生命周期统一 finalize，取消采用 ACP cancel → TERM → KILL 的有界清理。
- [x] 增加并发、事件队列、单事件、总输出和 stderr tail 上限。
- [x] ACP 握手写管道失败时等待子进程 close 或短诊断窗口，把脱敏 stderr tail 与退出码合并进同一个 startup failure。
- [x] OpenCode/Codex 临时配置使用隔离目录、收紧权限并幂等清理。
- [x] daemon shutdown 终止全部在途 run；未实际 resume 时不得自动重放 prompt。
- [x] 增加 spawn 失败、close 缺失、消费者提前退出、输出过载和并发过载测试。
- [x] 增加 Claude 形态的 tool call/update 名称继承测试。
- [x] 将 ACP timeout 改为活动续期的 idle timeout，并增加独立 hard max。
- [x] runtime 原生工具判断改为大小写无关，禁止重复拦截。
- [x] 增加持续活动不触发 idle timeout、真正静默仍超时的测试。
- [x] 合并同一 Invocation 内连续 ACP 文本 chunk，并保留工具事件边界。
- [x] OpenCode 模型改为实时目录解析；Daemon 生成配置与 ACP fallback 共用解析器并显式写入模型，过期模型在 ACP 启动前以稳定错误失败，不再硬编码或继承失效的本机默认模型。
- [x] OpenCode 多 Agent 的冷启动握手经全局闸门串行并错开日志粒度；已建立的 worker 继续并发执行 Turn，消除共享数据库/同名日志启动竞态。
- [x] OpenCode worker 使用 `--pure` 与 invocation-scoped `XDG_CONFIG_HOME` 隔离用户全局插件/MCP，同时保留宿主认证；平台 MCP 只由当前 WorkContract 注入。
- [x] Persistent worker 为映射后的每个 `AgentEvent` 补齐已校验的 ACP Session identity，真实工具/思考事件能推进 Invocation `starting → running`。
- [x] 空 completion 与启动失败只进入 Runtime 状态/诊断，不再合成聊天答案或 Inbox 消息；Project 顶部状态栏展示最近运行失败。

## Managed Runtime 与命令交付（当前重构）

- [x] 实现按 Agent + Project + Runtime Node 分区的 ManagedAgentRuntimeSupervisor foundation；runtime 切换复用同一 owner、generation fencing、订阅就绪门槛、退避与熔断已覆盖测试。
- [x] AgentWorkerPool 已实现 partial readiness、lane affinity、串行保护、stale lease fencing 与 worker replacement；实际 ACP worker 已从 daemon composition root 接线并跨 Invocation 持久化。
- [x] Durable Inbox 在 runtime waking/degraded 时保留事件，具备有界 lane，并只在真实 ACK 后 admission。
- [x] 将 Invocation-scoped MCP grant 安全绑定到 persistent worker turn并在终态撤销；回归证明下一 Session 不继承上一 Invocation 的 MCP server。
- [x] 将首批 Agent 生命周期 MCP 工具接入统一 CommandService 与 CommandReceipt。
- [x] 建立共用 handler 的 `ath` CLI 逃生仓，并让 `project.create` 同时服务 CLI 与 Human API。
- [x] 正常 ACP completion 但没有 accepted outcome 时记录 `ended_without_outcome`，不得推进 Task/Delivery；已接纳 terminal receipt 为对应正例。
- [x] 以本地 Buzz EXE 的真实触发、session、tool command 与 CLI 写回链路复核生产调用图，并在规格中增加“文件存在不等于接线完成”的真实性门禁。
- [x] daemon composition root 创建并长期持有 Supervisor/WorkerPool；健康 ACP transport 跨至少两个 Invocation 复用，per-Invocation 只创建/加载 Session 和签发 grant。
- [ ] 将当前显式提及/授权触发收敛为可持久化的有序 first-match SubscriptionRule；表达式执行必须有长度、并发、超时、连续超时熔断和 fail-closed 上限，并由 Agent Profile/Project 频道投影同一规则事实。
