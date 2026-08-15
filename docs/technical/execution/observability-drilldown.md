# Agent 可观测下钻 — 实施记录

> 状态：implemented，等待用户验收后归档 spec
> 事实源：[`specs/observability-drilldown/spec.md`](../../../specs/observability-drilldown/spec.md)
> 长期架构：[`docs/technical/observability/agent-observability.md`](../observability/agent-observability.md)
> 跟踪缺陷：GitHub Issue #17（ACP 工具调用后空 completion）

## 1. 已冻结的设计

1. 新消息通过 `chat_message.invocation_id` 精确关联 invocation；历史空值才按 agent + 时间就近匹配，并在 UI 标记“历史就近匹配”。
2. thinking 指 runtime 主动暴露的 reasoning summary，按统一脱敏与容量上限采集；当前没有关闭开关，隐藏 chain-of-thought 永不采集。
3. Agent 调用链采用 `@xyflow/react` + `@dagrejs/dagre`，数据只来自 `chain_id`、`pass_id`、worklist 与 A2A audit，不解析聊天正文。
4. `AcpBackend` 只做 ACP → `AgentEvent` 协议归一化；daemon 是 invocation/root span 的所有者，也是唯一 telemetry sink。adapter 不依赖 SQLite 或 observation repository。
5. 遥测始终 best-effort；写入失败不得中断 agent loop。

## 2. 端到端结构

```text
ContextManager / dispatch
  -> daemon 持有 invocation + trace/root span
     -> 在 backend.execute() 前保存 system/assembled prompt payload
     -> AcpBackend: ACP session/update -> AgentEvent
        -> daemon 消费 text/thinking/plan/tool/done
           -> observation_span + observation_span_payload
           -> chat_message.invocation_id
           -> observability:updated socket event
  -> ProjectObservationProjection
     -> traces / chains / Task×Chain / auditEvents
  -> /api/observability + /api/observability/span-payload
  -> 消息卡抽屉 / Waterfall / ReactFlow DAG / 项目调试面板
```

## 3. 数据与安全

- migration 23：`observation_span_payload`，主键 `(span_id, role, seq)`，FK 随 span 级联删除。
- migration 24：`chat_message.invocation_id` 与索引；迁移支持部分迁移后的幂等恢复。
- payload role：`system_prompt`、`assembled_prompt`、`completion`、`tool_input`、`tool_output`、`thinking`。
- 单 role 上限 256 KiB；单 span 总上限 1 MiB；截断写 `truncated=1`。
- 写入前统一经过结构化脱敏；Bearer、API key、token、密码、私钥、连接串不得落库。
- payload API 必须同时携带 `conversationId + spanId`，先校验 span 归属再返回，并设置 `Cache-Control: no-store`。

## 4. 采集与 agent loop 不变量

- prompt：daemon 在实际 `backend.execute(capsResult.prompt, opts)` 前保存最终 system prompt 与 assembled prompt。
- response：连续 text 合并为一个 `kind=message` 子 span，completion/thinking 进入懒加载 payload，usage 写入属性。
- tools：`tool_use/tool_result` 关联同一个 tool span；adapter 未暴露 raw I/O 时保留空 payload，UI 作为协议降级展示，不伪造内容。
- plan：ACP `plan/plan_update/plan_removed` 映射为 `AgentEvent(plan)`，落 `kind=workflow` span。
- 实时性：daemon 在 prompt、tool、turn 终态广播 `observability:updated`，面板不再 5 秒轮询。
- completion invariant：工具执行后 `end_turn` 但没有最终文本时，`AcpBackend` 在同一 session 内最多恢复一次；仍为空则以 `acp_empty_completion` 失败，并产生明确降级文本，禁止静默假成功。

## 5. 查询与投影

- `GET /api/observability?conversationId=&agentId=&traceId=&invocationId=`：支持精确过滤。
- `GET /api/observability/span-payload?conversationId=&spanId=`：按需加载完整脱敏 payload。
- `ProjectObservationProjection` 输出：
  - trace + spans + context + tools + token usage；
  - `chains[].nodes/edges`，边携带 pass/worklist 状态与 audit reason/event；
  - `workflow.agentEdges.auditEvents`；
  - `workflow.taskChains`。
- token usage 同时兼容扁平结构与 provider 嵌套结构，例如 `{default:{inputTokens,outputTokens}}`；有 total token 时避免重复累计。

## 6. 前端

- `ChatMessageItem`：非 human 消息 hover 后可打开“查看这次 Agent 调用”。
- `AgentObservabilityDrawer`：精确 invocation 优先，历史回退；展示按开始偏移对齐的 waterfall，以及提示词 / 工具 / 模型回复三 tab；thinking 默认折叠。
- `AgentChainGraph`：ReactFlow + dagre 布局，节点/边来自显式 chain 事实，节点可打开对应 trace。
- `ProjectObservabilityPanel`：显示指标、DAG、执行记录与 Task×Chain；通过 socket 增量刷新。

## 7. 关键文件

| 层 | 文件 |
| --- | --- |
| 迁移/Schema | `src/server/db/migrate.ts` |
| Payload/脱敏 | `src/server/repositories/span-payload-repo.ts`、`src/server/observability/redaction.ts` |
| 协议/采集 | `src/server/agent/acp/acpBackend.ts`、`src/server/agent/acp/agentEventMapper.ts`、`src/server/daemon.ts` |
| 消息关联 | `src/server/repositories/message-repo.ts`、`src/store/taskHubStore.ts`、`src/store/daemonStore.ts` |
| 投影/API | `src/server/observability/ProjectObservationProjection.ts`、`src/pages/api/observability.ts`、`src/pages/api/observability/span-payload.ts` |
| UI | `src/components/project/AgentObservabilityDrawer.tsx`、`src/components/project/AgentChainGraph.tsx`、`src/components/project/ProjectObservabilityPanel.tsx` |

## 8. 验证记录（2026-07-16）

自动化：

- `npm test -- --run`：115 files / 1010 tests passed。
- `npx tsc --noEmit`：passed。
- `npm run build`：passed。
- 覆盖迁移、payload repo/脱敏/上限、scoped API、消息精确关联、projection、drawer、DAG、plan mapping、thinking payload 与空 completion recovery。

真实 OpenCode ACP E2E：

- conversation：`conv-1784204778968-eeb04cab5f7f3`。
- invocation：`inv-0001784215173745-000064-065205f2`。
- 用户 @Luigi 后实际执行 `read` 并回复 `OBS_TOOL_RECOVERY_OK_20260716`。
- 同一 invocation 下存在 root agent、message、tool 三个 span；消息与 tool message 的 `chat_message.invocation_id` 精确一致。
- payload 包含 assembled prompt、completion、thinking、tool_input/tool_output；该 OpenCode adapter 对 read 只暴露 `{}`/空 raw output，系统按协议降级如实保存。
- scoped API 返回 1 trace / 3 spans / 1 tool call / 321 tokens；项目面板 ReactFlow DAG 与 321-token 执行记录可见。

Claude/Codex 通过同一 `AcpBackend`、mapper 和 daemon sink，相关协议兼容路径由自动化测试覆盖；本轮未伪造三套 runtime 专属采集逻辑。

## 9. 后续边界

本轮不包含外部 OTLP exporter、采样/保留策略、成本与评估反馈、trace replay。它们继续留在 `agent-observability` 后续迭代，不回流到 ACP adapter 内。
