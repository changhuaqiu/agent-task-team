import type { ChatMessage } from '@/store/types';

const SENDER_LABELS: Record<string, string> = {
  human: '用户',
  system: '系统',
};

const MAX_MESSAGES = 10;
const MAX_CONTENT_LENGTH = 200;

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

export function buildHistoryLayer(messages: ChatMessage[], selfId: string): string {
  if (messages.length === 0) return '';

  const recent = messages.slice(-MAX_MESSAGES);
  const lines = recent.map((msg) => {
    const time = formatTime(msg.timestamp);
    const sender = msg.agentId === selfId
      ? '你（之前）'
      : SENDER_LABELS[msg.agentId] ?? msg.agentId;
    const content = truncate(msg.content || '(工具调用)', MAX_CONTENT_LENGTH);
    return `[${time} ${sender}] ${content}`;
  });

  return `[对话历史 - 最近 ${lines.length} 条]\n${lines.join('\n')}\n[/对话历史]`;
}
