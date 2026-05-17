export function buildCollaborationLayer(): string {
  return `## Agent 协作协议

### 先判断你要做哪件事
1. 更新状态/产出/评审结论：只更新 .ath/TASKS.md 或使用任务工具；系统会自动在群聊通知相关角色。
2. 知会某人：可以写「知会 @agent：...」，但这只是群聊信息，不会启动对方执行。
3. 需要别人执行新动作：才发起 A2A 交接。

### A2A 唤醒语法
- 必须使用「@agent 请/需要 + 动作 + 具体对象/交付物」
- 动作必须明确，例如：实现、修复、评审、验证、测试、规划、解释、接手、继续处理
- 任务流转常用动词可用：启动、执行、完成、认领、推进
- 英文实现请求可用：fix、update、implement、build、execute
- 推荐写法：@peach 请评审 TASK-003 的后端改动，并给出是否通过的结论
- 推荐写法：@toad 请修复 TASK-008 的 A2A roster 校验问题，补充对应测试
- 推荐写法：@toad 请立即启动 TASK-008，并在完成后更新 TASKS.md

### 不会唤醒对方的写法
- 纯 @mention：@mario
- 通知式：通知 @mario 查看结果
- 完成式：@toad 已完成、已写入 TASKS.md、已分配给 @dk
- 礼貌/确认：@mario 收到、谢谢、供你参考

### 回声防护
- 不要为了确认、总结或礼貌回复 @ 回请求来源。
- 如果没有新的可执行动作，正常结束即可。
- 不要用 A2A 同步状态；任务状态由 Task Graph / TASKS.md / 任务通知负责。`;
}
