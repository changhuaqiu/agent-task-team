import type { ChatMessage } from '@/store/taskHubStore';

export type ChatTimelineItem =
  | {
      id: string;
      kind: 'response';
      messages: ChatMessage[];
    }
  | {
      id: string;
      kind: 'activity';
      message: ChatMessage;
      repeatCount: number;
    };

function isSystemActivity(message: ChatMessage): boolean {
  return message.intent === 'task_status' || message.agentId === 'system';
}

function activityCollapseKey(message: ChatMessage): string | undefined {
  if (message.metadata?.commandId || message.metadata?.receiptId || message.metadata?.factType) return undefined;
  const kind = typeof message.metadata?.kind === 'string' ? message.metadata.kind : 'activity';
  const subject = message.referencedTaskId
    ?? (typeof message.metadata?.taskId === 'string' ? message.metadata.taskId : 'project');
  return `${kind}:${subject}:${message.content.trim()}`;
}

function selectInvocationProjection(messages: ChatMessage[]): ChatMessage[] {
  const activeProvisional = messages.find((message) => message.isStreaming === true);
  if (activeProvisional) return [activeProvisional];

  const durableMessages = messages.filter((message) => message.isStreaming === undefined);
  if (durableMessages.length > 0 && durableMessages.length < messages.length) {
    return durableMessages;
  }

  return messages;
}

/**
 * Projects persisted/runtime segments into user-visible timeline entities.
 * An Invocation owns one stable response even when other agents interleave.
 */
export function projectChatTimeline(messages: ChatMessage[]): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = [];
  const responseByInvocation = new Map<string, Extract<ChatTimelineItem, { kind: 'response' }>>();

  for (const message of messages) {
    if (isSystemActivity(message)) {
      const collapseKey = activityCollapseKey(message);
      const previous = items.at(-1);
      const elapsed = previous?.kind === 'activity'
        ? Date.parse(message.timestamp) - Date.parse(previous.message.timestamp)
        : Number.POSITIVE_INFINITY;
      if (
        collapseKey
        && previous?.kind === 'activity'
        && activityCollapseKey(previous.message) === collapseKey
        && Number.isFinite(elapsed)
        && elapsed >= 0
        && elapsed <= 10 * 60 * 1000
      ) {
        previous.message = message;
        previous.repeatCount += 1;
      } else {
        items.push({ id: `activity:${message.id}`, kind: 'activity', message, repeatCount: 1 });
      }
      continue;
    }

    if (!message.invocationId) {
      items.push({ id: `message:${message.id}`, kind: 'response', messages: [message] });
      continue;
    }

    const existing = responseByInvocation.get(message.invocationId);
    if (existing) {
      existing.messages.push(message);
      continue;
    }

    const response = {
      id: `invocation:${message.invocationId}`,
      kind: 'response' as const,
      messages: [message],
    };
    responseByInvocation.set(message.invocationId, response);
    items.push(response);
  }

  return items.map((item) => item.kind === 'response'
    ? { ...item, messages: selectInvocationProjection(item.messages) }
    : item);
}
