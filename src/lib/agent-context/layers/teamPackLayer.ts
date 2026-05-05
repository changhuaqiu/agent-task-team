import type { TeamPack } from '@/types/teamPack';

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
