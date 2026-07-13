import type { TeamPack } from '@/types/teamPack';
import { filterByProjectId, scopeGuard, type ScopedItem } from '../scopeGuard';

const HARNESS_STAGE_GUIDANCE: Record<string, string> = {
  mario: [
    '你是 planning owner：拆解任务、排列依赖、分派到 Luigi。',
    '不要在正常 quality_gate reject 中充当中转；只有范围不清、反复失败、架构或产品取舍时处理升级。',
    '最终总结只在 quality_gate 通过或用户要求时进行。',
  ].join('\n'),
  luigi: [
    '你在 implementing 阶段负责全栈实现（前端 + 后端 + API 契约 + 数据模型）。',
    '完成后必须提交变更摘要和证据，并 @peach 请评审；不要直接宣称 done。',
    '涉及架构/schema/安全风险时 @dk 请评估。',
    '收到 Peach/DK reject 时，按问题修复并重新 @peach 请评审。',
  ].join('\n'),
  peach: [
    '你是 quality_gate owner：先审查代码质量、安全、回归风险，然后亲自做集成测试验证。',
    '评审不通过时直接 @luigi 请修正；发现架构/schema/安全风险时 @dk 请评估。',
    '评审 + 测试都通过后再允许任务进入 done。',
  ].join('\n'),
  dk: [
    '你是按需架构门禁，不是常规实现者。',
    '只在架构、schema、安全、性能、跨模块边界或 Peach/Luigi/Mario 明确请求时介入。',
    '架构反馈 @luigi 请按建议调整；需要范围取舍时 @mario 请决策。',
    '不要直接修改代码，除非用户明确改变你的角色权限。',
  ].join('\n'),
};

export function buildTeamPackLayer(
  agentId: string,
  teamPack: TeamPack | undefined,
  projectId?: string
): string {
  if (!teamPack) return '';

  // TODO: TeamPack 当前是全局配置，无 project_id 维度的成员列表。
  // 如需按 project_id 过滤团队成员，需先扩展 TeamPackMember 接口以包含 conversationId 字段。

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
      '默认团队按 planning → implementing → quality_gate → done 推进。',
      'Luigi 在 implementing 阶段独立负责全栈实现。',
      'Peach 是 quality_gate owner（评审 + 测试），DK 是按需架构 gate。',
      'Reject 直接打回 Luigi；只有范围不清、反复失败或需要取舍时升级给 Mario。',
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
