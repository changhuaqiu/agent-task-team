// src/server/a2a/scanner.ts
import type { AgentMentionConfig, MentionTarget } from './types-v2';

const MAX_TARGETS = 12;

function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

export function scanMentions(
  text: string,
  agents: AgentMentionConfig[],
  selfAgentId: string,
): MentionTarget[] {
  // Strip fenced code blocks
  const stripped = stripCodeBlocks(text);

  // Build sorted pattern list (longest first to prevent prefix collision)
  const patterns: { pattern: string; agentId: string }[] = [];
  for (const agent of agents) {
    for (const p of agent.mentionPatterns) {
      patterns.push({ pattern: p, agentId: agent.id });
    }
  }
  patterns.sort((a, b) => b.pattern.length - a.pattern.length);

  const matches: MentionTarget[] = [];
  const consumedRanges: [number, number][] = []; // [start, end) of matched positions

  // Search entire text for @mentions (not just line start)
  for (const { pattern, agentId } of patterns) {
    if (agentId === selfAgentId) continue;

    // Search for the pattern anywhere in the text (case-insensitive)
    const lower = stripped.toLowerCase();
    const normalizedPattern = pattern.toLowerCase();
    let idx = lower.indexOf(normalizedPattern);
    while (idx !== -1) {
      // Skip if this position is already consumed by a longer match
      const overlaps = consumedRanges.some(([start, end]) => idx >= start && idx < end);
      if (overlaps) {
        idx = lower.indexOf(normalizedPattern, idx + pattern.length);
        continue;
      }

      // Verify token boundary: char before @ is whitespace/start, char after is whitespace/punctuation/EOF
      const prevChar = idx > 0 ? stripped[idx - 1] : undefined;
      const afterEnd = idx + pattern.length;
      const nextChar = stripped[afterEnd];

      const validPrev = prevChar === undefined || /[\s\p{P}]/u.test(prevChar);
      const validNext = nextChar === undefined || /[\s\p{P}]/u.test(nextChar);

      if (validPrev && validNext) {
        consumedRanges.push([idx, afterEnd]);
        matches.push({ agentId, position: idx, pattern });
      }
      idx = lower.indexOf(normalizedPattern, idx + pattern.length);
    }
  }

  return matches.sort((a, b) => a.position - b.position).slice(0, MAX_TARGETS);
}

export function findUnresolvedMentionTokens(
  text: string,
  agents: AgentMentionConfig[],
  selfAgentId: string,
): string[] {
  const stripped = stripCodeBlocks(text);
  const knownPatterns = new Set(
    agents
      .filter((agent) => agent.id !== selfAgentId)
      .flatMap((agent) => agent.mentionPatterns.map((pattern) => pattern.toLowerCase())),
  );
  const selfPatterns = new Set(
    agents
      .filter((agent) => agent.id === selfAgentId)
      .flatMap((agent) => agent.mentionPatterns.map((pattern) => pattern.toLowerCase())),
  );
  const unresolved = new Set<string>();
  const genericPlaceholders = new Set(['@mention', '@agent', '@agents', '@username', '@user']);
  const tokenPattern = /(^|[\s\p{P}])(@[\p{L}\p{N}_-]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(stripped)) !== null) {
    const token = match[2];
    const normalized = token.toLowerCase();
    if (genericPlaceholders.has(normalized)) continue;
    if (knownPatterns.has(normalized) || selfPatterns.has(normalized)) continue;
    unresolved.add(token);
  }
  return Array.from(unresolved).slice(0, MAX_TARGETS);
}

/**
 * Extract only the content after the @mention, not the full agent output.
 * Takes text from the mention position to the next @mention (if any) or end of text.
 */
export function extractMentionContent(fullText: string, target: MentionTarget): string {
  // Find the mention position in the original text (not code-stripped)
  // Use the position from the stripped text as an approximation —
  // in practice the mention is always outside code blocks anyway
  const stripped = stripCodeBlocks(fullText);
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
  const rest = stripped.slice(contentStart);
  const nextMentionMatch = /(^|[\s\p{P}])@[\p{L}\p{N}_-]+/u.exec(rest);
  const end = nextMentionMatch ? contentStart + nextMentionMatch.index : stripped.length;
  const content = stripped.slice(contentStart, end).trim();

  // Keep the result local even when the mention ends the clause. Falling back
  // to the full response lets a roster mention borrow a later action or reject
  // keyword and turns a status projection into a real dispatch.
  return content;
}
