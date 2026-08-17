import type { RoleCard } from '@/types/roleCard';

export function deriveRoleFromCard(roleCard?: RoleCard): string {
  if (!roleCard?.capabilities?.domains?.length) return 'worker';
  return roleCard.capabilities.domains[0];
}

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
3. 完成、评审、阻塞或交接只提交一次结构化 \`agent_submit_outcome\`，由平台校验 revision 后落账。
4. 工具调用由平台单独显示；正文不复述工具流水，只报告新证据、决策、阻塞和最终结果。
5. 自动 wakeup 只处理已存在且负责人/评审者明确的任务；普通 @mention 不会启动执行。

### 禁止
- 不修改任务标题、负责人、状态、revision 或无关任务。
- 不在 outcome 被 stale/rejected 后用另一条 mutation 路径绕过 fencing。
- 不跳过 review 或伪造执行/验收证据。`;

  let guidance = '';

  if (opts.hasTaskAssignment) {
    guidance = '\n\n你已被分配任务。直接执行，完成后提交一个结构化 outcome。';
  } else {
    guidance = '\n\n没有明确任务时按用户指令执行；不要自行修改 Task Graph。';
  }

  return constraints + guidance;
}
