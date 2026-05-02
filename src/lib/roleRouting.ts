import type { RoleCard } from '@/types/roleCard';

interface AgentLike {
  id: string;
  roleCardId: string;
}

export function suggestAgentForTask(
  title: string,
  description: string,
  roleCards: RoleCard[],
  activeAgents: AgentLike[],
): { agentId: string; reason: string } | null {
  if (!activeAgents.length) return null;

  const text = `${title} ${description}`.toLowerCase();

  const agentScores: { agentId: string; cardId: string; score: number; reason: string }[] = [];

  for (const agent of activeAgents) {
    const card = roleCards.find((c) => c.id === agent.roleCardId);
    if (!card) continue;

    let score = 0;
    const matchedKeywords: string[] = [];

    for (const tag of card.tags) {
      if (text.includes(tag.toLowerCase())) {
        score += 2;
        matchedKeywords.push(tag);
      }
    }

    for (const scenario of card.applicableScenarios) {
      if (text.includes(scenario.toLowerCase())) {
        score += 3;
        matchedKeywords.push(scenario);
      }
    }

    for (const resp of card.responsibilities) {
      if (text.includes(resp.toLowerCase())) {
        score += 1;
      }
    }

    if (score > 0) {
      const topKeywords = [...new Set(matchedKeywords)].slice(0, 2);
      agentScores.push({
        agentId: agent.id,
        cardId: card.id,
        score,
        reason: topKeywords.length
          ? `涉及${topKeywords.join('、')}，推荐由${card.displayName}负责`
          : `推荐由${card.displayName}负责`,
      });
    }
  }

  if (!agentScores.length) return null;

  agentScores.sort((a, b) => b.score - a.score);
  const best = agentScores[0];
  return { agentId: best.agentId, reason: best.reason };
}
