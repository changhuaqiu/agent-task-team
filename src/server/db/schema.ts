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
  useWorktree: integer('use_worktree', { mode: 'boolean' }),
  gitRepoRoot: text('git_repo_root'),
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
// A2A possession contract
// ──────────────────────────────────────────────
export const a2aPossessionChain = sqliteTable('a2a_possession_chain', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull()
    .references(() => conversation.id),
  rootTriggerType: text('root_trigger_type').notNull(),
  rootTriggerId: text('root_trigger_id').notNull(),
  status: text('status').notNull().default('active'),
  currentHolderId: text('current_holder_id').notNull(),
  config: text('config').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => [
  index('idx_possession_chain_conv').on(table.conversationId),
  index('idx_possession_chain_status').on(table.status),
  index('idx_possession_chain_holder').on(table.currentHolderId),
]);

export type A2aPossessionChainRow = InferSelectModel<typeof a2aPossessionChain>;
export type NewA2aPossessionChainRow = InferInsertModel<typeof a2aPossessionChain>;

export const a2aPossession = sqliteTable('a2a_possession', {
  id: text('id').primaryKey(),
  chainId: text('chain_id').notNull()
    .references(() => a2aPossessionChain.id),
  holderId: text('holder_id').notNull(),
  holderType: text('holder_type').notNull(),
  status: text('status').notNull().default('open'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  summary: text('summary'),
}, (table) => [
  index('idx_possession_chain').on(table.chainId),
  index('idx_possession_holder').on(table.holderId, table.status),
]);

export type A2aPossessionRow = InferSelectModel<typeof a2aPossession>;
export type NewA2aPossessionRow = InferInsertModel<typeof a2aPossession>;

export const a2aPass = sqliteTable('a2a_pass', {
  id: text('id').primaryKey(),
  chainId: text('chain_id').notNull()
    .references(() => a2aPossessionChain.id),
  fromPossessionId: text('from_possession_id').notNull()
    .references(() => a2aPossession.id),
  fromHolderId: text('from_holder_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  status: text('status').notNull().default('drafted'),
  intent: text('intent').notNull(),
  phase: text('phase'),
  reason: text('reason'),
  handoffPacketId: text('handoff_packet_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_pass_chain').on(table.chainId),
  index('idx_pass_target_status').on(table.toAgentId, table.status),
  index('idx_pass_status').on(table.status),
]);

export type A2aPassRow = InferSelectModel<typeof a2aPass>;
export type NewA2aPassRow = InferInsertModel<typeof a2aPass>;

export const a2aHandoffPacket = sqliteTable('a2a_handoff_packet', {
  id: text('id').primaryKey(),
  chainId: text('chain_id').notNull()
    .references(() => a2aPossessionChain.id),
  passId: text('pass_id').notNull()
    .references(() => a2aPass.id),
  fromHolderId: text('from_holder_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  title: text('title').notNull(),
  requestedAction: text('requested_action').notNull(),
  possessionSummary: text('possession_summary').notNull(),
  relevantDecisions: text('relevant_decisions').notNull().default('[]'),
  evidenceRefs: text('evidence_refs').notNull().default('[]'),
  constraints: text('constraints').notNull().default('[]'),
  openQuestions: text('open_questions').notNull().default('[]'),
  forbiddenBehaviors: text('forbidden_behaviors').notNull().default('[]'),
  sourceMessageIds: text('source_message_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_handoff_chain').on(table.chainId),
  index('idx_handoff_pass').on(table.passId),
]);

export type A2aHandoffPacketRow = InferSelectModel<typeof a2aHandoffPacket>;
export type NewA2aHandoffPacketRow = InferInsertModel<typeof a2aHandoffPacket>;

// ──────────────────────────────────────────────
// System Control Plane: proof events
// ──────────────────────────────────────────────
export const controlProofEvent = sqliteTable('control_proof_event', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  conversationId: text('conversation_id'),
  taskId: text('task_id'),
  chainId: text('chain_id'),
  passId: text('pass_id'),
  envelopeId: text('envelope_id'),
  nodeId: text('node_id'),
  agentId: text('agent_id'),
  actorId: text('actor_id'),
  reasonCode: text('reason_code'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_proof_event_type').on(table.eventType),
  index('idx_proof_event_conv').on(table.conversationId),
  index('idx_proof_event_envelope').on(table.envelopeId),
  index('idx_proof_event_node').on(table.nodeId),
  index('idx_proof_event_agent').on(table.agentId),
]);

export type ControlProofEventRow = InferSelectModel<typeof controlProofEvent>;
export type NewControlProofEventRow = InferInsertModel<typeof controlProofEvent>;

// ──────────────────────────────────────────────
// System Control Plane: runtime nodes
// ──────────────────────────────────────────────
export const runtimeNode = sqliteTable('runtime_node', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  endpoint: text('endpoint'),
  status: text('status').notNull().default('reachable'),
  capabilities: text('capabilities').notNull().default('[]'),
  trustLevel: text('trust_level').notNull().default('local'),
  lastHeartbeatAt: text('last_heartbeat_at'),
  missedHeartbeats: integer('missed_heartbeats').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_runtime_node_kind').on(table.kind),
  index('idx_runtime_node_status').on(table.status),
  index('idx_runtime_node_heartbeat').on(table.lastHeartbeatAt),
]);

export type RuntimeNodeRow = InferSelectModel<typeof runtimeNode>;
export type NewRuntimeNodeRow = InferInsertModel<typeof runtimeNode>;

// ──────────────────────────────────────────────
// System Control Plane: agent bindings
// ──────────────────────────────────────────────
export const agentBinding = sqliteTable('agent_binding', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  agentId: text('agent_id').notNull(),
  nodeId: text('node_id').notNull()
    .references(() => runtimeNode.id),
  runtimeId: text('runtime_id').notNull(),
  status: text('status').notNull().default('idle'),
  activeEnvelopeId: text('active_envelope_id'),
  lastStartedAt: text('last_started_at'),
  lastFinishedAt: text('last_finished_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('uq_agent_binding_conv_agent').on(table.conversationId, table.agentId),
  index('idx_agent_binding_conv_agent').on(table.conversationId, table.agentId),
  index('idx_agent_binding_node').on(table.nodeId),
  index('idx_agent_binding_status').on(table.status),
]);

export type AgentBindingRow = InferSelectModel<typeof agentBinding>;
export type NewAgentBindingRow = InferInsertModel<typeof agentBinding>;

// ──────────────────────────────────────────────
// System Control Plane: execution envelopes
// ──────────────────────────────────────────────
export const executionEnvelope = sqliteTable('execution_envelope', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  intent: text('intent').notNull(),
  conversationId: text('conversation_id').notNull(),
  taskId: text('task_id'),
  chainId: text('chain_id'),
  passId: text('pass_id'),
  fromNodeId: text('from_node_id').notNull(),
  fromAgentId: text('from_agent_id'),
  toNodeId: text('to_node_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  payload: text('payload').notNull().default('{}'),
  ttlMs: integer('ttl_ms').notNull(),
  nonce: text('nonce').notNull(),
  status: text('status').notNull().default('drafted'),
  reasonCode: text('reason_code'),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_execution_envelope_conv').on(table.conversationId),
  index('idx_execution_envelope_target').on(table.toNodeId, table.toAgentId),
  index('idx_execution_envelope_status').on(table.status),
  index('idx_execution_envelope_expires').on(table.expiresAt),
]);

export type ExecutionEnvelopeRow = InferSelectModel<typeof executionEnvelope>;
export type NewExecutionEnvelopeRow = InferInsertModel<typeof executionEnvelope>;

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
  teamMode: text('team_mode').notNull().default('hub_spoke'),  // pipeline | parallel | hub_spoke | custom
  workflow: text('workflow').notNull(),  // JSON: TeamPackWorkflow
  communicationMatrix: text('communication_matrix').notNull(),  // JSON
  sharedContext: text('shared_context'),  // JSON
  rules: text('rules'),             // JSON: TeamPackRules
  source: text('source'),           // JSON: { type, url, importedAt }
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
  roleCardSnapshot: text('role_card_snapshot'),
  accountIds: text('account_ids'),
  skillIds: text('skill_ids'),
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
