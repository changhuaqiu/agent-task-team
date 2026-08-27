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
  if (scenario === 'goal_intake') {
    return '## 本轮场景：目标接收\n确认目标、验收标准、范围和授权；只对真正缺失且不可推断的信息提出最小问题。';
  }
  if (scenario === 'planning') {
    return '## 本轮场景：规划\n基于目标、项目事实、可用 Agent 和现有决策形成可执行计划；不要预先写死 Agent 自己可以在执行时判断的实现细节。';
  }
  if (scenario === 'architecture_review') {
    return '## 本轮场景：架构评审\n检查约束、事实源、模块 seam、失败恢复和验证路径，输出明确结论与证据。';
  }
  if (scenario === 'execution') {
    return '## 本轮场景：执行\n直接推进当前任务；行动结果必须写回 Artifact、Decision、Blocker 或 Evidence，而不是只汇报文字进度。';
  }
  if (scenario === 'code_review') {
    return '## 本轮场景：代码评审\n针对精确变更与验收标准给出 PASS/REJECT，并把问题绑定到可定位的代码或证据。';
  }
  if (scenario === 'verification') {
    return '## 本轮场景：验证\n按验收标准执行测试；涉及产品行为时通过真实浏览器完成 Web UI 端到端验证并记录 Receipt。';
  }
  if (scenario === 'recovery') {
    return '## 本轮场景：恢复\n先确认环境事实是否变化，再选择重试、切换 session、修复环境或升级；禁止在相同上下文上重复空转。';
  }
  if (scenario === 'escalation') {
    return '## 本轮场景：异常升级\n只提交无法继续的事实、已尝试恢复和用户需要做出的一个最小决策。';
  }
  return '';
}
