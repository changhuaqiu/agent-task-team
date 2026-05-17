import type { TeamPack } from '@/types/teamPack';

const HARNESS_STAGE_GUIDANCE: Record<string, string> = {
  mario: [
    '你是 planning owner：拆解任务、标注 frontend/backend 域、排列依赖、分派到 Luigi/Toad。',
    '不要在正常 review/test reject 中充当中转；只有范围不清、反复失败、架构或产品取舍时处理升级。',
    '最终总结只在 test_gate 通过或用户要求时进行。',
  ].join('\n'),
  luigi: [
    '你在 implementing 阶段负责 frontend lane。',
    '涉及接口、字段、数据契约时 @toad 请确认接口契约，不必绕 Mario。',
    '完成后必须提交变更摘要和证据，并 @peach 请评审；不要直接宣称 done。',
    '收到 Peach/DK/Yoshi reject 时，按问题修复并重新 @peach 请评审 或 @yoshi 请验证。',
  ].join('\n'),
  toad: [
    '你在 implementing 阶段负责 backend lane。',
    '涉及 UI/API 契约时 @luigi 请确认接口字段，不必绕 Mario。',
    '完成后必须提交变更摘要和证据，并 @peach 请评审；不要直接宣称 done。',
    'schema、性能、安全或跨模块风险出现时 @dk 请评估这个架构方案。',
    '收到 DK 架构反馈或 Peach/DK/Yoshi reject 时，按问题修复并重新提交。',
  ].join('\n'),
  peach: [
    '你是 review_gate owner：审查代码质量、安全、测试覆盖和回归风险。',
    '评审不通过时直接 @luigi/@toad 请修正以下问题。',
    '发现架构、schema、安全或跨模块边界问题时 @dk 请评估这个架构方案。',
    '评审通过后 @yoshi 请做集成测试；不要跳过 test_gate。',
  ].join('\n'),
  dk: [
    '你是 review_gate 的按需架构门禁，不是常规实现者。',
    '只在架构、schema、安全、性能、跨模块边界或 Peach/Toad/Mario 明确请求时介入。',
    '架构反馈 @luigi/@toad 请按以下建议调整；需要范围取舍时 @mario 请决策。',
    '不要直接修改代码，除非用户明确改变你的角色权限。',
  ].join('\n'),
  yoshi: [
    '你是 test_gate owner：验证集成行为、规格一致性、回归风险和交付完整性。',
    '测试失败时 @luigi/@toad 请修正以下测试失败项；发现评审遗漏时 @peach 请检查以下遗漏。',
    '发现架构风险时 @dk 请评估以下架构风险；反复失败或需要取舍时 @mario 请决策。',
    'test_gate 通过后再允许任务进入 done。',
  ].join('\n'),
};

export function buildTeamPackLayer(
  agentId: string,
  teamPack: TeamPack | undefined
): string {
  if (!teamPack) return '';

  const parts: string[] = [];

  parts.push(`## 团队：${teamPack.displayName}`);
  parts.push(teamPack.description);

  // Agent's role in the team
  const agentRole = teamPack.roles.find(r => r.id === agentId);
  if (agentRole) {
    parts.push(`### 你在团队中的角色`);
    parts.push(`**${agentRole.displayName}**：${agentRole.description ?? ''}`);
  }

  // Team mode specific instructions
  if (teamPack.teamMode === 'pipeline') {
    parts.push(`### 工作模式：流水线`);
    parts.push(`任务将依次经过所有角色，前一个角色的输出是后一个角色的输入。`);
  } else if (teamPack.teamMode === 'parallel') {
    parts.push(`### 工作模式：并行执行`);
    parts.push(` Coordinator (${teamPack.roles[0]?.displayName}) 将分配任务，其他角色并行工作，所有完成后 Coordinator 汇总。`);
  } else if (teamPack.teamMode === 'hub_spoke') {
    parts.push(`### 工作模式：中心辐射`);
    parts.push(`中心角色可以按需调用周边专家角色。周边专家角色只在被调用时响应。`);
  } else if (teamPack.teamMode === 'custom') {
    parts.push(`### 工作模式：自定义状态机`);
    parts.push(`严格按照 workflow.states 中定义的状态机进行任务流转。`);
  }

  if (teamPack.name === 'default-team') {
    parts.push(`### Workflow Harness`);
    parts.push([
      '默认团队按 planning → implementing → review_gate → test_gate → done 推进。',
      'Luigi/Toad 在 implementing 阶段按 frontend/backend lane 并行执行。',
      'Peach 是 review_gate owner，DK 是按需架构 gate，Yoshi 是 test_gate owner。',
      'Reject 直接打回责任角色；只有范围不清、反复失败或需要取舍时升级给 Mario。',
    ].join('\n'));
    const guidance = HARNESS_STAGE_GUIDANCE[agentId];
    if (guidance) {
      parts.push(`### 你的 Harness 职责`);
      parts.push(guidance);
    }
  }

  // Communication matrix for this agent
  const matrix = teamPack.communicationMatrix[agentId];
  if (matrix) {
    parts.push(`### 沟通规则`);
    if (matrix.canSendTo.length > 0) {
      parts.push(`- 可以发送消息给：${matrix.canSendTo.join('、')}`);
    }
    if (matrix.canReceiveFrom.length > 0) {
      parts.push(`- 可以接收来自以下角色的消息：${matrix.canReceiveFrom.join('、')}`);
    }
    if (matrix.canEscalateTo && matrix.canEscalateTo.length > 0) {
      parts.push(`- 可以升级给：${matrix.canEscalateTo.join('、')}`);
    }
  }

  // Team rules
  if (teamPack.rules) {
    parts.push(`### 团队规则`);
    if (teamPack.rules.maxIterations) {
      parts.push(`- 最大重试次数：${teamPack.rules.maxIterations}`);
    }
    if (teamPack.rules.requireEvidence) {
      parts.push(`- 产出必须附带证据`);
    }
  }

  return parts.join('\n\n');
}
