# Agent 可观测下钻（Observability Drill-down）

> 状态：active（实现与自动验收已完成，等待用户验收后归档；三项决策见 §13）
> 日期：2026-07-15
> 事实源：本目录
> 基于：`specs/agent-observability/spec.md`（P1 已落地的 span 模型、投影、workbench）——本 spec 只补 P2 级增量，不重复基础模型。
> 关联：`specs/acp-runtime-integration/spec.md`（ACP 是唯一运行时边界）、`docs/technical/execution/platform-harness-state-machine-design.md`（A2A 聚合）、`src/server/agent/acp/acpBackend.ts`（采集缝）、`src/server/repositories/observation-span-repo.ts`、`src/components/project/ProjectObservabilityPanel.tsx`
> 参照：OpenTelemetry GenAI 语义约定（骨架）、Langfuse / LangSmith 的 Session→Trace→Observation 三层 UX、OpenInference 的 AGENT/TOOL/CHAIN kind、Zed ACP（协议边界即遥测源）
> 一句话定位：**在已落地的 span 模型之上，把"喂给模型的完整 prompt / 工具 I/O / 模型回复"采满，并让用户从一条消息卡片下钻到这次调用的全貌、再横向看 agent 间调用链与 task 交互。**

---

## 1. 问题与差距（基于现状代码）

`agent-observability` P1 已经交付：`observation_span`（OTel 形状，带 `trace_id/parent_span_id/kind/invocation_id/chain_id/pass_id`）、`ProjectObservationProjection`、`/api/observability` 与 `ProjectObservabilityPanel`（"调试"页）。但要支撑"agent 框架调试"的三个目标，仍有确定的差距：

| 目标 | 现状 | 差距 |
|---|---|---|
| 单 agent 垂直下钻（看这次调用的 prompt / 工具） | root/context/tool span 已采；tool `input_preview/output_preview` 已存但截断 2000 字符 | **组装后的完整 prompt、system prompt、模型回复文本从不落库**；工具 I/O 前端**完全没渲染**；无消息卡→详情入口 |
| agent 与 agent 调用链路 | span 带 `chain_id/pass_id`；投影从权威 `a2a_pass` 产出 `agentEdges` | 已组装有序调用树；Pass 的 status/reason 直接来自 A2A 聚合，不读取已退役审计表 |
| 链路间 task 交互 | 投影已带 `workflow.tasks/taskEdges` | 前端可观测面板**未渲染任务图**，无"哪些链在某 task 交汇"的视角 |

关键采集事实（已核对）：`acpBackend.ts:193` 处 `promptText = systemPrompt + prompt` 即喂给模型的完整内容，经 `session.prompt`（L525）发出；`response.usage`（L535）带 token；ACP session update（text/thinking/tool_call/tool_call_update/plan）经 `mapTurnUpdate` 转 `AgentEvent`。

## 2. 可行性结论（ACP 视角）

**可行，且 ACP 让采集更简单**：所有 runtime（OpenCode 原生、Claude/Codex 适配器）都收敛到唯一的 `AcpBackend`（见 acp spec 目标架构）。因此 prompt/response 采集只需加在这一个协议边界，天然覆盖三种 runtime，无需按 CLI 分别插桩——这与业界 OpenInference/OpenLLMetry 在 SDK 边界统一插桩一致。

## 3. 设计原则

1. **协议事件流单点采集**：所有 ACP runtime 统一输出 `AgentEvent`。`AcpBackend` 只负责协议映射，不直接依赖数据库；daemon 作为 invocation/root span 的所有者，在调用前采集最终 `systemPrompt + assembled prompt`，在消费统一事件流时采集 response/thinking/tool I/O。这样仍是一处覆盖 OpenCode/Claude/Codex，同时保持 adapter 可替换、可单测。
2. **大 payload 与列表分离**：完整 prompt/response/工具 I/O 存独立表按需懒加载，不进入列表查询、不塞进 2000 字符预览。
3. **脱敏不可绕过**：全量存储前必过 `redactObservationPreview` 的密钥正则（沿用 acp spec §6 与 observability §9）。
4. **不新增第二事实源**：A2A/任务/proof 仍是各自权威，本 spec 只做只读投影与关联。
5. **best-effort**：任何遥测写入失败都不得中断 agent loop。

## 4. 数据模型增量

### 4.1 完整 payload 表（新增）

```sql
CREATE TABLE observation_span_payload (
  span_id     TEXT NOT NULL,
  role        TEXT NOT NULL,   -- system_prompt | assembled_prompt | completion | tool_input | tool_output | thinking
  seq         INTEGER NOT NULL DEFAULT 0,
  content     TEXT NOT NULL,   -- 脱敏后全量文本；不截断到 2000
  byte_size   INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (span_id, role, seq)
);
CREATE INDEX idx_span_payload_span ON observation_span_payload(span_id);
```

- `observation_span.input_preview/output_preview` 保留，用于列表快速预览（2000 字符）。
- 完整内容进 `observation_span_payload`，`/api/observability/span/:id` 懒加载。
- 单条 payload 上限（如 256 KiB）超出则截断并标记 `truncated`。

### 4.2 新增 span kind：`message`

ACP 一次 turn 的连续 text 段合并为一条 `kind=message` 的子 span（parent = root agent span），`output_preview` = 回复摘要，全文进 payload `role=completion`，并带 `usage`（token）。`thinking` **默认采集**（决策 2）进 payload `role=thinking`，不进正文预览；提供 `ATH_OBSERVABILITY_CAPTURE_THINKING=false` 开关可关闭。这里只指 ACP runtime 主动暴露的 thought/reasoning summary，绝不尝试获取隐藏 chain-of-thought；thinking 属敏感内容，与其它 payload 一样过脱敏、总量上限并在 UI 中默认折叠。

### 4.3 消息↔调用精确关联

**采用精确关联（决策 1）**：`chat_message` 增加可空列 `invocation_id`。daemon 持久化 agent 文本消息时写入当前 invocation id，前端消息卡凭此精确定位 trace。历史数据（列为空）回退 `agentId + 时间就近` 模糊匹配并在 UI 标注为估计。

### 4.4 调用链树（投影层，不改表）

`ProjectObservationProjection` 增加 `chains` 视图：按 `chain_id` 把相关 trace 组成有序调用树
（节点=trace/agent turn，边=`a2a_pass`，携带 Pass status/reason），并汇总每条 chain
关联的 `taskId` 集合。OTel span link 语义继续用 `chain_id/pass_id` 表达。

## 5. 采集流（唯一协议缝 = ACP → AgentEvent）

```text
ContextManager 组装 prompt
  -> AcpBackend.execute()   ← 【埋点1】promptText = system + assembled 全量 → payload(system_prompt / assembled_prompt)
     session.prompt
  -> ACP session/update 流
     mapTurnUpdate -> AgentEvent(text/thinking/tool_use/tool_result/plan/done)
  -> 【埋点2】text 段合并 -> message span + payload(completion) + usage
     tool_use/result -> tool span + payload(tool_input/tool_output 全量)
  -> observationSpanRepo（已存在）
  -> projection 关联 Task Graph / A2A / a2a_audit
  -> /api/observability
```

adapter 不接触 `invocationId / traceId / spanId` 或仓储。daemon 持有关联信息并通过 best-effort telemetry sink 完成采集；采集失败只 `console.warn`，不影响 turn。

## 6. 查询契约（增量）

- `GET /api/observability`：新增可选 `agentId`（按角色过滤 traces）、`traceId`、`invocationId`（返回单 trace 全貌）。
- `GET /api/observability/span-payload?conversationId=<id>&spanId=<id>`：懒加载该 span 的完整 payload（system/assembled prompt、completion、tool I/O、thinking）；必须校验 span 属于 conversation，只读、脱敏、无缓存，防止只凭 span id 跨项目读取。
- 投影响应新增 `chains`（§4.4）；`workflow.agentEdges` 保持并补 `auditEvents`。
- 非法参数 `400`；未知项目返回空快照。

## 7. UX 契约（增量，不另起面板）

沿用项目侧栏"调试"页，新增三处能力：

1. **消息卡 → 右侧抽屉**（用户核心诉求）：`ChatMessageItem` 非 human 消息提供入口 → 打开 `AgentObservabilityDrawer`（照抄 `RoleCardDetailDrawer` overlay 骨架）。抽屉按 `invocation_id`（或就近匹配）定位该 turn，展示：
   - Waterfall（span 按开始偏移对齐，非仅按时长画宽）；
   - Span 详情三 tab：**提示词**（system / assembled）｜**工具**（每个 tool_call 的入参/出参全量）｜**模型回复**（completion + token）。
2. **调用链 DAG**：用 `chains` 数据以 ReactFlow + dagre 画 agent 传球链，边标 pass 原因/状态，点节点跳对应 trace 抽屉。替换当前文字 pill。
3. **Task × Chain 视图**：任务节点上叠加"哪些链/agent 在此交汇"。

默认体验仍是聊天与任务流；内部标识符只在"技术标识"折叠区展示。

## 8. 隐私与上限

- 全量 payload 写入前必过密钥脱敏（Bearer/sk-/gh_*/api_key/连接串等）。
- 列表预览维持 2000 字符；payload 单条上限（默认 256 KiB）超出截断并标记。
- 凭据、环境变量、authorization 头、私钥、隐藏推理不落；仅 runtime 主动暴露的 thinking summary 默认采集并可显式关闭。
- span payload 表遵循与 span 相同的保留策略（后续 P2 增加清理）。

## 9. 失败语义

- 遥测写入失败不阻断 turn；trace 可为部分。
- runtime 失败/超时的 root span 记 `error` 与稳定 reason code。
- 缺失的 tool_result 显示为未完成/错误 span，不静默丢弃。
- adapter 缺某类 update（如 plan/thinking）时降级，不输出 `unknown`（沿用 acp spec §5.3）。

## 10. 落地阶段

| 阶段 | 内容 | 目标 |
|---|---|---|
| **P0** | payload 表 + AcpBackend 采 system/assembled prompt & completion & thinking + `chat_message.invocation_id` + span payload API + 消息卡抽屉（提示词/工具/回复三 tab）+ waterfall | 目标1 单 agent 下钻 |
| **P1** | `chains` 调用树投影 + `a2a_audit` 接入 + ReactFlow DAG | 目标2 agent 间链路 |
| **P2** | Task×Chain 视图 + plan span + Socket 推送替 5s 轮询 | 目标3 task 交互 + 体验 |

## 11. 验收标准

- 一次完整 ACP turn：root agent span 下有 context、message span，且 message span 的 completion 全量可经 payload API 取回。
- 抽屉能对一条 agent 消息展示：system+assembled prompt 全文、每个工具调用的入参/出参全文、模型回复与 token。
- prompt/tool/response 全量在写入前已脱敏，超限截断可见标记。
- 调用链 DAG 用显式 `chain_id/pass_id/a2a_audit` 渲染，不解析聊天正文。
- Task×Chain 视图能显示某 task 上交汇的链/agent。
- 现有 execution/A2A/task/observability 测试保持通过；仓储/API/组件/集成/typecheck/build 通过。

## 12. 退出条件

- P0/P1/P2 全部完成并通过验收标准。
- `docs/technical/`（可观测相关）与 `docs/wiki/` 已同步本 spec 的模型与流程。
- 稳定结论回写 `docs/` 后，本 spec 迁入 `docs/archive/specs/`；`agent-observability` 的 P2/P3 迭代路径更新为指向本 spec 的落地结果。

## 13. 已冻结决策（2026-07-15）

1. **精确关联**：P0 直接加 `chat_message.invocation_id`，daemon 落消息时写入；历史空值回退就近匹配。
2. **thinking 默认采集**：默认打开，进 `role=thinking` payload，脱敏+上限；`ATH_OBSERVABILITY_CAPTURE_THINKING=false` 可关。因此 `thinking` span 采集从 P2 提前到 P0。
3. **DAG 组件**：采用 ReactFlow + dagre 渲染调用链。

## 14. Agent turn 完成不变量（Issue #17）

ACP 的 `stopReason=end_turn` 只说明协议 turn 已停止，不等价于“用户已收到答复”。平台层 harness 必须额外保证：

1. 正常 turn 至少产生一段 `agent_message_chunk`，或明确进入失败降级。
2. 若 turn 返回 `end_turn` 但没有任何文本 completion，`AcpBackend` 最多发起一次有界 recovery：已经出现工具事件、或本轮是显式 resume 时继续使用同一 session，只要求补充最终答复；全新会话且零文本、零工具事件时，允许新建一次 replacement session 并重放原始请求，避免把无副作用的 poisoned session 继续传播。
3. recovery 仍无文本时，结果使用稳定原因码 `acp_empty_completion` 标记失败，并向事件流写入一条明确的系统降级文本，禁止“工具执行成功 + invocation succeeded + 用户无消息”的假成功。
4. recovery 复用既有 idle timeout 与 hard max turn timeout，不重置为新的无限循环；同一 invocation 的总恢复次数固定为 1。replacement session 只允许用于尚未产生任何用户可见文本或工具副作用的全新会话，显式 resume 与工具 turn 禁止换 session。
5. `agent.message` span 必须反映最终恢复文本或降级文本；root span 状态与 invocation 终态保持一致。
