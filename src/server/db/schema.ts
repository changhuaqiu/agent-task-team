import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// ──────────────────────────────────────────────
// conversation
// ──────────────────────────────────────────────
export const conversation = sqliteTable('conversation', {
  id: text('id').primaryKey(),
  title: text('title'),
  goal: text('goal'),
  status: text('status'),
  priority: text('priority'),
  projectPath: text('project_path'),
  participants: text('participants'), // JSON text
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ──────────────────────────────────────────────
// task
// ──────────────────────────────────────────────
export const task = sqliteTable('task', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversation.id),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  agentId: text('agent_id').notNull(),
  dependencies: text('dependencies'), // JSON text
  artifacts: text('artifacts'), // JSON text
  reviewNote: text('review_note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  claimedAt: text('claimed_at'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  leaseExpiry: text('lease_expiry'),
  workDir: text('work_dir'),
}, (table) => [
  index('idx_task_conv').on(table.conversationId),
]);

// ──────────────────────────────────────────────
// chat_message
// ──────────────────────────────────────────────
export const chatMessage = sqliteTable('chat_message', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  taskId: text('task_id'),
  senderType: text('sender_type').notNull(), // human | agent | system
  senderId: text('sender_id').notNull(),
  content: text('content').notNull(),
  contentType: text('content_type').notNull().default('text'),
  mentions: text('mentions'), // JSON text nullable
  intent: text('intent'),
  metadata: text('metadata'), // JSON text nullable
  visibility: text('visibility').notNull().default('public'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_msg_conv').on(table.conversationId),
  index('idx_msg_task').on(table.taskId),
  index('idx_msg_created').on(table.createdAt),
]);

// ──────────────────────────────────────────────
// agent_session
// ──────────────────────────────────────────────
export const agentSession = sqliteTable('agent_session', {
  id: text('id').primaryKey(),
  cliSessionId: text('cli_session_id'),
  conversationId: text('conversation_id').notNull(),
  agentId: text('agent_id').notNull(),
  taskId: text('task_id').notNull(),
  seq: integer('seq').notNull().default(0),
  status: text('status').notNull().default('active'),
  contextHealth: text('context_health'), // JSON text nullable
  usageSnapshot: text('usage_snapshot'), // JSON text nullable
  messageCount: integer('message_count').notNull().default(0),
  sealReason: text('seal_reason'),
  createdAt: text('created_at').notNull(),
  sealedAt: text('sealed_at'),
}, (table) => [
  index('idx_session_agent_task').on(table.agentId, table.taskId),
  uniqueIndex('uq_session_agent_task_seq').on(table.agentId, table.taskId, table.seq),
]);

// ──────────────────────────────────────────────
// invocation
// ──────────────────────────────────────────────
export const invocation = sqliteTable('invocation', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  taskId: text('task_id'),
  agentId: text('agent_id').notNull(),
  sessionId: text('session_id'),
  status: text('status').notNull().default('queued'),
  engine: text('engine'),
  accountId: text('account_id'),
  cliSessionId: text('cli_session_id'),
  prompt: text('prompt'),
  exitCode: integer('exit_code'),
  reasonCode: text('reason_code'),
  usage: text('usage'), // JSON text nullable
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  dispatchStatus: text('dispatch_status').default('queued'),
  tokenUsage: text('token_usage'),
}, (table) => [
  index('idx_invocation_agent').on(table.agentId),
  index('idx_invocation_conv').on(table.conversationId),
]);

// ──────────────────────────────────────────────
// agent_event
// ──────────────────────────────────────────────
export const agentEvent = sqliteTable('agent_event', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  taskId: text('task_id'),
  agentId: text('agent_id').notNull(),
  type: text('type').notNull(),
  payload: text('payload'), // JSON text nullable
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_event_conv').on(table.conversationId),
  index('idx_event_agent').on(table.agentId),
]);

// ──────────────────────────────────────────────
// role_cards
// ──────────────────────────────────────────────
export const roleCards = sqliteTable('role_cards', {
  id: text('id').primaryKey(),
  data: text('data').notNull(), // Full RoleCard JSON including capabilities
  isPreset: integer('is_preset', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type RoleCardRow = InferSelectModel<typeof roleCards>;
export type NewRoleCardRow = InferInsertModel<typeof roleCards>;

// ──────────────────────────────────────────────
// Inferred types
// ──────────────────────────────────────────────
export type Conversation = InferSelectModel<typeof conversation>;
export type NewConversation = InferInsertModel<typeof conversation>;

export type Task = InferSelectModel<typeof task>;
export type NewTask = InferInsertModel<typeof task>;

export type ChatMessage = InferSelectModel<typeof chatMessage>;
export type NewChatMessage = InferInsertModel<typeof chatMessage>;

export type AgentSession = InferSelectModel<typeof agentSession>;
export type NewAgentSession = InferInsertModel<typeof agentSession>;

export type Invocation = InferSelectModel<typeof invocation>;
export type NewInvocation = InferInsertModel<typeof invocation>;

export type AgentEvent = InferSelectModel<typeof agentEvent>;
export type NewAgentEvent = InferInsertModel<typeof agentEvent>;
