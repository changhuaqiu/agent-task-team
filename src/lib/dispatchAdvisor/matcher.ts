import type { CapabilityProfile } from '@/types/capabilityProfile';
import { DOMAIN_KEYWORDS } from '@/types/capabilityProfile';

/** Minimal agent profile for matching — decoupled from RoleCard */
export interface AgentProfile {
  /** Agent ID from roster: mario, luigi, toad, peach, dk, yoshi */
  id: string;
  forbiddenActions: string[];
  capabilities?: CapabilityProfile;
}

export interface RankedMatch {
  agentId: string;
  score: number;
  reason: string;
}

interface TaskInput {
  title: string;
  description: string;
}

const DEFAULT_CAPABILITIES: CapabilityProfile = {
  domains: [],
  skills: [],
  seniority: 'mid',
  maxConcurrentTasks: 1,
};

function extractKeywords(text: string): Set<string> {
  const lower = text.toLowerCase();
  const words = lower.match(/[\w一-鿿]+/g) ?? [];
  return new Set(words);
}

function domainScore(taskKeywords: Set<string>, domains: string[]): number {
  let matched = 0;
  let total = 0;
  for (const domain of domains) {
    const keywords = DOMAIN_KEYWORDS[domain] ?? [];
    if (keywords.length === 0) continue;
    total += keywords.length;
    for (const kw of keywords) {
      if (taskKeywords.has(kw.toLowerCase())) matched++;
    }
  }
  if (total === 0) return 0;
  return matched / total;
}

function skillScore(taskKeywords: Set<string>, skills: string[]): number {
  if (skills.length === 0) return 0;
  let matched = 0;
  for (const skill of skills) {
    if (taskKeywords.has(skill.toLowerCase())) matched++;
  }
  return matched / skills.length;
}

function isForbidden(taskText: string, forbiddenActions: string[]): boolean {
  const lower = taskText.toLowerCase();
  return forbiddenActions.some((action) => lower.includes(action.toLowerCase()));
}

export function matchTaskToAgent(
  task: TaskInput,
  agents: AgentProfile[],
  currentLoad: Record<string, number>,
): RankedMatch[] {
  const taskText = `${task.title} ${task.description}`;
  const taskKeywords = extractKeywords(taskText);

  const results: RankedMatch[] = agents.map((agent) => {
    const caps = agent.capabilities ?? DEFAULT_CAPABILITIES;
    const load = currentLoad[agent.id] ?? 0;

    // Load check: if at max capacity, score is 0
    if (load >= caps.maxConcurrentTasks) {
      return { agentId: agent.id, score: 0, reason: `负载已满 (${load}/${caps.maxConcurrentTasks})` };
    }

    // Forbidden action check
    if (isForbidden(taskText, agent.forbiddenActions)) {
      return { agentId: agent.id, score: 0, reason: `命中禁止项: ${agent.forbiddenActions.find((a) => taskText.toLowerCase().includes(a.toLowerCase()))}` };
    }

    const dScore = domainScore(taskKeywords, caps.domains);
    const sScore = skillScore(taskKeywords, caps.skills);
    const total = dScore * 0.5 + sScore * 0.5;

    const matchedDomains = caps.domains.filter((d) => {
      const kws = DOMAIN_KEYWORDS[d] ?? [];
      return kws.some((kw) => taskKeywords.has(kw.toLowerCase()));
    });
    const matchedSkills = caps.skills.filter((s) => taskKeywords.has(s.toLowerCase()));

    const reasonParts: string[] = [];
    if (matchedDomains.length) reasonParts.push(`领域匹配: ${matchedDomains.join(', ')}`);
    if (matchedSkills.length) reasonParts.push(`技能匹配: ${matchedSkills.join(', ')}`);
    if (!reasonParts.length) reasonParts.push('无精确匹配');

    return {
      agentId: agent.id,
      score: total,
      reason: reasonParts.join(', '),
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results;
}
