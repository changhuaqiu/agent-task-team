import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { sql, type InferSelectModel, type InferInsertModel } from 'drizzle-orm';

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
  invocationId: text('invocation_id'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_msg_conv').on(table.conversationId),
  index('idx_msg_task').on(table.taskId),
  index('idx_msg_created').on(table.createdAt),
  index('idx_msg_invocation').on(table.invocationId),
]);

// ──────────────────────────────────────────────
// agent_session
// ──────────────────────────────────────────────
export const agentSession = sqliteTable('agent_session', {
  id: text('id').primaryKey(),
  cliSessionId: text('cli_session_id'),
  conversationId: text('conversation_id').notNull(),
  agentId: text('agent_id').notNull(),
  engine: text('engine'),
  runtimeId: text('runtime_id'),
  accountId: text('account_id'),
  isolationKey: text('isolation_key').notNull().default(''),
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
  uniqueIndex('uq_agent_session_active_project_agent')
    .on(table.conversationId, table.agentId, table.isolationKey)
    .where(sql`${table.status} = 'active'`),
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
// platform_event
// ──────────────────────────────────────────────
export const platformEvent = sqliteTable('platform_event', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  category: text('category').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  projectId: text('project_id').notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  streamKey: text('stream_key').notNull(),
  streamSequence: integer('stream_sequence').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  aggregateVersion: integer('aggregate_version'),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id').notNull(),
  subjectType: text('subject_type'),
  subjectId: text('subject_id'),
  projectAgentId: text('project_agent_id'),
  invocationId: text('invocation_id'),
  inboxItemId: text('inbox_item_id'),
  correlationId: text('correlation_id').notNull(),
  causationId: text('causation_id'),
  dedupeKey: text('dedupe_key'),
  payload: text('payload').notNull(),
  occurredAt: text('occurred_at').notNull(),
  recordedAt: text('recorded_at').notNull(),
}, (table) => [
  uniqueIndex('uq_platform_event_stream_sequence').on(table.streamKey, table.streamSequence),
  uniqueIndex('uq_platform_event_dedupe').on(table.dedupeKey),
  index('idx_platform_event_project').on(table.projectId, table.recordedAt, table.id),
  index('idx_platform_event_stream').on(table.streamKey, table.streamSequence),
  index('idx_platform_event_invocation').on(table.invocationId, table.streamSequence),
  index('idx_platform_event_project_agent').on(
    table.projectId,
    table.projectAgentId,
    table.recordedAt,
  ),
]);

export const platformEventDelivery = sqliteTable('platform_event_delivery', {
  id: text('id').primaryKey(),
  handlerId: text('handler_id').notNull(),
  eventId: text('event_id').notNull()
    .references(() => platformEvent.id, { onDelete: 'cascade' }),
  streamKey: text('stream_key').notNull(),
  streamSequence: integer('stream_sequence').notNull(),
  status: text('status').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: text('next_attempt_at').notNull(),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: text('lease_expires_at'),
  currentAttemptId: text('current_attempt_id'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => [
  uniqueIndex('uq_platform_event_delivery_handler_event').on(table.handlerId, table.eventId),
  index('idx_platform_event_delivery_claim').on(
    table.status,
    table.nextAttemptAt,
    table.handlerId,
    table.streamKey,
    table.streamSequence,
  ),
  index('idx_platform_event_delivery_stream').on(
    table.handlerId,
    table.streamKey,
    table.streamSequence,
  ),
]);

export const platformEventDeliveryAttempt = sqliteTable('platform_event_delivery_attempt', {
  id: text('id').primaryKey(),
  deliveryId: text('delivery_id').notNull()
    .references(() => platformEventDelivery.id, { onDelete: 'cascade' }),
  attemptNo: integer('attempt_no').notNull(),
  workerId: text('worker_id').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  error: text('error'),
}, (table) => [
  uniqueIndex('uq_platform_event_delivery_attempt_no').on(table.deliveryId, table.attemptNo),
  index('idx_platform_event_delivery_attempt_delivery').on(table.deliveryId, table.attemptNo),
]);

export const runtimeInvocationProjection = sqliteTable('runtime_invocation_projection', {
  invocationId: text('invocation_id').primaryKey(),
  projectId: text('project_id').notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  projectAgentId: text('project_agent_id').notNull(),
  status: text('status').notNull(),
  outcome: text('outcome'),
  reasonCode: text('reason_code'),
  acceptedAt: text('accepted_at').notNull(),
  startedAt: text('started_at'),
  terminatedAt: text('terminated_at'),
  lastStreamSequence: integer('last_stream_sequence').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_runtime_invocation_projection_project').on(
    table.projectId,
    table.projectAgentId,
    table.updatedAt,
  ),
]);

export const platformEventHandlerCursor = sqliteTable('platform_event_handler_cursor', {
  handlerId: text('handler_id').primaryKey(),
  lastIngestionId: integer('last_ingestion_id').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const platformEventIngestion = sqliteTable('platform_event_ingestion', {
  ingestionId: integer('ingestion_id').primaryKey({ autoIncrement: true }),
  eventId: text('event_id').notNull()
    .references(() => platformEvent.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('uq_platform_event_ingestion_event').on(table.eventId),
]);

export const platformEffectOutbox = sqliteTable('platform_effect_outbox', {
  id: text('id').primaryKey(),
  sourceEventId: text('source_event_id').notNull()
    .references(() => platformEvent.id, { onDelete: 'cascade' }),
  effectType: text('effect_type').notNull(),
  targetKey: text('target_key').notNull(),
  laneKey: text('lane_key').notNull(),
  laneSequence: integer('lane_sequence').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: text('next_attempt_at').notNull(),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: text('lease_expires_at'),
  currentAttemptId: text('current_attempt_id'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => [
  uniqueIndex('uq_platform_effect_idempotency').on(table.idempotencyKey),
  uniqueIndex('uq_platform_effect_lane_sequence').on(table.laneKey, table.laneSequence),
  index('idx_platform_effect_claim').on(
    table.status,
    table.nextAttemptAt,
    table.effectType,
    table.laneKey,
    table.laneSequence,
  ),
  index('idx_platform_effect_source').on(
    table.sourceEventId,
    table.laneKey,
    table.laneSequence,
  ),
]);

export const platformEffectAttempt = sqliteTable('platform_effect_attempt', {
  id: text('id').primaryKey(),
  effectId: text('effect_id').notNull()
    .references(() => platformEffectOutbox.id, { onDelete: 'cascade' }),
  attemptNo: integer('attempt_no').notNull(),
  workerId: text('worker_id').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  error: text('error'),
}, (table) => [
  uniqueIndex('uq_platform_effect_attempt_no').on(table.effectId, table.attemptNo),
  index('idx_platform_effect_attempt_effect').on(table.effectId, table.attemptNo),
]);

export const agentInboxItem = sqliteTable('agent_inbox_item', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  projectAgentId: text('project_agent_id').notNull(),
  sourceEventId: text('source_event_id')
    .references(() => platformEvent.id, { onDelete: 'set null' }),
  idempotencyKey: text('idempotency_key').notNull(),
  commandJson: text('command_json').notNull(),
  status: text('status').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  availableAt: text('available_at').notNull(),
  leaseToken: text('lease_token'),
  leaseExpiresAt: text('lease_expires_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  claimedAt: text('claimed_at'),
  completedAt: text('completed_at'),
}, (table) => [
  uniqueIndex('uq_agent_inbox_idempotency').on(table.idempotencyKey),
  uniqueIndex('uq_agent_inbox_source_agent').on(table.sourceEventId, table.projectAgentId),
  index('idx_agent_inbox_claim').on(
    table.status,
    table.availableAt,
    table.projectId,
    table.projectAgentId,
    table.createdAt,
  ),
  index('idx_agent_inbox_agent').on(
    table.projectId,
    table.projectAgentId,
    table.status,
    table.createdAt,
  ),
]);

export const autonomousDeliveryAdvancementRequest = sqliteTable(
  'autonomous_delivery_advancement_request',
  {
    id: text('id').primaryKey(),
    sourceEventId: text('source_event_id').notNull()
      .references(() => platformEvent.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    causeJson: text('cause_json').notNull(),
    status: text('status').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: text('available_at').notNull(),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    uniqueIndex('uq_delivery_advancement_source_event').on(table.sourceEventId),
    index('idx_delivery_advancement_claim').on(
      table.status,
      table.availableAt,
      table.createdAt,
      table.id,
    ),
  ],
);

export const runtimeMessageProjection = sqliteTable('runtime_message_projection', {
  eventId: text('event_id').primaryKey()
    .references(() => platformEvent.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .references(() => chatMessage.id, { onDelete: 'set null' }),
  projectedAt: text('projected_at').notNull(),
});

export const runtimeObservabilityProjection = sqliteTable('runtime_observability_projection', {
  eventId: text('event_id').primaryKey()
    .references(() => platformEvent.id, { onDelete: 'cascade' }),
  projectedAt: text('projected_at').notNull(),
});

export const runtimeCompletionContext = sqliteTable('runtime_completion_context', {
  invocationId: text('invocation_id').primaryKey()
    .references(() => invocation.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull(),
  taskId: text('task_id'),
  chainId: text('chain_id'),
  passId: text('pass_id'),
  contextScenario: text('context_scenario'),
  teamLogUpToEntryId: text('team_log_up_to_entry_id'),
  taskProjectDir: text('task_project_dir').notNull(),
  evaluationExecutionId: text('evaluation_execution_id'),
  sourceEventId: text('source_event_id').unique()
    .references(() => platformEvent.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
});

export const runtimeCompletionLegacyEffectSuppression = sqliteTable(
  'runtime_completion_legacy_effect_suppression',
  {
    eventId: text('event_id').notNull()
      .references(() => platformEvent.id, { onDelete: 'cascade' }),
    effectType: text('effect_type').notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.effectType] })],
);

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

export const a2aDelivery = sqliteTable('a2a_delivery', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull()
    .references(() => conversation.id),
  chainId: text('chain_id').notNull()
    .references(() => invocationChain.id),
  entryId: text('entry_id').notNull()
    .references(() => chainWorklist.id),
  passId: text('pass_id'),
  agentId: text('agent_id').notNull(),
  eventType: text('event_type').notNull().default('a2a:dispatch'),
  payload: text('payload').notNull().default('{}'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_a2a_delivery_conv').on(table.conversationId, table.status),
  index('idx_a2a_delivery_entry').on(table.entryId),
  index('idx_a2a_delivery_agent').on(table.agentId, table.status),
  uniqueIndex('uq_a2a_delivery_entry').on(table.entryId),
]);

export type A2aDeliveryRow = InferSelectModel<typeof a2aDelivery>;
export type NewA2aDeliveryRow = InferInsertModel<typeof a2aDelivery>;

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

// Agent observability: OTel-compatible local span projection.
export const observationSpan = sqliteTable('observation_span', {
  spanId: text('span_id').primaryKey(),
  traceId: text('trace_id').notNull(),
  parentSpanId: text('parent_span_id'),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('running'),
  conversationId: text('conversation_id').notNull(),
  taskId: text('task_id'),
  agentId: text('agent_id'),
  invocationId: text('invocation_id'),
  envelopeId: text('envelope_id'),
  chainId: text('chain_id'),
  passId: text('pass_id'),
  attributes: text('attributes').notNull().default('{}'),
  inputPreview: text('input_preview'),
  outputPreview: text('output_preview'),
  errorMessage: text('error_message'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
}, (table) => [
  index('idx_observation_span_trace').on(table.traceId, table.startedAt),
  index('idx_observation_span_conv').on(table.conversationId, table.startedAt),
  index('idx_observation_span_invocation').on(table.invocationId),
  index('idx_observation_span_agent').on(table.agentId, table.startedAt),
]);

export type ObservationSpanRow = InferSelectModel<typeof observationSpan>;
export type NewObservationSpanRow = InferInsertModel<typeof observationSpan>;

export const observationSpanPayload = sqliteTable('observation_span_payload', {
  spanId: text('span_id').notNull().references(() => observationSpan.spanId, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  seq: integer('seq').notNull().default(0),
  content: text('content').notNull(),
  byteSize: integer('byte_size').notNull(),
  truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.spanId, table.role, table.seq] }),
  index('idx_observation_span_payload_span').on(table.spanId),
]);

export type ObservationSpanPayloadRow = InferSelectModel<typeof observationSpanPayload>;
export type NewObservationSpanPayloadRow = InferInsertModel<typeof observationSpanPayload>;

export const agentLogCursor = sqliteTable('agent_log_cursor', {
  agentId: text('agent_id').notNull(),
  projectId: text('project_id').notNull(),
  lastConsumedId: text('last_consumed_id').notNull(),
  consumedAt: text('consumed_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.agentId, table.projectId] }),
  index('idx_agent_log_cursor_project').on(table.projectId),
]);

export type AgentLogCursorRow = InferSelectModel<typeof agentLogCursor>;

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
// Group Chat Task Graph: task actions
// ──────────────────────────────────────────────
export const taskAction = sqliteTable('task_action', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull()
    .references(() => conversation.id),
  actorId: text('actor_id').notNull(),
  actorType: text('actor_type').notNull(),
  type: text('type').notNull(),
  taskIds: text('task_ids').notNull().default('[]'),
  messageId: text('message_id'),
  passId: text('pass_id'),
  possessionId: text('possession_id'),
  proofEventId: text('proof_event_id'),
  payload: text('payload').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_task_action_conv').on(table.conversationId),
  index('idx_task_action_type').on(table.type),
  index('idx_task_action_message').on(table.messageId),
  index('idx_task_action_pass').on(table.passId),
]);

export type TaskActionRow = InferSelectModel<typeof taskAction>;
export type NewTaskActionRow = InferInsertModel<typeof taskAction>;

// ──────────────────────────────────────────────
// Group Chat Task Graph: task edges
// ──────────────────────────────────────────────
export const taskEdge = sqliteTable('task_edge', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull()
    .references(() => conversation.id),
  fromTaskId: text('from_task_id').notNull()
    .references(() => task.id),
  toTaskId: text('to_task_id').notNull()
    .references(() => task.id),
  type: text('type').notNull(),
  createdByActionId: text('created_by_action_id').notNull()
    .references(() => taskAction.id),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('uq_task_edge').on(table.fromTaskId, table.toTaskId, table.type),
  index('idx_task_edge_conv').on(table.conversationId),
  index('idx_task_edge_from').on(table.fromTaskId),
  index('idx_task_edge_to').on(table.toTaskId),
  index('idx_task_edge_type').on(table.type),
]);

export type TaskEdgeRow = InferSelectModel<typeof taskEdge>;
export type NewTaskEdgeRow = InferInsertModel<typeof taskEdge>;

// ──────────────────────────────────────────────
// Group Chat Task Graph: artifact references
// ──────────────────────────────────────────────
export const taskArtifactRef = sqliteTable('task_artifact_ref', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull()
    .references(() => conversation.id),
  taskId: text('task_id').notNull()
    .references(() => task.id),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  path: text('path'),
  url: text('url'),
  proofEventId: text('proof_event_id'),
  createdByActionId: text('created_by_action_id').notNull()
    .references(() => taskAction.id),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_task_artifact_conv').on(table.conversationId),
  index('idx_task_artifact_task').on(table.taskId),
  index('idx_task_artifact_action').on(table.createdByActionId),
]);

export type TaskArtifactRefRow = InferSelectModel<typeof taskArtifactRef>;
export type NewTaskArtifactRefRow = InferInsertModel<typeof taskArtifactRef>;

// ──────────────────────────────────────────────
// Group Chat Task Graph: chat bindings
// ──────────────────────────────────────────────
export const chatTaskBinding = sqliteTable('chat_task_binding', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull()
    .references(() => conversation.id),
  messageId: text('message_id').notNull()
    .references(() => chatMessage.id),
  taskId: text('task_id').notNull()
    .references(() => task.id),
  actionId: text('action_id')
    .references(() => taskAction.id),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('uq_chat_task_binding').on(table.messageId, table.taskId, table.actionId),
  index('idx_chat_task_binding_conv').on(table.conversationId),
  index('idx_chat_task_binding_message').on(table.messageId),
  index('idx_chat_task_binding_task').on(table.taskId),
  index('idx_chat_task_binding_action').on(table.actionId),
]);

export type ChatTaskBindingRow = InferSelectModel<typeof chatTaskBinding>;
export type NewChatTaskBindingRow = InferInsertModel<typeof chatTaskBinding>;

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

// Agent evaluation: immutable evidence, scores, calibration, experiments, and governed changes.
export const evalRubric = sqliteTable('eval_rubric', {
  id: text('id').primaryKey(), name: text('name').notNull(), ownerId: text('owner_id').notNull(),
  status: text('status').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const evalRubricRevision = sqliteTable('eval_rubric_revision', {
  id: text('id').primaryKey(), rubricId: text('rubric_id').notNull().references(() => evalRubric.id),
  revision: integer('revision').notNull(), definition: text('definition').notNull(),
  contentHash: text('content_hash').notNull(), status: text('status').notNull(),
  publishedBy: text('published_by').notNull(), publishedAt: text('published_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('uq_eval_rubric_revision').on(table.rubricId, table.revision),
  uniqueIndex('uq_eval_rubric_hash').on(table.rubricId, table.contentHash),
]);
export const evalSubjectSnapshot = sqliteTable('eval_subject_snapshot', {
  id: text('id').primaryKey(), conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  rootTaskId: text('root_task_id'), chainId: text('chain_id'), mode: text('mode').notNull(),
  evidenceCutoffAt: text('evidence_cutoff_at').notNull(), collectedAt: text('collected_at').notNull(),
  snapshotHash: text('snapshot_hash').notNull(), evidenceRefs: text('evidence_refs').notNull(),
  evidencePayload: text('evidence_payload').notNull(), appManifest: text('app_manifest').notNull(),
  dataQuality: text('data_quality').notNull(), taskType: text('task_type').notNull(),
  difficulty: text('difficulty').notNull(), language: text('language').notNull(),
}, (table) => [
  uniqueIndex('uq_eval_snapshot_hash').on(table.snapshotHash),
  index('idx_eval_snapshot_conversation').on(table.conversationId, table.evidenceCutoffAt),
]);
export const evalRun = sqliteTable('eval_run', {
  id: text('id').primaryKey(), conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  snapshotId: text('snapshot_id').references(() => evalSubjectSnapshot.id),
  rubricRevisionId: text('rubric_revision_id').notNull().references(() => evalRubricRevision.id),
  mode: text('mode').notNull(), idempotencyKey: text('idempotency_key').notNull(), status: text('status').notNull(),
  gateStatus: text('gate_status').notNull(), evidenceCoverage: real('evidence_coverage').notNull(),
  overallScore: real('overall_score'), evaluatorBundleDigest: text('evaluator_bundle_digest').notNull(),
  caseId: text('case_id'), applicationManifestDigest: text('application_manifest_digest'),
  errorCode: text('error_code'), errorMessage: text('error_message'), startedAt: text('started_at'),
  completedAt: text('completed_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('uq_eval_run_idempotency').on(table.idempotencyKey),
  index('idx_eval_run_conversation').on(table.conversationId, table.createdAt),
]);
export const evalJob = sqliteTable('eval_job', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => evalRun.id, { onDelete: 'cascade' }),
  requestPayload: text('request_payload').notNull(), status: text('status').notNull(),
  attemptCount: integer('attempt_count').notNull(), maxAttempts: integer('max_attempts').notNull(),
  nextAttemptAt: text('next_attempt_at').notNull(), leaseUntil: text('lease_until'), lastError: text('last_error'),
  leaseToken: text('lease_token'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('uq_eval_job_run').on(table.runId),
  index('idx_eval_job_claim').on(table.status, table.nextAttemptAt, table.leaseUntil),
]);
export const evalScore = sqliteTable('eval_score', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => evalRun.id, { onDelete: 'cascade' }),
  dimensionKey: text('dimension_key').notNull(), evaluatorKind: text('evaluator_kind').notNull(),
  evaluatorRevision: text('evaluator_revision').notNull(), applicability: text('applicability').notNull(),
  rawScore: real('raw_score'), normalizedScore: real('normalized_score'), label: text('label').notNull(),
  rationale: text('rationale').notNull(), evidenceRefs: text('evidence_refs').notNull(), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('uq_eval_score_dimension').on(table.runId, table.dimensionKey, table.evaluatorKind),
  index('idx_eval_score_run').on(table.runId),
]);
export const evalJudgeAttempt = sqliteTable('eval_judge_attempt', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => evalRun.id, { onDelete: 'cascade' }),
  scoreId: text('score_id').references(() => evalScore.id), dimensionKey: text('dimension_key').notNull(),
  judgeAccountId: text('judge_account_id'), provider: text('provider'), model: text('model'),
  promptDigest: text('prompt_digest').notNull(), requestParams: text('request_params').notNull(),
  responsePayload: text('response_payload'), parseStatus: text('parse_status').notNull(),
  promptTokens: integer('prompt_tokens'), completionTokens: integer('completion_tokens'),
  latencyMs: integer('latency_ms'), errorCode: text('error_code'), errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
});
export const evalGap = sqliteTable('eval_gap', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => evalRun.id, { onDelete: 'cascade' }),
  dimensionKey: text('dimension_key').notNull(), severity: text('severity').notNull(),
  description: text('description').notNull(), suggestion: text('suggestion').notNull(),
  targetType: text('target_type'), targetRef: text('target_ref'), status: text('status').notNull(),
  evidenceRefs: text('evidence_refs').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_eval_gap_run').on(table.runId, table.status)]);
export const evalPolicy = sqliteTable('eval_policy', {
  conversationId: text('conversation_id').primaryKey().references(() => conversation.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(), samplingRate: real('sampling_rate').notNull(),
  dailyTokenBudget: integer('daily_token_budget').notNull(), judgeAccountId: text('judge_account_id'),
  secondaryJudgeAccountId: text('secondary_judge_account_id'),
  maxConcurrency: integer('max_concurrency').notNull(),
  allowedProviders: text('allowed_providers').notNull(), retentionDays: integer('retention_days').notNull(),
  failStrategy: text('fail_strategy').notNull(), updatedBy: text('updated_by').notNull(), updatedAt: text('updated_at').notNull(),
});
export const evalDataset = sqliteTable('eval_dataset', {
  id: text('id').primaryKey(), conversationId: text('conversation_id').references(() => conversation.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), description: text('description').notNull(), revision: integer('revision').notNull(),
  status: text('status').notNull(), createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [uniqueIndex('uq_eval_dataset_revision').on(table.conversationId, table.name, table.revision)]);
export const evalCase = sqliteTable('eval_case', {
  id: text('id').primaryKey(), datasetId: text('dataset_id').notNull().references(() => evalDataset.id, { onDelete: 'cascade' }),
  caseKey: text('case_key').notNull(), split: text('split').notNull(), sourceType: text('source_type').notNull(),
  sourceRef: text('source_ref'), inputPayload: text('input_payload').notNull(),
  expectedLabels: text('expected_labels').notNull(), metadata: text('metadata').notNull(),
  contentHash: text('content_hash').notNull(), redactionStatus: text('redaction_status').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('uq_eval_case_key').on(table.datasetId, table.caseKey),
  index('idx_eval_case_dataset').on(table.datasetId, table.split),
]);
export const evalAnnotation = sqliteTable('eval_annotation', {
  id: text('id').primaryKey(), caseId: text('case_id').notNull().references(() => evalCase.id, { onDelete: 'cascade' }),
  // Added after the initial table; SQLite migration enforces this relation with insert/update triggers.
  conversationId: text('conversation_id'),
  runId: text('run_id').references(() => evalRun.id), rubricRevisionId: text('rubric_revision_id').notNull().references(() => evalRubricRevision.id),
  reviewerId: text('reviewer_id').notNull(), dimensionKey: text('dimension_key').notNull(),
  label: text('label').notNull(), rationale: text('rationale').notNull(), blindBatchId: text('blind_batch_id'),
  status: text('status').notNull(), createdAt: text('created_at').notNull(),
});
export const evalExperiment = sqliteTable('eval_experiment', {
  id: text('id').primaryKey(), conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  datasetId: text('dataset_id').notNull().references(() => evalDataset.id), datasetRevision: integer('dataset_revision').notNull(),
  rubricRevisionId: text('rubric_revision_id').notNull().references(() => evalRubricRevision.id),
  evaluatorBundleDigest: text('evaluator_bundle_digest').notNull(), name: text('name').notNull(),
  status: text('status').notNull(), baselineManifest: text('baseline_manifest').notNull(),
  candidateManifest: text('candidate_manifest').notNull(), summary: text('summary'), createdBy: text('created_by').notNull(),
  // SQLite adds these after the original experiment table; ownership is validated by the service.
  baselineSnapshotId: text('baseline_snapshot_id'),
  candidateSnapshotId: text('candidate_snapshot_id'),
  startedAt: text('started_at'), completedAt: text('completed_at'), errorCode: text('error_code'), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_eval_experiment_conversation').on(table.conversationId, table.createdAt)]);
export const evalExperimentItem = sqliteTable('eval_experiment_item', {
  id: text('id').primaryKey(), experimentId: text('experiment_id').notNull().references(() => evalExperiment.id, { onDelete: 'cascade' }),
  caseId: text('case_id').notNull().references(() => evalCase.id), baselineRunId: text('baseline_run_id').references(() => evalRun.id),
  candidateRunId: text('candidate_run_id').references(() => evalRun.id), winner: text('winner'),
  scoreDelta: real('score_delta'), executionVerified: integer('execution_verified', { mode: 'boolean' }).notNull(),
  details: text('details').notNull(), createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('uq_eval_experiment_case').on(table.experimentId, table.caseId)]);
export const evalApplicationSnapshot = sqliteTable('eval_application_snapshot', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  source: text('source').notNull(),
  projectPath: text('project_path').notNull(),
  codeRevision: text('code_revision').notNull(),
  teamManifest: text('team_manifest').notNull(),
  agentManifest: text('agent_manifest').notNull(),
  manifestDigest: text('manifest_digest').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('uq_eval_application_snapshot_digest').on(table.conversationId, table.manifestDigest),
  index('idx_eval_application_snapshot_conversation').on(table.conversationId, table.createdAt),
]);
export const evalCaseExecution = sqliteTable('eval_case_execution', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  experimentId: text('experiment_id').references(() => evalExperiment.id, { onDelete: 'cascade' }),
  caseId: text('case_id').notNull().references(() => evalCase.id),
  applicationSnapshotId: text('application_snapshot_id').notNull().references(() => evalApplicationSnapshot.id),
  agentId: text('agent_id'),
  variant: text('variant').notNull(),
  status: text('status').notNull(),
  taskId: text('task_id').references(() => task.id, { onDelete: 'set null' }),
  harnessTriggerId: text('harness_trigger_id'),
  invocationId: text('invocation_id').references(() => invocation.id),
  traceId: text('trace_id'),
  evalRunId: text('eval_run_id').references(() => evalRun.id),
  proofEventId: text('proof_event_id').references(() => controlProofEvent.id),
  targetManifestDigest: text('target_manifest_digest').notNull(),
  observedManifestDigest: text('observed_manifest_digest'),
  executionVerified: integer('execution_verified', { mode: 'boolean' }).notNull(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('uq_eval_case_execution_variant').on(table.experimentId, table.caseId, table.variant),
  index('idx_eval_case_execution_claim').on(table.status, table.createdAt),
  index('idx_eval_case_execution_experiment').on(table.experimentId, table.caseId),
  index('idx_eval_case_execution_agent').on(table.conversationId, table.agentId, table.status),
]);
export const evalBudgetReservation = sqliteTable('eval_budget_reservation', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull().references(() => evalRun.id, { onDelete: 'cascade' }),
  reservationKey: text('reservation_key').notNull(),
  reservedTokens: integer('reserved_tokens').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('uq_eval_budget_reservation_key').on(table.reservationKey),
  index('idx_eval_budget_reservation_scope').on(table.conversationId, table.expiresAt),
]);
export const evalChangeProposal = sqliteTable('eval_change_proposal', {
  id: text('id').primaryKey(), conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  gapId: text('gap_id').references(() => evalGap.id), targetType: text('target_type').notNull(), targetRef: text('target_ref'),
  hypothesis: text('hypothesis').notNull(), proposedChange: text('proposed_change').notNull(), risk: text('risk').notNull(),
  ownerId: text('owner_id').notNull(), status: text('status').notNull(), approvalBy: text('approval_by'),
  approvedAt: text('approved_at'), regressionExperimentId: text('regression_experiment_id').references(() => evalExperiment.id),
  applyEvidence: text('apply_evidence'), revertEvidence: text('revert_evidence'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_eval_change_proposal_conversation').on(table.conversationId, table.status)]);
export const evalReviewQueue = sqliteTable('eval_review_queue', {
  id: text('id').primaryKey(), conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  runId: text('run_id').references(() => evalRun.id, { onDelete: 'cascade' }),
  experimentId: text('experiment_id').references(() => evalExperiment.id, { onDelete: 'cascade' }),
  caseId: text('case_id').references(() => evalCase.id), dimensionKey: text('dimension_key'),
  reasonCode: text('reason_code').notNull(), primaryLabel: text('primary_label'), secondaryLabel: text('secondary_label'),
  status: text('status').notNull(), assignedTo: text('assigned_to'), resolution: text('resolution'),
  requestPayload: text('request_payload').notNull(),
  resolvedBy: text('resolved_by'), resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_eval_review_queue_conversation').on(table.conversationId, table.status, table.createdAt)]);
export const evalPairwiseRound = sqliteTable('eval_pairwise_round', {
  id: text('id').primaryKey(), conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  experimentId: text('experiment_id').notNull().references(() => evalExperiment.id, { onDelete: 'cascade' }),
  caseId: text('case_id').notNull().references(() => evalCase.id), blindSeed: text('blind_seed').notNull(),
  firstOrder: text('first_order').notNull(), firstChoice: text('first_choice'), firstJudgeId: text('first_judge_id'),
  swappedChoice: text('swapped_choice'), swappedJudgeId: text('swapped_judge_id'),
  resolvedWinner: text('resolved_winner'), consistencyStatus: text('consistency_status').notNull(),
  reviewQueueId: text('review_queue_id').references(() => evalReviewQueue.id),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('uq_eval_pairwise_round_case').on(table.experimentId, table.caseId),
  index('idx_eval_pairwise_round_experiment').on(table.experimentId, table.consistencyStatus),
]);

export const autonomousDeliveryRun = sqliteTable('autonomous_delivery_run', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  rootTaskId: text('root_task_id').references(() => task.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  currentStage: text('current_stage').notNull(),
  goalContractJson: text('goal_contract_json').notNull(),
  repairCycle: integer('repair_cycle').notNull(),
  revision: integer('revision').notNull().default(0),
  escalationCode: text('escalation_code'),
  escalationDetail: text('escalation_detail'),
  deliveryBundleJson: text('delivery_bundle_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => [
  index('idx_autonomous_delivery_run_conversation').on(table.conversationId, table.createdAt),
  index('idx_autonomous_delivery_run_reconcile').on(table.status, table.updatedAt),
]);

export const autonomousDeliveryAction = sqliteTable('autonomous_delivery_action', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => autonomousDeliveryRun.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  subjectType: text('subject_type'),
  subjectId: text('subject_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status').notNull(),
  notBefore: text('not_before').notNull(),
  attemptCount: integer('attempt_count').notNull(),
  maxAttempts: integer('max_attempts').notNull(),
  lastFailureCode: text('last_failure_code'),
  lastFailureDetail: text('last_failure_detail'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('uq_autonomous_delivery_action_key').on(table.idempotencyKey),
  index('idx_autonomous_delivery_action_claim').on(table.runId, table.status, table.notBefore, table.createdAt),
]);

export const autonomousDeliveryAttempt = sqliteTable('autonomous_delivery_attempt', {
  id: text('id').primaryKey(),
  actionId: text('action_id').notNull().references(() => autonomousDeliveryAction.id, { onDelete: 'cascade' }),
  attemptNo: integer('attempt_no').notNull(),
  status: text('status').notNull(),
  leaseOwner: text('lease_owner').notNull(),
  leaseExpiresAt: text('lease_expires_at').notNull(),
  heartbeatAt: text('heartbeat_at').notNull(),
  workdirRef: text('workdir_ref'),
  sessionGeneration: integer('session_generation'),
  executionEnvelopeId: text('execution_envelope_id').references(() => executionEnvelope.id),
  failureCode: text('failure_code'),
  failureDetail: text('failure_detail'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
}, (table) => [
  uniqueIndex('uq_autonomous_delivery_attempt_no').on(table.actionId, table.attemptNo),
  index('idx_autonomous_delivery_attempt_lease').on(table.status, table.leaseExpiresAt),
]);

export const autonomousDeliveryReceipt = sqliteTable('autonomous_delivery_receipt', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => autonomousDeliveryRun.id, { onDelete: 'cascade' }),
  actionId: text('action_id').references(() => autonomousDeliveryAction.id, { onDelete: 'cascade' }),
  attemptId: text('attempt_id').references(() => autonomousDeliveryAttempt.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  externalId: text('external_id'),
  status: text('status').notNull(),
  payloadJson: text('payload_json').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  observedAt: text('observed_at').notNull(),
}, (table) => [
  uniqueIndex('uq_autonomous_delivery_receipt_key').on(table.idempotencyKey),
  index('idx_autonomous_delivery_receipt_run').on(table.runId, table.kind, table.observedAt),
]);

export const githubIssueIngress = sqliteTable('github_issue_ingress', {
  id: text('id').primaryKey(),
  deliveryId: text('delivery_id').notNull(),
  repositoryFullName: text('repository_full_name').notNull(),
  issueNumber: integer('issue_number').notNull(),
  issueNodeId: text('issue_node_id').notNull(),
  issueUrl: text('issue_url').notNull(),
  action: text('action').notNull(),
  payloadDigest: text('payload_digest').notNull(),
  conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  deliveryRunId: text('delivery_run_id').notNull().references(() => autonomousDeliveryRun.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  receivedAt: text('received_at').notNull(),
  processedAt: text('processed_at').notNull(),
}, (table) => [
  uniqueIndex('uq_github_issue_ingress_delivery').on(table.deliveryId),
  uniqueIndex('uq_github_issue_ingress_issue').on(table.repositoryFullName, table.issueNumber),
  index('idx_github_issue_ingress_run').on(table.deliveryRunId),
]);
