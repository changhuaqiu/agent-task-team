# Agent 可观测下钻验收清单

## 采集完整性

- [x] 一次完整 ACP turn：root agent span 下存在 message/tool 子 span；context span 在上下文组装启用时存在。
- [x] system prompt（存在时）与组装后 prompt 可经 payload API 取回。
- [x] 模型回复（completion）全量可取回，并带 token usage。
- [x] 每个 tool_call 的可用入参与出参可取回，call id 与工具名一致；adapter 缺 raw I/O 时如实降级为空。
- [x] OpenCode / Claude / Codex 共用 ACP → AgentEvent → daemon telemetry sink，无 runtime 专属采集分支。
- [x] 遥测写入失败只告警，不中断 agent turn。

## 单 agent 下钻（目标 1）

- [x] 点击一条 agent 消息卡可打开右侧抽屉。
- [x] 抽屉按 invocation_id 精确定位；历史空值回退并标注。
- [x] 抽屉展示 waterfall、提示词/工具/回复三 tab，内容为脱敏后 payload。
- [x] 抽屉可关闭且不影响聊天与任务流。

## agent 间链路（目标 2）

- [x] 调用链 DAG 基于显式 `chain_id/pass_id/a2a_audit` 渲染，不解析聊天正文。
- [x] DAG 边显示传球原因/状态；点节点可跳转对应 trace 抽屉。

## task 交互（目标 3）

- [x] Task × Chain 视图显示某 task 上交汇的链/agent。

## 隐私与上限

- [x] payload 写入前完成密钥脱敏（Bearer/sk-/gh_*/api_key/连接串）。
- [x] 超过上限的 payload 被截断并带可见标记。
- [x] 凭据、authorization 头、私钥不以明文出现在 payload。
- [x] runtime 主动暴露的 thinking summary 进入脱敏、限额 payload 且 UI 默认折叠；当前没有 capture opt-out。

## 验证与文档

- [x] 仓储、payload API、采集、抽屉/DAG 组件测试通过。
- [x] 现有 execution / A2A / task / observability 测试保持通过。
- [x] 类型检查与生产构建通过。
- [x] `docs/technical/` 与 `docs/wiki/` 已同步；`agent-observability` 迭代路径已更新。

## Phoenix 外部投影（P3）

- [x] 未配置 `PHOENIX_COLLECTOR_ENDPOINT` 时没有 Phoenix handler 和网络请求。
- [x] 一次终态 Invocation 在 Phoenix 中形成一个 `AGENT` root、`LLM` message 与 `TOOL` children。
- [x] Phoenix Project 固定为应用，Conversation 映射为 Session；task/agent/work/chain/pass 可过滤。
- [x] durable replay 复用确定性外部 trace/span id，不生成重复 Trace。
- [x] 默认不导出全量内容；开启 redacted 模式后 prompt/tool/reply 可见且敏感值已脱敏。
- [x] thinking/隐藏推理、credential、环境变量与任意未知 attributes 不进入 Phoenix。
- [x] Phoenix 停止或超时只产生可重试 delivery，不影响本地 Invocation/Task/Outcome 状态。
- [x] 本地 `http://127.0.0.1:6006` 真实验收可看到 `agent-task-team` 项目和至少一条 Trace。
