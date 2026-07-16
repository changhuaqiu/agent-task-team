import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db';
import { agentLogCursorRepo } from '../repositories/agent-log-cursor-repo';
import type { MessageRow } from '../repositories/message-repo';
import type { ProofEventRow } from '../repositories/proof-log-repo';
import type { TeamLogCategory, TeamLogEntry, TeamLogEnvelope } from '../../lib/agent-context/teamLog';
import { renderTeamLogEnvelope } from '../../lib/agent-context/teamLog';

const HOT_LIMIT = 50;
const HOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WARM_MAX_AGE_MS = 7 * HOT_MAX_AGE_MS;
const COLD_MAX_AGE_MS = 90 * HOT_MAX_AGE_MS;
const HOT_MAX_BYTES = 5 * 1024;
const BODY_LIMIT = 500;
const SUMMARY_LIMIT = 80;
const ENVELOPE_TOKEN_LIMIT = 150;
const PROJECTED_PROOF_EVENTS = new Set(['autonomy_guard.wakeup', 'chain_closure_dispatched', 'no_valid_exit']);

type SourceRow = {
  source_kind: 'message' | 'proof';
  id: string;
  project_id: string;
  task_id: string | null;
  chain_id: string | null;
  sender_type: string | null;
  sender_id: string | null;
  content: string | null;
  content_type: string | null;
  visibility: string | null;
  mentions: string | null;
  intent: string | null;
  metadata: string | null;
  event_type: string | null;
  agent_id: string | null;
  actor_id: string | null;
  reason_code: string | null;
  created_at: string;
};

function parseJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function truncate(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : `${compact.slice(0, Math.max(0, limit - 1))}…`;
}

export function deriveMessageCategory(row: Pick<MessageRow, 'sender_type' | 'intent' | 'metadata'>): TeamLogCategory {
  const metadata = parseJson(row.metadata);
  if (row.sender_type === 'system') return 'system';
  if (row.intent === 'review') return 'review';
  if (metadata.approval) return 'approval';
  if (metadata.handoffChainId || metadata.chainId) return 'handoff';
  if (row.intent === 'task_status' || row.intent === 'progress') return 'status';
  if (metadata.decisionTag) return 'decision';
  return 'discussion';
}

export function messageToTeamLogEntry(row: MessageRow): TeamLogEntry | undefined {
  if (row.content_type !== 'text' && row.content_type !== 'task_notification') return undefined;
  if (!row.content.trim()) return undefined;
  const metadata = parseJson(row.metadata);
  const mentions = parseStringArray(row.mentions);
  const senderType = row.sender_type === 'human' ? 'user' : row.sender_type === 'system' ? 'system' : 'agent';
  return {
    id: row.id,
    ts: row.created_at,
    projectId: row.conversation_id,
    sender: {
      id: senderType === 'user' ? 'user' : row.sender_id,
      type: senderType,
      label: senderType === 'agent' ? `@${row.sender_id}` : senderType,
    },
    audience: mentions.length > 0 ? mentions : row.visibility === 'private' ? [row.sender_id] : 'all',
    category: deriveMessageCategory(row),
    taskId: row.task_id ?? undefined,
    chainId: typeof metadata.handoffChainId === 'string'
      ? metadata.handoffChainId
      : typeof metadata.chainId === 'string' ? metadata.chainId : undefined,
    summary: truncate(row.content, SUMMARY_LIMIT),
    body: truncate(row.content, BODY_LIMIT),
    refs: {
      taskIds: Array.isArray(metadata.taskIds) ? metadata.taskIds.filter((item): item is string => typeof item === 'string') : undefined,
      artifactPaths: Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths.filter((item): item is string => typeof item === 'string') : undefined,
      decisionTag: typeof metadata.decisionTag === 'string' ? metadata.decisionTag : undefined,
    },
  };
}

export function proofToTeamLogEntry(row: ProofEventRow): TeamLogEntry | undefined {
  if (!row.conversation_id || !PROJECTED_PROOF_EVENTS.has(row.event_type)) return undefined;
  const metadata = parseJson(row.metadata);
  const body = typeof metadata.outcomeSummary === 'string'
    ? `${row.event_type}: ${metadata.outcomeSummary}`
    : `${row.event_type}${row.reason_code ? `: ${row.reason_code}` : ''}`;
  return {
    id: row.id,
    ts: row.created_at,
    projectId: row.conversation_id,
    sender: { id: 'system', type: 'system', label: 'system' },
    audience: row.agent_id ? [row.agent_id] : 'all',
    category: 'system',
    taskId: row.task_id ?? undefined,
    chainId: row.chain_id ?? undefined,
    summary: truncate(body, SUMMARY_LIMIT),
    body: truncate(body, BODY_LIMIT),
  };
}

function sourceRowToEntry(row: SourceRow): TeamLogEntry | undefined {
  if (row.source_kind === 'message') {
    return messageToTeamLogEntry({
      id: row.id,
      conversation_id: row.project_id,
      task_id: row.task_id,
      sender_type: row.sender_type ?? 'system',
      sender_id: row.sender_id ?? 'system',
      content: row.content ?? '',
      content_type: row.content_type ?? 'text',
      mentions: row.mentions,
      intent: row.intent,
      metadata: row.metadata,
      visibility: row.visibility ?? 'public',
      created_at: row.created_at,
    });
  }
  return proofToTeamLogEntry({
    id: row.id,
    event_type: row.event_type ?? '',
    conversation_id: row.project_id,
    task_id: row.task_id,
    chain_id: row.chain_id,
    pass_id: null,
    envelope_id: null,
    node_id: null,
    agent_id: row.agent_id,
    actor_id: row.actor_id,
    reason_code: row.reason_code,
    metadata: row.metadata,
    created_at: row.created_at,
  });
}

function formatEntry(entry: TeamLogEntry): string {
  const time = new Date(entry.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const audience = entry.audience === 'all' ? 'all' : entry.audience.map((id) => `@${id}`).join(',');
  const task = entry.taskId ? ` | ${entry.taskId}` : '';
  return `---\n[${time}] ${entry.sender.label} → ${audience} | [${entry.category}]${task}\n${entry.body}\n<!-- source: ${entry.id} -->`;
}

function renderLog(projectId: string, entries: TeamLogEntry[]): string {
  const lastTs = entries.at(-1)?.ts ?? new Date(0).toISOString();
  return [
    `<!-- team-log | project: ${projectId} | updated: ${lastTs} | window: ${entries.length} entries -->`,
    '<!-- read-only projection; grep by TASK-xxx, @agentId or [category] -->',
    '',
    ...entries.map(formatEntry),
    '',
  ].join('\n');
}

export class TeamLogProjectionService {
  private readonly workspaces = new Map<string, Set<string>>();

  append(entry: TeamLogEntry): void {
    for (const workspaceDir of this.workspaces.get(entry.projectId) ?? []) {
      try {
        this.materialize(entry.projectId, workspaceDir);
      } catch (error) {
        console.warn(`[team-log] append projection failed for ${workspaceDir}:`, error);
      }
    }
  }

  materializeRegistered(projectId: string): void {
    for (const workspaceDir of [...(this.workspaces.get(projectId) ?? [])]) {
      this.materialize(projectId, workspaceDir);
    }
  }

  materialize(projectId: string, workspaceDir: string, now = new Date()): void {
    const resolved = path.resolve(workspaceDir);
    const registered = this.workspaces.get(projectId) ?? new Set<string>();
    registered.add(resolved);
    this.workspaces.set(projectId, registered);

    const athDir = path.join(resolved, '.ath');
    const archiveDir = path.join(athDir, 'team-log-archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const entries = this.listEntries(projectId, new Date(now.getTime() - COLD_MAX_AGE_MS).toISOString());
    const hotCutoff = now.getTime() - HOT_MAX_AGE_MS;
    const warmCutoff = now.getTime() - WARM_MAX_AGE_MS;
    const hotCandidates = entries.filter((entry) => new Date(entry.ts).getTime() >= hotCutoff).slice(-HOT_LIMIT);
    const hot: TeamLogEntry[] = [];
    for (const entry of [...hotCandidates].reverse()) {
      if (Buffer.byteLength(renderLog(projectId, [entry, ...hot]), 'utf8') > HOT_MAX_BYTES) break;
      hot.unshift(entry);
    }
    fs.writeFileSync(path.join(athDir, 'team-log.md'), renderLog(projectId, hot), 'utf8');

    const hotIds = new Set(hot.map((entry) => entry.id));
    const warm = entries.filter((entry) => {
      const ts = new Date(entry.ts).getTime();
      return ts >= warmCutoff && !hotIds.has(entry.id);
    });
    const byDay = new Map<string, TeamLogEntry[]>();
    for (const entry of warm) {
      const day = entry.ts.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), entry]);
    }
    const retainedWarmDays = new Set([...byDay.keys()].sort((a, b) => b.localeCompare(a)).slice(0, 7));
    for (const day of [...byDay.keys()]) {
      if (!retainedWarmDays.has(day)) byDay.delete(day);
    }
    for (const file of fs.readdirSync(archiveDir)) {
      if (/^\d{4}-\d{2}-\d{2}\.md$/.test(file) && !byDay.has(file.slice(0, 10))) {
        fs.rmSync(path.join(archiveDir, file));
      }
    }
    for (const [day, dayEntries] of byDay) {
      fs.writeFileSync(path.join(archiveDir, `${day}.md`), renderLog(projectId, dayEntries), 'utf8');
    }

    const warmIds = new Set([...byDay.values()].flat().map((entry) => entry.id));
    const cold = entries.filter((entry) => !hotIds.has(entry.id) && !warmIds.has(entry.id));
    const coldByDay = new Map<string, TeamLogEntry[]>();
    for (const entry of cold) {
      const day = entry.ts.slice(0, 10);
      coldByDay.set(day, [...(coldByDay.get(day) ?? []), entry]);
    }
    const indexLines = ['# Team Log Archive Index', ''];
    for (const [day, dayEntries] of [...coldByDay.entries()].sort(([a], [b]) => b.localeCompare(a))) {
      const important = dayEntries.filter((entry) => entry.category === 'decision' || entry.category === 'review');
      const tasks = [...new Set(dayEntries.map((entry) => entry.taskId).filter(Boolean))];
      indexLines.push(`- ${day}: ${important.map((entry) => entry.summary).slice(0, 3).join('；') || `${dayEntries.length} 条事件`}${tasks.length ? ` | ${tasks.join(', ')}` : ''}`);
    }
    fs.writeFileSync(path.join(archiveDir, 'INDEX.md'), `${indexLines.join('\n')}\n`, 'utf8');
  }

  buildEnvelope(projectId: string, agentId: string, options?: { taskId?: string }): TeamLogEnvelope {
    const cursor = agentLogCursorRepo.get(projectId, agentId);
    const cursorPoint = cursor ? this.findCursorPoint(cursor.last_consumed_id) : undefined;
    const entries = this.listEntries(projectId, undefined, cursorPoint)
      .filter((entry) => entry.sender.id !== agentId)
      .filter((entry) => entry.audience === 'all' || entry.audience.includes(agentId))
      .filter((entry) => !options?.taskId || entry.taskId === options.taskId || entry.refs?.taskIds?.includes(options.taskId));
    const candidates = [...entries.slice(-5)].reverse();
    const selected: TeamLogEnvelope['entries'] = [];
    for (const entry of candidates) {
      const candidate = {
        sender: entry.sender.label,
        category: entry.category,
        taskRef: entry.taskId,
        summary: truncate(entry.summary, SUMMARY_LIMIT),
      };
      const rendered = renderTeamLogEnvelope({
        unseenCount: entries.length,
        entries: [candidate, ...selected],
        filePath: '.ath/team-log.md',
        totalTokens: 0,
      });
      if (Math.ceil(rendered.length / 4) > ENVELOPE_TOKEN_LIMIT) break;
      selected.unshift(candidate);
    }
    const envelope: TeamLogEnvelope = {
      unseenCount: entries.length,
      entries: selected,
      filePath: '.ath/team-log.md',
      totalTokens: 0,
      upToEntryId: entries.at(-1)?.id,
    };
    envelope.totalTokens = Math.ceil(renderTeamLogEnvelope(envelope).length / 4);
    return envelope;
  }

  markConsumed(projectId: string, agentId: string, upToEntryId: string): void {
    const next = this.findCursorPoint(upToEntryId);
    if (!next) return;
    const current = agentLogCursorRepo.get(projectId, agentId);
    const currentPoint = current ? this.findCursorPoint(current.last_consumed_id) : undefined;
    if (
      currentPoint
      && (currentPoint.createdAt > next.createdAt
        || (currentPoint.createdAt === next.createdAt && currentPoint.id >= next.id))
    ) return;
    agentLogCursorRepo.upsert(projectId, agentId, upToEntryId);
  }

  private findCursorPoint(id: string): { createdAt: string; id: string } | undefined {
    const row = getDb().prepare(`
      SELECT id, created_at FROM chat_message WHERE id = ?
      UNION ALL
      SELECT id, created_at FROM control_proof_event WHERE id = ?
      LIMIT 1
    `).get(id, id) as { id: string; created_at: string } | undefined;
    return row ? { createdAt: row.created_at, id: row.id } : undefined;
  }

  private listEntries(
    projectId: string,
    since?: string,
    after?: { createdAt: string; id: string },
  ): TeamLogEntry[] {
    const rows = getDb().prepare(`
      SELECT 'message' AS source_kind, id, conversation_id AS project_id, task_id, NULL AS chain_id,
        sender_type, sender_id, content, content_type, visibility, mentions, intent, metadata,
        NULL AS event_type, NULL AS agent_id, NULL AS actor_id, NULL AS reason_code, created_at
      FROM chat_message WHERE conversation_id = ?
      UNION ALL
      SELECT 'proof' AS source_kind, id, conversation_id AS project_id, task_id, chain_id,
        NULL AS sender_type, NULL AS sender_id, NULL AS content, NULL AS content_type, NULL AS visibility,
        NULL AS mentions, NULL AS intent, metadata, event_type, agent_id, actor_id, reason_code, created_at
      FROM control_proof_event WHERE conversation_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(projectId, projectId) as SourceRow[];
    return rows
      .filter((row) => !since || row.created_at >= since)
      .filter((row) => !after || row.created_at > after.createdAt || (row.created_at === after.createdAt && row.id > after.id))
      .map(sourceRowToEntry)
      .filter((entry): entry is TeamLogEntry => Boolean(entry));
  }
}

export const teamLogProjection = new TeamLogProjectionService();
