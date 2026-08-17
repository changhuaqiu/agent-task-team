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
    };

function isSystemActivity(message: ChatMessage): boolean {
  return message.intent === 'task_status' || message.agentId === 'system';
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
      items.push({ id: `activity:${message.id}`, kind: 'activity', message });
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
