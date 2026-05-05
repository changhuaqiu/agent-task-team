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

  // Workflow
  if (teamPack.workflow.type === 'state_machine' && teamPack.workflow.states) {
    parts.push(`### 团队工作流程`);
    const stateDescriptions = teamPack.workflow.states
      .filter(s => !s.terminal)
      .map(s => `- **${s.name}** (${s.role})：${s.description}`);
    parts.push(stateDescriptions.join('\n'));
  } else if (teamPack.workflow.type === 'linear' && teamPack.workflow.steps) {
    parts.push(`### 团队工作流程`);
    const stepDescriptions = teamPack.workflow.steps
      .map((s, i) => `${i + 1}. **${s.role}**：${s.action} → ${s.output}`);
    parts.push(stepDescriptions.join('\n'));
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
