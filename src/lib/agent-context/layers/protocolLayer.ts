interface ProtocolLayerOpts {
  agentId: string;
  agentRole: string;
  hasTaskAssignment: boolean;
}

export function buildProtocolLayer(opts: ProtocolLayerOpts): string {
  const constraints = `## 任务协作协议

### 你的身份
- agentId: ${opts.agentId} | Role: ${opts.agentRole}

### 规则
1. 读取本轮注入的 Task/WorkContract，直接推进已分配且依赖满足的工作。
2. Task/TASKS.md 是只读投影；不得通过编辑看板或任务 mutation 自行推进状态。
3. 完成、评审、阻塞或交接只调用一次对应的结构化生命周期工具，由平台 CommandService 校验 revision 后落账。
4. 工具调用由平台单独显示；正文不复述工具流水，只报告新证据、决策、阻塞和最终结果。
5. @mention 可以路由协作，但不能授予实现权限；只能执行本轮 WorkContract 明确授权的阶段和能力。

### 禁止
- 不修改任务标题、负责人、状态、revision 或无关任务。
- 不在 outcome 被 stale/rejected 后用另一条 mutation 路径绕过 fencing。
- 不跳过 review 或伪造执行/验收证据。`;

  let guidance = '';

  if (opts.hasTaskAssignment) {
    guidance = '\n\n你已被分配任务。直接执行，完成后提交一个结构化 outcome。';
  } else {
    guidance = '\n\n没有明确任务时严格遵守当前 WorkContract 阶段；不要把模糊请求自行升级为实现，也不要自行修改 Task Graph。';
  }

  return constraints + guidance;
}
