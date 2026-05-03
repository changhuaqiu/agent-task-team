import { AGENT_ROSTER } from '@/store/taskHubStore';
import type { RoleCard } from '@/types/roleCard';

const ROLE_LABELS: Record<string, string> = {
  planner: '规划',
  frontend: '实现',
  backend: '实现',
  code_reviewer: '评审',
  arch_reviewer: '评审',
  qa: '测试',
};

const COLLABORATION_RULES = `## 协作规则
- 遇到超出职责范围的工作，使用 @mention 交接给对应角色（另起一行行首写 @agentId）
- 关键架构变更、数据库 schema 变更前必须请求用户确认
- 评审意见必须附带具体代码引用和修复方向
- 如果需要其他 agent 协助，在回复中另起一行写 @agentId + 请求内容`;

export function buildTeamLayer(selfId: string, allRoleCards: RoleCard[]): string {
  const entries = AGENT_ROSTER.map((agent) => {
    const rc = allRoleCards.find((c) => c.id === agent.roleCardId);
    return {
      id: agent.id,
      name: agent.name,
      displayName: rc?.displayName ?? agent.roleLabel,
      emoji: agent.emoji,
      roleLabel: rc?.category ? ROLE_LABELS[rc.category] ?? agent.roleLabel : agent.roleLabel,
      strengths: rc?.responsibilities.slice(0, 3) ?? [],
    };
  });

  const teammates = entries.filter((e) => e.id !== selfId);
  if (teammates.length === 0) return '';

  const header = '| @mention | 名字 | 角色 | 擅长 |';
  const sep = '|----------|------|------|------|';
  const rows = teammates.map(
    (t) => `| @${t.id} | ${t.emoji} ${t.name} | ${t.roleLabel} | ${t.strengths.join('、')} |`,
  );

  return `## 团队名册\n\n${header}\n${sep}\n${rows.join('\n')}\n\n${COLLABORATION_RULES}`;
}
