export const MAX_AGENT_MENTION_TARGETS = 3;

export interface AgentMentionCandidate {
  agentId: string;
  handles: string[];
}

export interface AgentMentionRoutingResult {
  hasRoutingMentions: boolean;
  targetAgentIds: string[];
  routedHandles: string[];
  unknownHandles: string[];
  ambiguousHandles: string[];
  overflowHandles: string[];
}

export interface ActiveAgentMention {
  query: string;
  start: number;
  end: number;
}

const HANDLE_CHARACTER_SOURCE = '[\\p{L}\\p{N}\\p{M}_./-]';
const ROUTING_PREFIX = /^\s*(?:(?:>\s*)+)?(?:(?:[-*+]\s+|\d+[.)]\s+))?/u;
const ACTIVE_MENTION_PATTERN = new RegExp(
  `^(?:@${HANDLE_CHARACTER_SOURCE}+\\s+)*@(${HANDLE_CHARACTER_SOURCE}*)$`,
  'u',
);
const UNKNOWN_MENTION_PATTERN = /^@([^\s@,!?;:，。！？；：、）)\]}]+)/u;
const KNOWN_HANDLE_BOUNDARY = /^(?:\s|[,!?;:，。！？；：、）)\]}])/u;
const TRAILING_PUNCTUATION = /[.,!?;:，。！？；：、）)\]}]+$/u;

interface MarkdownFence {
  marker: '`' | '~';
  length: number;
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, '').normalize('NFC').toLowerCase();
}

function lineRoutingPayload(line: string): string {
  return line.slice(line.match(ROUTING_PREFIX)?.[0].length ?? 0);
}

function advanceMarkdownFence(fence: MarkdownFence | null, line: string): MarkdownFence | null {
  const payload = lineRoutingPayload(line);
  if (fence) {
    const closing = payload.match(/^(`+|~+)\s*$/u)?.[1];
    return closing?.[0] === fence.marker && closing.length >= fence.length ? null : fence;
  }
  const opening = payload.match(/^(`{3,}|~{3,})/u)?.[1];
  return opening ? { marker: opening[0] as MarkdownFence['marker'], length: opening.length } : null;
}

function startsMarkdownFence(line: string): boolean {
  return /^(`{3,}|~{3,})/u.test(lineRoutingPayload(line));
}

function extractRoutingHandles(content: string, knownHandles: string[]): string[] {
  const handles: string[] = [];
  let fence: MarkdownFence | null = null;
  const longestHandles = [...new Set(knownHandles.map(normalizeHandle).filter(Boolean))]
    .sort((left, right) => right.length - left.length);

  for (const line of content.split(/\r?\n/)) {
    if (fence || startsMarkdownFence(line)) {
      fence = advanceMarkdownFence(fence, line);
      continue;
    }

    let payload = lineRoutingPayload(line).normalize('NFC').toLowerCase();
    while (payload.startsWith('@')) {
      const knownHandle = longestHandles.find((handle) => {
        const prefix = `@${handle}`;
        if (!payload.startsWith(prefix)) return false;
        const remainder = payload.slice(prefix.length);
        return remainder.length === 0 || KNOWN_HANDLE_BOUNDARY.test(remainder);
      });
      const unknownMatch = knownHandle ? null : payload.match(UNKNOWN_MENTION_PATTERN);
      const handle = knownHandle ?? unknownMatch?.[1];
      if (!handle) break;
      handles.push(handle);
      const remainder = payload.slice(knownHandle ? knownHandle.length + 1 : unknownMatch![0].length);
      const spacing = remainder.match(/^\s+/u)?.[0];
      if (!spacing) break;
      payload = remainder.slice(spacing.length);
    }
  }

  return handles;
}

/**
 * Parses the user-facing @handle routing contract. Only mentions at the start
 * of a line (after optional Markdown quote/list markers) are commands. Inline
 * mentions and fenced examples remain ordinary message content.
 */
export function analyzeAgentMentionRouting(
  content: string,
  candidates: AgentMentionCandidate[],
  maxTargets = MAX_AGENT_MENTION_TARGETS,
): AgentMentionRoutingResult {
  const exactIds = new Map<string, string>();
  const aliases = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    const agentId = candidate.agentId.trim();
    if (!agentId) continue;
    exactIds.set(normalizeHandle(agentId), agentId);
    for (const rawHandle of candidate.handles) {
      const handle = normalizeHandle(rawHandle);
      if (!handle) continue;
      const owners = aliases.get(handle) ?? new Set<string>();
      owners.add(agentId);
      aliases.set(handle, owners);
    }
  }

  const rawHandles = extractRoutingHandles(content, [
    ...exactIds.keys(),
    ...aliases.keys(),
  ]);
  const targetAgentIds: string[] = [];
  const routedHandles: string[] = [];
  const unknownHandles: string[] = [];
  const ambiguousHandles: string[] = [];

  for (const rawHandle of rawHandles) {
    const handles = [
      normalizeHandle(rawHandle),
      normalizeHandle(rawHandle.replace(TRAILING_PUNCTUATION, '')),
    ].filter((handle, index, all) => handle && all.indexOf(handle) === index);
    let owners: Set<string> | undefined;
    let resolvedId: string | undefined;
    for (const handle of handles) {
      const exactId = exactIds.get(handle);
      owners = aliases.get(handle);
      resolvedId = exactId ?? (owners?.size === 1 ? [...owners][0] : undefined);
      if (resolvedId || (owners && owners.size > 1)) break;
    }
    if (!resolvedId) {
      const bucket = owners && owners.size > 1 ? ambiguousHandles : unknownHandles;
      if (!bucket.some((item) => normalizeHandle(item) === normalizeHandle(rawHandle))) bucket.push(rawHandle);
      continue;
    }
    if (!targetAgentIds.includes(resolvedId)) {
      targetAgentIds.push(resolvedId);
      routedHandles.push(rawHandle);
    }
  }

  return {
    hasRoutingMentions: rawHandles.length > 0,
    targetAgentIds: targetAgentIds.slice(0, maxTargets),
    routedHandles: routedHandles.slice(0, maxTargets),
    unknownHandles,
    ambiguousHandles,
    overflowHandles: routedHandles.slice(maxTargets),
  };
}

/** Finds the incomplete line-start mention currently being edited. */
export function findActiveAgentMention(
  content: string,
  cursorPosition: number,
): ActiveAgentMention | null {
  const end = Math.max(0, Math.min(cursorPosition, content.length));
  const lineStart = content.lastIndexOf('\n', end - 1) + 1;
  const lineBeforeCursor = content.slice(lineStart, end);
  let fence: MarkdownFence | null = null;
  for (const line of content.slice(0, lineStart).split(/\r?\n/).slice(0, -1)) {
    fence = advanceMarkdownFence(fence, line);
  }
  if (fence || startsMarkdownFence(lineBeforeCursor)) return null;
  const prefixLength = lineBeforeCursor.match(ROUTING_PREFIX)?.[0].length ?? 0;
  const routingText = lineBeforeCursor.slice(prefixLength);
  const match = routingText.match(ACTIVE_MENTION_PATTERN);
  if (!match) return null;
  const relativeStart = routingText.lastIndexOf('@');
  return {
    query: match[1],
    start: lineStart + prefixLength + relativeStart,
    end,
  };
}
