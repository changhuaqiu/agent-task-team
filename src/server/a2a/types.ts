// src/server/a2a/types.ts

export interface MentionTarget {
  agentId: string;
  position: number; // char offset in original text
}

export interface A2ADecision {
  deliver: boolean;
  reason?: string; // e.g. 'ping-pong blocked', 'depth exceeded'
}

export interface MailboxEntry {
  id: string;
  conversationId: string;
  fromAgentId: string;
  toAgentId: string;
  triggerMessageId?: string;
  taskId?: string;
  content: string;
  contextSnapshot?: string;
  status: 'pending' | 'delivered' | 'processed' | 'expired';
  chainDepth: number;
  a2aFrom?: string;
  source: 'a2a';
  createdAt: string;
  deliveredAt?: string;
}

export interface ResponseContext {
  conversationId: string;
  taskId?: string;
  triggerMessageId?: string;
  chainDepth: number;
}

export interface AgentMentionConfig {
  id: string;
  mentionPatterns: string[]; // e.g. ['@mario', '@Mario', '@马里奥']
}
