/**
 * Mention Parser — Extract @agent mentions from message text.
 *
 * Pure logic module (no side effects, works in browser and Node.js).
 */

export type RoutingStrategy = 'serial' | 'broadcast';

export interface RoutingDecision {
  strategy: RoutingStrategy;
  /** Agent IDs to invoke, in order of appearance */
  targets: string[];
  /** true if any @mention was found */
  hasExplicitMention: boolean;
}

/** Default agent IDs — always present */
const DEFAULT_AGENT_IDS = ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'];

/** Dynamic agent ID registry (starts with defaults) */
let agentIdRegistry: string[] = [...DEFAULT_AGENT_IDS];

/** Register additional agent IDs (for custom roles) */
export function registerAgentIds(ids: string[]): void {
  const combined = new Set([...DEFAULT_AGENT_IDS, ...ids]);
  agentIdRegistry = [...combined];
}

/** Get current agent IDs (for testing) */
export function getAgentIds(): string[] {
  return [...agentIdRegistry];
}

/** Group mention keywords that resolve to all agents */
const GROUP_KEYWORDS = ['all', '全体', 'team', 'team全体'];

/**
 * Parse @mentions from a message and produce a routing decision.
 *
 * Rules:
 * - `@agent_name` or `@agentId` → route to that specific agent
 * - `@all` / `@全体` → broadcast to all participants
 * - No @mention → broadcast to all participants
 * - Multiple @mentions → serial execution in order of appearance
 *
 * Matching is case-insensitive. Longest match wins (e.g., @zhongli before @zhong).
 */
export function parseMentions(
  message: string,
  participants: string[] = [...agentIdRegistry],
): RoutingDecision {
  // Strip fenced code blocks before parsing (prevents false matches in code)
  const stripped = message.replace(/```[\s\S]*?```/g, '');

  // Find all @mentions (supports word characters + CJK Unified Ideographs)
  const mentionPattern = /@([\w\u4e00-\u9fff]+)/g;
  const rawMentions: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(stripped)) !== null) {
    rawMentions.push(match[1]);
  }

  if (rawMentions.length === 0) {
    // No mentions → broadcast to all participants
    return { strategy: 'broadcast', targets: participants, hasExplicitMention: false };
  }

  // Check for group mentions
  const hasGroupMention = rawMentions.some((m) =>
    GROUP_KEYWORDS.some((kw) => m.toLowerCase() === kw.toLowerCase()),
  );

  if (hasGroupMention) {
    return { strategy: 'broadcast', targets: participants, hasExplicitMention: true };
  }

  // Resolve individual mentions to agentIds.
  // Sort agent IDs by length descending to prevent prefix collisions (zhongli before zhong)
  const sortedAgentIds = [...agentIdRegistry].sort((a, b) => b.length - a.length);

  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawMentions) {
    const lower = raw.toLowerCase();

    // Exact match on agentId
    const exactMatch = sortedAgentIds.find((id) => id.toLowerCase() === lower);
    if (exactMatch && !seen.has(exactMatch)) {
      resolved.push(exactMatch);
      seen.add(exactMatch);
      continue;
    }

    // Match on display name (e.g. "Jean" → "jean")
    const nameMatch = sortedAgentIds.find((id) => {
      const displayName = id.charAt(0).toUpperCase() + id.slice(1);
      return displayName.toLowerCase() === lower;
    });
    if (nameMatch && !seen.has(nameMatch)) {
      resolved.push(nameMatch);
      seen.add(nameMatch);
    }
  }

  if (resolved.length === 0) {
    // Mentions found but none matched known agents → broadcast
    return { strategy: 'broadcast', targets: participants, hasExplicitMention: false };
  }

  return { strategy: 'serial', targets: resolved, hasExplicitMention: true };
}

/**
 * Quick check if a message contains any @mention (for UI highlighting).
 */
export function hasMentions(message: string): boolean {
  const stripped = message.replace(/```[\s\S]*?```/g, '');
  return /@([\w\u4e00-\u9fff]+)/.test(stripped);
}

/**
 * Extract all @mention strings (raw, before resolution) for UI highlighting.
 */
export function extractRawMentions(message: string): string[] {
  const stripped = message.replace(/```[\s\S]*?```/g, '');
  const result: string[] = [];
  const pattern = /@([\w\u4e00-\u9fff]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stripped)) !== null) {
    result.push(match[1]);
  }
  return result;
}
