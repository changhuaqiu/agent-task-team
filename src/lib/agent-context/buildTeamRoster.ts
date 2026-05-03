import { AGENT_ROSTER } from '@/store/taskHubStore';
import type { RoleCard } from '@/types/roleCard';

const ROLE_LABELS: Record<string, string> = {
  planner: '规划',
  worker: '实现',
  reviewer: '评审',
};

interface RosterEntry {
  id: string;
  name: string;
  displayName: string;
  emoji: string;
  roleLabel: string;
  strengths: string[];
}

function getRosterEntries(roleCards: RoleCard[]): RosterEntry[] {
  return AGENT_ROSTER.map((agent) => {
    const rc = roleCards.find((c) => c.id === agent.roleCardId);
    return {
      id: agent.id,
      name: agent.name,
      displayName: rc?.displayName ?? agent.roleLabel,
      emoji: agent.emoji,
      roleLabel: rc?.category ? ROLE_LABELS[rc.category] ?? agent.roleLabel : agent.roleLabel,
      strengths: rc?.responsibilities.slice(0, 3) ?? [],
    };
  });
}

export function buildTeamRoster(selfId: string, roleCards: RoleCard[]): string {
  const entries = getRosterEntries(roleCards);
  const teammates = entries.filter((e) => e.id !== selfId);

  if (teammates.length === 0) return '';

  const header = '| @mention | 名字 | 角色 | 擅长 |';
  const sep =     '|----------|------|------|------|';
  const rows = teammates.map(
    (t) => `| @${t.id} | ${t.emoji} ${t.name} | ${t.roleLabel} | ${t.strengths.join('、')} |`,
  );

  return `## 团队名册\n\n${header}\n${sep}\n${rows.join('\n')}`;
}
