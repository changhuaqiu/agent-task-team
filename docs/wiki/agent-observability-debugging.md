# Agent 可观测调试手册

## 先判断哪一层断了

1. 没有 invocation：检查 dispatch/control plane。
2. 有 invocation、无 root span：检查 daemon telemetry sink；遥测失败不应阻断 agent。
3. 有 root、无 message：检查 ACP 是否产生 text；工具后空 completion 应触发一次 recovery，仍为空时原因码为 `acp_empty_completion`。
4. 有消息但抽屉匹配错误：先查 `chat_message.invocation_id`；只有历史空值才允许 agent + 时间就近回退。
5. 工具名正常但 I/O 为空：检查 adapter 的 `rawInput/rawOutput`；不得从聊天文本猜测或伪造。
6. DAG 缺边：检查 span 的 `chain_id/pass_id` 与权威 `a2a_pass`；不得解析消息正文补边。

## 核心不变量

- ACP adapter 只归一化 `AgentEvent`；daemon 持有 trace/span 与数据库身份。
- `end_turn` 不等于用户已收到答复。
- payload 先脱敏、后限额、再落库；详情 API 必须校验 conversation 归属。
- thinking 只采 runtime 主动暴露的 summary，默认折叠且可关闭。
- 可观测写入失败只产生 partial trace，不得中断 agent loop。

## 常用查询

```text
GET /api/observability?conversationId=<id>&invocationId=<id>
GET /api/observability/span-payload?conversationId=<id>&spanId=<id>
```

调试顺序固定为 invocation → root/message/tool spans → payload → message correlation → projection/UI，避免从 UI 现象反向猜测 runtime 行为。
