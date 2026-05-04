// src/server/a2a/scanner.ts
import type { AgentMentionConfig, MentionTarget } from './types';

const MAX_TARGETS = 2;

export function scanMentions(
  text: string,
  agents: AgentMentionConfig[],
  selfAgentId: string,
): MentionTarget[] {
  // Strip fenced code blocks
  const stripped = text.replace(/```[\s\S]*?```/g, '');

  // Build sorted pattern list (longest first to prevent prefix collision)
  const patterns: { pattern: string; agentId: string }[] = [];
  for (const agent of agents) {
    for (const p of agent.mentionPatterns) {
      patterns.push({ pattern: p, agentId: agent.id });
    }
  }
  patterns.sort((a, b) => b.pattern.length - a.pattern.length);

  const targets: MentionTarget[] = [];
  const seen = new Set<string>();

  for (const line of stripped.split('\n')) {
    const trimmed = line.trimStart();
    // Only match @mentions at line start (after optional markdown prefix)
    const mdPrefix = trimmed.match(/^(?:[-*>]|\d+\.)\s*/);
    const content = mdPrefix ? trimmed.slice(mdPrefix[0].length) : trimmed;

    for (const { pattern, agentId } of patterns) {
      if (agentId === selfAgentId) continue;
      if (seen.has(agentId)) continue;
      if (targets.length >= MAX_TARGETS) break;

      if (content.toLowerCase().startsWith(pattern.toLowerCase())) {
        // Verify token boundary: next char is whitespace/punctuation/EOF
        const nextChar = content[pattern.length];
        if (nextChar === undefined || /[\s\p{P}]/u.test(nextChar)) {
          seen.add(agentId);
          targets.push({ agentId, position: line.indexOf(pattern) });
          break; // one match per line
        }
      }
    }
    if (targets.length >= MAX_TARGETS) break;
  }

  return targets;
}
