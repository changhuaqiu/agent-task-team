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
  const durableMessages = messages.filter((message) => message.isStreaming === undefined);
  const durableNarrative = durableMessages.map((message) => message.content).join('');

  if (activeProvisional) {
    // During an active Invocation, the live row contains the latest aggregate
    // text while durable rows may only be earlier segments flushed before a
    // tool call. Use durable narrative only when the live row is empty; a
    // correlated terminal event settles the live row before final projection.
    if (
      activeProvisional.content.trim().length === 0
      && durableNarrative.trim().length > 0
    ) {
      return activeProvisional.toolEvents?.length
        ? [...durableMessages, activeProvisional]
        : durableMessages;
    }
    return [activeProvisional];
  }

  const completedProvisional = [...messages].reverse().find((message) => (
    message.isStreaming === false
  ));
  if (completedProvisional?.content.trim().length) {
    if (durableNarrative === completedProvisional.content) {
      return completedProvisional.toolEvents?.length
        ? [...durableMessages, { ...completedProvisional, content: '' }]
        : durableMessages;
    }
    return [
      ...durableMessages.filter((message) => message.content.trim().length === 0),
      completedProvisional,
    ];
  }
  if (completedProvisional?.toolEvents?.length) {
    return [...durableMessages, completedProvisional];
  }

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
