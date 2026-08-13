# Agent 可观测下钻任务

> 按依赖顺序维护。基于 `docs/archive/specs/agent-observability/` 已落地的 span/投影/workbench。

## P0 — 单 agent 垂直下钻（prompt / 工具 / 回复）

- [x] 新增迁移与 `observation_span_payload` 表 + `span-payload-repo.ts`（写入前脱敏、按 span 懒加载、单条上限截断标记）。
- [x] daemon telemetry sink 在实际 `backend.execute()` 前落 `system_prompt` / `assembled_prompt` 全量 payload，关联 root span。
- [x] daemon 将连续 text 合并为 `kind=message` 子 span，落 `completion` 与 `usage`；`thinking` 默认采集并可关闭。
- [x] tool span 补写 `tool_input` / `tool_output` payload（保留 2000 字符预览）。
- [x] `chat_message` 增加 `invocation_id`；daemon、socket、store 全链路透传。
- [x] `/api/observability/span-payload?conversationId=&spanId=` scoped 只读端点（无缓存、归属校验、404/400）。
- [x] `/api/observability` 支持 `agentId` / `traceId` / `invocationId` 过滤。
- [x] `ChatMessageItem` 非 human 消息增加下钻入口并携带精确 target。
- [x] `AgentObservabilityDrawer`：精确定位优先、历史回退 + waterfall + 提示词/工具/回复三 tab。
- [x] P0 测试：payload repo/API、采集、消息关联、抽屉组件。

## P1 — agent 间调用链

- [x] `ProjectObservationProjection` 增加 `chains` 有序调用树（chain_id 分组，pass/worklist 为边）。
- [x] 投影直接接入权威 `a2a_pass`（status/reason）；旧 `a2a_audit_log` 与平行 Worklist 已退役。
- [x] 引入 `@xyflow/react` + `@dagrejs/dagre`，新增 DAG 组件；点节点跳 trace 抽屉。
- [x] P1 测试：chains 投影、audit 关联、DAG 交互。

## P2 — task 交互与体验

- [x] Task × Chain 视图（任务节点叠加交汇的链/agent）。
- [x] 采集 `plan` span（thinking 已在 P0 默认开）。
- [x] 可观测面板由 5s 轮询改为 Socket 增量推送。
- [x] P2 测试与回归。

## 收敛

- [x] 同步 `docs/technical/` 与 `docs/wiki/`；更新 `agent-observability` 迭代路径。
- [x] 运行安装、类型检查、构建、单元/集成测试与真实 OpenCode ACP E2E。
- [ ] 用户验收后，将本 spec 迁入 `docs/archive/specs/` 并从 active registry 移除。
