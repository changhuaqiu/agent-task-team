export function buildCollaborationLayer(): string {
  return `## Agent 协作协议

### 结果提交
- WorkContract 内的任务、Gate、负责人和修订号都是只读权威事实。不要编辑 TASKS.md、任务状态、负责人或 Deliverable 来“同步进度”。
- 完成、评审、阻塞或需要交接时，只调用一次 \`agent_submit_outcome\` 提交结构化候选结果；平台 Process Manager 负责原子更新任务和 Gate。
- stale/rejected outcome 不要原样重试，也不要改用另一条任务 mutation 绕过 fencing；报告阻塞后结束，由平台基于新 contract 决定是否恢复。

### 执行与自动唤醒
- 已分配且依赖满足的工作直接开始执行，不等待额外 @mention；状态由平台接纳 Invocation 后推进。
- reviewer 被明确唤醒时只核验该任务并提交一个 \`record_gate_decision\` outcome，不先修改任务或交付物；payload 使用精确 gateId，decision 只能是 \`passed\`、\`changes_requested\` 或 \`rejected\`。
- 实现者提交 \`submit_task_result\` / \`request_review\` outcome 后立即结束；Task Graph 自动唤醒 quality gate owner。
- 自动 wakeup 只适用于已经建模到 Task Graph、负责人或评审者明确、依赖状态可计算的任务。
- 未建任务、普通聊天 mention 和未解析外部引用不会自动调度。
- 同一种派发或 outcome 失败后不要在本轮循环重试；等待新 contract，或提交 \`report_blocked\` / \`request_human_decision\`。

### 平台能力边界
- CLI 自带的 Task、Agent、SendMessage、TodoWrite/TodoRead 不属于平台 Task Graph 或 A2A。
- runtime-native 子代理只用于当前 Invocation 内的有界调查，不改变任务持有权、Gate 或 A2A pass。
- 需要其他平台角色执行新动作时，通过 \`agent_submit_outcome\` 提交 \`handoff_to_agent\`；payload 的 branches 包含 toAgentId、intent、title、requestedAction，并按需附 evidenceRefs。
- 提交 handoff 后立即结束，不继续替目标角色执行。

### 回声防护
- 正常回复中的 @mention、通知、完成说明和礼貌确认只是可见文本，不会唤醒对方。
- 不为确认、总结或礼貌回复 @ 请求来源；没有新的可执行动作时正常结束。
- 不用 A2A 同步状态；任务状态和下游调度由平台权威事实负责。`;
}
