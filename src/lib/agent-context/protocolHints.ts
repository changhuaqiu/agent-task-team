import type { ContextRequest } from './ContextManager';
import type { ContextScenario } from './scenarioResolver';

export function buildProtocolHint(
  scenario: ContextScenario,
  wakeup?: ContextRequest['wakeup'],
): string {
  if (scenario === 'handoff') {
    return [
      '## 本轮触发：A2A 交接',
      '接受并推进、说明理由后拒绝，或携带明确 action 转交给更合适角色。',
      '不要只回复“收到”“好的”或反向 @ 上游。',
    ].join('\n');
  }
  if (scenario === 'wakeup') {
    return [
      `## 本轮触发：系统唤醒（${wakeup?.reasonCode || 'unspecified'}）`,
      wakeup?.reasonSummary ? `原因：${wakeup.reasonSummary}` : '',
      '直接推进对应任务，或说明当前阻碍并更新任务状态；不要只做历史总结。',
    ].filter(Boolean).join('\n');
  }
  if (scenario === 'closure') {
    return [
      `## 本轮触发：任务链收敛${wakeup?.rootTaskId ? `（根任务 ${wakeup.rootTaskId}）` : ''}`,
      `子树规模：${wakeup?.subtreeSize ?? 0}；partial：${wakeup?.partial ? 'true' : 'false'}。`,
      '输出 Closure Report，包含 GOAL、DELIVERED、DECISIONS、NOT DONE、NEXT；不要再拆任务或发起新 A2A。',
    ].join('\n');
  }
  return '';
}
