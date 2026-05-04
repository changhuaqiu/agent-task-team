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
  const consumedRanges: [number, number][] = []; // [start, end) of matched positions

  // Search entire text for @mentions (not just line start)
  for (const { pattern, agentId } of patterns) {
    if (agentId === selfAgentId) continue;
    if (seen.has(agentId)) continue;
    if (targets.length >= MAX_TARGETS) break;

    // Search for the pattern anywhere in the text (case-insensitive)
    const idx = stripped.toLowerCase().indexOf(pattern.toLowerCase());
    if (idx !== -1) {
      // Skip if this position is already consumed by a longer match
      const overlaps = consumedRanges.some(([start, end]) => idx >= start && idx < end);
      if (overlaps) continue;

      // Verify token boundary: char before @ is whitespace/start, char after is whitespace/punctuation/EOF
      const prevChar = idx > 0 ? stripped[idx - 1] : undefined;
      const afterEnd = idx + pattern.length;
      const nextChar = stripped[afterEnd];

      const validPrev = prevChar === undefined || /[\s\p{P}]/u.test(prevChar);
      const validNext = nextChar === undefined || /[\s\p{P}]/u.test(nextChar);

      if (validPrev && validNext) {
        seen.add(agentId);
        consumedRanges.push([idx, afterEnd]);
        targets.push({ agentId, position: idx });
      }
    }
  }

  return targets;
}
