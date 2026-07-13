import type { ChatMessage } from '@/store/types';
import { keywordRelevance, recencyScore } from '../relevance';
import { filterByProjectId } from '../scopeGuard';

const SENDER_LABELS: Record<string, string> = {
  human: '用户',
  system: '系统',
};

const MAX_MESSAGES = 10;
const MAX_CONTENT_LENGTH = 200;
const CANDIDATE_POOL = 30; // GSSC Gather：候选池（大于 MAX_MESSAGES，给 Select 选择空间）
const TAU_SEC = 3600; // 新近性衰减时间常数（1 小时）

export interface HistoryLayerOpts {
  /** Select 的相关性 query（通常为用户当前输入） */
  query?: string;
  /** 选出的条数上限 */
  limit?: number;
  /** 按 project_id 过滤（= conversationId） */
  projectId?: string;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  const tail = max - head - 15;
  return `${text.slice(0, head)}...[截断]...${text.slice(-tail)}`;
}

export function buildHistoryLayer(
  messages: ChatMessage[],
  selfId: string,
  opts?: HistoryLayerOpts,
): string {
  if (messages.length === 0) return '';

  // 按 project_id 过滤（= conversationId）
  const filteredMessages = opts?.projectId
    ? filterByProjectId(messages, opts.projectId)
    : messages;

  if (filteredMessages.length === 0) return '';

  // Gather：候选池（最近 CANDIDATE_POOL 条）
  const candidates = filteredMessages.slice(-CANDIDATE_POOL);

  // Select：有 query + limit 且候选超 limit 时，按相关性+新近性评分选 top-limit
  let selected: ChatMessage[];
  if (opts?.query && opts?.limit && candidates.length > opts.limit) {
    const now = Date.now();
    const scored = candidates.map((m) => ({
      m,
      score:
        0.7 * keywordRelevance(opts.query!, m.content || '') +
        0.3 * recencyScore(new Date(m.timestamp).getTime(), now, TAU_SEC),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = new Set(scored.slice(0, opts.limit).map((s) => s.m));
    selected = candidates.filter((m) => top.has(m)); // 保持原时间顺序
  } else {
    selected = candidates.slice(-MAX_MESSAGES);
  }

  const lines = selected.map((msg) => {
    const time = formatTime(msg.timestamp);
    const sender =
      msg.agentId === selfId ? '你（之前）' : SENDER_LABELS[msg.agentId] ?? msg.agentId;
    const content = truncate(msg.content || '(工具调用)', MAX_CONTENT_LENGTH);
    return `[${time} ${sender}] ${content}`;
  });

  return `[对话历史 - 最近 ${lines.length} 条]\n${lines.join('\n')}\n[/对话历史]`;
}
