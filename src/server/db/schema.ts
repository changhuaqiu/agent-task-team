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
  teamPackId: text('team_pack_id').references(() => teamPack.id),
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
  leaseExpiry: text('lease_expiry'),
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
// phase
// ──────────────────────────────────────────────
export const phase = sqliteTable('phase', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversation.id),
  title: text('title').notNull(),
  description: text('description'),
  order: integer('order').notNull().default(0),
  status: text('status').notNull().default('planned'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_phase_conv').on(table.conversationId),
]);

export type PhaseRow = InferSelectModel<typeof phase>;
export type NewPhaseRow = InferInsertModel<typeof phase>;

// ──────────────────────────────────────────────
// agents
// ──────────────────────────────────────────────
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  roleCardId: text('role_card_id').notNull(),
  theme: text('theme').notNull(),
  emoji: text('emoji').notNull(),
  isPreset: integer('is_preset', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type AgentRow = InferSelectModel<typeof agents>;
export type NewAgentRow = InferInsertModel<typeof agents>;

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

// ──────────────────────────────────────────────
// agent_mailbox
// ──────────────────────────────────────────────
export const agentMailbox = sqliteTable('agent_mailbox', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull()
    .references(() => conversation.id),
  fromAgentId: text('from_agent_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  triggerMessageId: text('trigger_message_id'),
  taskId: text('task_id'),
  content: text('content').notNull(),
  contextSnapshot: text('context_snapshot'), // JSON text nullable
  status: text('status').notNull().default('pending'), // pending | delivered | processed | expired
  chainDepth: integer('chain_depth').notNull().default(0),
  a2aFrom: text('a2a_from'),
  source: text('source').notNull().default('a2a'),
  epochId: text('epoch_id'),
  createdAt: text('created_at').notNull(),
  deliveredAt: text('delivered_at'),
}, (table) => [
  index('idx_mailbox_to_status').on(table.toAgentId, table.status),
  index('idx_mailbox_conv').on(table.conversationId),
]);

export type AgentMailboxRow = InferSelectModel<typeof agentMailbox>;
export type NewAgentMailboxRow = InferInsertModel<typeof agentMailbox>;

// ──────────────────────────────────────────────
// A2A v2: invocation_chain
// ──────────────────────────────────────────────
export const invocationChain = sqliteTable('invocation_chain', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull()
    .references(() => conversation.id),
  rootTriggerType: text('root_trigger_type').notNull(),
  rootTriggerId: text('root_trigger_id').notNull(),
  status: text('status').notNull().default('active'),
  config: text('config').notNull(),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => [
  index('idx_chain_conv').on(table.conversationId),
  index('idx_chain_status').on(table.status),
]);

export type InvocationChainRow = InferSelectModel<typeof invocationChain>;
export type NewInvocationChainRow = InferInsertModel<typeof invocationChain>;

// ──────────────────────────────────────────────
// A2A v2: chain_worklist
// ──────────────────────────────────────────────
export const chainWorklist = sqliteTable('chain_worklist', {
  id: text('id').primaryKey(),
  chainId: text('chain_id').notNull()
    .references(() => invocationChain.id),
  agentId: text('agent_id').notNull(),
  requestedBy: text('requested_by').notNull(),
  prompt: text('prompt').notNull(),
  contentHash: text('content_hash').notNull(),
  depth: integer('depth').notNull().default(0),
  status: text('status').notNull().default('queued'),
  outcome: text('outcome'),
  queuedAt: text('queued_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
}, (table) => [
  index('idx_worklist_chain').on(table.chainId),
  index('idx_worklist_agent').on(table.agentId, table.status),
  uniqueIndex('uq_worklist_hash').on(table.chainId, table.contentHash),
]);

export type ChainWorklistRow = InferSelectModel<typeof chainWorklist>;
export type NewChainWorklistRow = InferInsertModel<typeof chainWorklist>;

// ──────────────────────────────────────────────
// A2A v2: delivery_cursor
// ──────────────────────────────────────────────
export const deliveryCursor = sqliteTable('delivery_cursor', {
  agentId: text('agent_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  lastChainId: text('last_chain_id'),
  lastEntryId: text('last_entry_id'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('pk_cursor').on(table.agentId, table.conversationId),
]);

export type DeliveryCursorRow = InferSelectModel<typeof deliveryCursor>;
export type NewDeliveryCursorRow = InferInsertModel<typeof deliveryCursor>;

// ──────────────────────────────────────────────
// A2A v2: a2a_audit_log
// ──────────────────────────────────────────────
export const a2aAuditLog = sqliteTable('a2a_audit_log', {
  id: text('id').primaryKey(),
  chainId: text('chain_id'),
  conversationId: text('conversation_id').notNull(),
  eventType: text('event_type').notNull(),
  fromAgentId: text('from_agent_id'),
  toAgentId: text('to_agent_id'),
  contentHash: text('content_hash'),
  reason: text('reason'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_audit_chain').on(table.chainId),
  index('idx_audit_conv').on(table.conversationId),
]);

export type A2aAuditLogRow = InferSelectModel<typeof a2aAuditLog>;
export type NewA2aAuditLogRow = InferInsertModel<typeof a2aAuditLog>;

// ──────────────────────────────────────────────
// team_pack
// ──────────────────────────────────────────────
export const teamPack = sqliteTable('team_pack', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  version: text('version').notNull().default('1.0.0'),
  author: text('author'),           // JSON: { name, github }
  license: text('license'),
  tags: text('tags'),               // JSON string[]
  category: text('category').notNull().default('team/general'),
  workflow: text('workflow').notNull(),  // JSON: TeamPackWorkflow
  communicationMatrix: text('communication_matrix').notNull(),  // JSON
  sharedContext: text('shared_context'),  // JSON
  rules: text('rules'),             // JSON: TeamPackRules
  isPreset: integer('is_preset', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type TeamPackRow = InferSelectModel<typeof teamPack>;
export type NewTeamPackRow = InferInsertModel<typeof teamPack>;

// ──────────────────────────────────────────────
// team_pack_role
// ──────────────────────────────────────────────
export const teamPackRole = sqliteTable('team_pack_role', {
  id: text('id').primaryKey(),
  packId: text('pack_id').notNull()
    .references(() => teamPack.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull(),
  displayName: text('display_name').notNull(),
  soul: text('soul').notNull(),
  required: integer('required', { mode: 'boolean' }).notNull().default(true),
  description: text('description'),
  roleCardId: text('role_card_id'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('uq_team_pack_role').on(table.packId, table.roleId),
  index('idx_team_pack_role_pack').on(table.packId),
]);

export type TeamPackRoleRow = InferSelectModel<typeof teamPackRole>;
export type NewTeamPackRoleRow = InferInsertModel<typeof teamPackRole>;

// ──────────────────────────────────────────────
// agent_team_pack (junction table)
// ──────────────────────────────────────────────
export const agentTeamPack = sqliteTable('agent_team_pack', {
  agentId: text('agent_id').notNull(),
  packId: text('pack_id').notNull()
    .references(() => teamPack.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull(),
  assignedAt: text('assigned_at').notNull(),
}, (table) => [
  index('idx_agent_team_pack_agent').on(table.agentId),
  index('idx_agent_team_pack_pack').on(table.packId),
]);

export type AgentTeamPackRow = InferSelectModel<typeof agentTeamPack>;
export type NewAgentTeamPackRow = InferInsertModel<typeof agentTeamPack>;
