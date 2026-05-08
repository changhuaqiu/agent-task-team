// src/server/a2a/scanner.ts
import type { AgentMentionConfig, MentionTarget } from './types-v2';

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
        targets.push({ agentId, position: idx, pattern });
      }
    }
  }

  return targets;
}

/**
 * Extract only the content after the @mention, not the full agent output.
 * Takes text from the mention position to the next @mention (if any) or end of text.
 */
export function extractMentionContent(fullText: string, target: MentionTarget): string {
  // Find the mention position in the original text (not code-stripped)
  // Use the position from the stripped text as an approximation —
  // in practice the mention is always outside code blocks anyway
  const stripped = fullText.replace(/```[\s\S]*?```/g, '');
  const mentionStart = target.position;

  // Find the end of the mention pattern itself
  // Scan forward from mentionStart to skip the @mention token
  let contentStart = target.pattern ? mentionStart + target.pattern.length : mentionStart;
  if (!target.pattern) {
    // Skip the @mention pattern (e.g., "@luigi " or "@luigi,")
    while (contentStart < stripped.length && !/[\s\p{P}]/u.test(stripped[contentStart])) {
      contentStart++;
    }
  }
  // Skip the delimiter after the mention
  if (contentStart < stripped.length && /[\s\p{P}]/u.test(stripped[contentStart])) {
    // Skip whitespace and punctuation after mention
    while (contentStart < stripped.length && /[\s]/u.test(stripped[contentStart])) {
      contentStart++;
    }
  }

  // Find end: next @mention or end of text
  const nextMention = stripped.indexOf(' @', contentStart);
  const end = nextMention !== -1 ? nextMention : stripped.length;
  const content = stripped.slice(contentStart, end).trim();

  // If we extracted meaningful content, use it; otherwise fall back to full text
  return content.length > 10 ? content : fullText;
}
