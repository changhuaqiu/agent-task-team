import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, getDb, setTestDb, resetDb } from '../db/index';
import { applyMigrations } from '../db/migrate';
import { DEFAULT_RUBRIC_REVISION_ID, EVALUATOR_BUNDLE_REVISION, digest } from '../evaluation/defaults';
import { generateSortableId, resetSeq } from './sortable-id';
import { conversationRepo } from './conversation-repo';
import {
  InvalidTaskTransitionError,
  StaleTaskRevisionError,
  StaleTaskTransitionError,
  taskRepo,
} from './task-repo';
import { messageRepo } from './message-repo';
import { sessionRepo } from './session-repo';
import { invocationRepo } from './invocation-repo';

beforeEach(() => {
  const db = createTestDb();
  setTestDb(db);
  resetSeq();
});
afterEach(() => {
  resetDb();
});
describe('sortable-id', () => {
  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSortableId());
    }
    expect(ids.size).toBe(100);
  });

  it('IDs sort chronologically', () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(generateSortableId());
    }
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('supports prefix', () => {
    const id = generateSortableId('msg');
    expect(id.startsWith('msg-')).toBe(true);
  });

  it('resetSeq resets the counter', () => {
    const a = generateSortableId();
    resetSeq();
    const b = generateSortableId();
    expect(a).not.toBe(b);
  });
});

describe('conversation-repo', () => {
  it('creates and retrieves a conversation', () => {
    const conv = conversationRepo.create({ id: 'conv-1', title: 'Test Conv', goal: 'Build stuff' });
    expect(conv.id).toBe('conv-1');
    expect(conv.title).toBe('Test Conv');
    expect(conv.goal).toBe('Build stuff');
    expect(conv.status).toBe('active');
    expect(conv.priority).toBe('p2');

    const fetched = conversationRepo.getById('conv-1');
    expect(fetched).toBeDefined();
    expect(fetched!.title).toBe('Test Conv');
  });

  it('lists conversations ordered by updated_at DESC', () => {
    conversationRepo.create({ id: 'conv-1', title: 'First' });
    conversationRepo.create({ id: 'conv-2', title: 'Second' });
    conversationRepo.update('conv-1', { title: 'Updated First' });
    const list = conversationRepo.list();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('conv-1');
  });

  it('updates a conversation', () => {
    conversationRepo.create({ id: 'conv-1', title: 'Original' });
    conversationRepo.update('conv-1', { title: 'Updated', status: 'archived' });
    const updated = conversationRepo.getById('conv-1')!;
    expect(updated.title).toBe('Updated');
    expect(updated.status).toBe('archived');
  });

  it('deletes a conversation', () => {
    conversationRepo.create({ id: 'conv-1', title: 'To Delete' });
    conversationRepo.delete('conv-1');
    expect(conversationRepo.getById('conv-1')).toBeUndefined();
  });

  it('migrates and deletes legacy global-dataset annotations through their project run', () => {
    conversationRepo.create({ id: 'conv-legacy-annotation', title: 'Legacy annotation owner' });
    const db = getDb();
    const timestamp = '2020-01-01T00:00:00.000Z';
    db.exec('DROP TRIGGER trg_eval_annotation_conversation_insert');
    db.prepare(`INSERT INTO eval_dataset
      (id,conversation_id,name,description,revision,status,created_by,created_at,updated_at)
      VALUES ('dataset-global-legacy',NULL,'Global legacy','Historical shared set',1,'active','system',?,?)`)
      .run(timestamp, timestamp);
    db.prepare(`INSERT INTO eval_case
      (id,dataset_id,case_key,split,source_type,input_payload,expected_labels,metadata,content_hash,
       redaction_status,created_at)
      VALUES ('case-global-legacy','dataset-global-legacy','legacy-1','tune','manual','{}','{}','{}',
        'legacy-hash','redacted',?)`).run(timestamp);
    db.prepare(`INSERT INTO eval_subject_snapshot
      (id,conversation_id,mode,evidence_cutoff_at,collected_at,snapshot_hash,evidence_refs,evidence_payload,
       app_manifest,data_quality,task_type,difficulty,language)
      VALUES ('snapshot-legacy-annotation','conv-legacy-annotation','online',?,?,'legacy-snapshot-hash',
        '[]','{}','{}','{"coverage":1,"missing":[],"truncated":[]}','coding','unknown','unknown')`)
      .run(timestamp, timestamp);
    db.prepare(`INSERT INTO eval_run
      (id,conversation_id,snapshot_id,rubric_revision_id,mode,idempotency_key,status,gate_status,
       evidence_coverage,evaluator_bundle_digest,created_at,updated_at)
      VALUES ('run-legacy-annotation','conv-legacy-annotation','snapshot-legacy-annotation',?,'online',
        'legacy-annotation-run','partial','unknown',1,?,?,?)`)
      .run(DEFAULT_RUBRIC_REVISION_ID, digest(EVALUATOR_BUNDLE_REVISION), timestamp, timestamp);
    db.prepare(`INSERT INTO eval_annotation
      (id,conversation_id,case_id,run_id,rubric_revision_id,reviewer_id,dimension_key,label,rationale,status,created_at)
      VALUES ('annotation-legacy-migrate',NULL,'case-global-legacy','run-legacy-annotation',?,
        'legacy-reviewer','correctness','partial','Historical row','submitted',?)`)
      .run(DEFAULT_RUBRIC_REVISION_ID, timestamp);
    db.prepare('DELETE FROM _schema_version WHERE version=77').run();

    applyMigrations(db);
    expect(db.prepare("SELECT conversation_id FROM eval_annotation WHERE id='annotation-legacy-migrate'").get())
      .toEqual({ conversation_id: 'conv-legacy-annotation' });

    db.prepare(`INSERT INTO eval_annotation
      (id,conversation_id,case_id,run_id,rubric_revision_id,reviewer_id,dimension_key,label,rationale,status,created_at)
      VALUES ('annotation-legacy-cleanup',NULL,'case-global-legacy','run-legacy-annotation',?,
        'legacy-reviewer-2','correctness','partial','Unmigrated historical row','submitted',?)`)
      .run(DEFAULT_RUBRIC_REVISION_ID, timestamp);
    expect(conversationRepo.deleteAggregate('conv-legacy-annotation')).toBe(true);
    expect(conversationRepo.getById('conv-legacy-annotation')).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) count FROM eval_annotation WHERE run_id='run-legacy-annotation'").get())
      .toEqual({ count: 0 });
  });

  it('returns undefined for missing conversation', () => {
    expect(conversationRepo.getById('nonexistent')).toBeUndefined();
  });
});

describe('task-repo', () => {
  beforeEach(() => {
    conversationRepo.create({ id: 'conv-1', title: 'Parent' });
  });

  it('creates and retrieves a task', () => {
    const task = taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'Implement X',
      agent_id: 'agent-a',
    });
    expect(task.id).toBe('task-1');
    expect(task.status).toBe('ready');
    expect(task.agent_id).toBe('agent-a');
  });

  it('gets tasks by conversation', () => {
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'T1', agent_id: 'a' });
    taskRepo.create({ id: 'task-2', conversation_id: 'conv-1', title: 'T2', agent_id: 'b' });
    const tasks = taskRepo.getByConversation('conv-1');
    expect(tasks.length).toBe(2);
  });

  it('transitions task status through the canonical state machine', () => {
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'T1', agent_id: 'a' });
    taskRepo.transition('task-1', { to: 'in_progress', expectedFrom: 'ready' });
    expect(taskRepo.getById('task-1')!.status).toBe('in_progress');
  });

  it('records review notes on valid review transitions', () => {
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'T1', agent_id: 'a' });
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'in_review' });
    taskRepo.transition('task-1', { to: 'done', reviewNote: 'LGTM' });
    const task = taskRepo.getById('task-1')!;
    expect(task.status).toBe('done');
    expect(task.review_note).toBe('LGTM');
  });

  it('rejects a transition that bypasses the review gate', () => {
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'T1', agent_id: 'a' });

    expect(() => taskRepo.transition('task-1', { to: 'done' }))
      .toThrow(InvalidTaskTransitionError);
    expect(taskRepo.getById('task-1')!.status).toBe('ready');
  });

  it('fences a transition calculated from stale task facts', () => {
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'T1', agent_id: 'a' });
    taskRepo.transition('task-1', { to: 'in_progress', expectedFrom: 'ready' });

    expect(() => taskRepo.transition('task-1', { to: 'blocked', expectedFrom: 'ready' }))
      .toThrow(StaleTaskTransitionError);
    expect(taskRepo.getById('task-1')!.status).toBe('in_progress');
  });

  it('advances an explicit revision and rejects a stale revision CAS', () => {
    const created = taskRepo.create({
      id: 'task-revision',
      conversation_id: 'conv-1',
      title: 'Revision',
      agent_id: 'a',
    });
    const progressed = taskRepo.transition(created.id, {
      to: 'in_progress',
      expectedFrom: 'ready',
      expectedRevision: created.revision,
    })!;

    expect(progressed.revision).toBe(created.revision + 1);
    expect(() => taskRepo.transition(created.id, {
      to: 'blocked',
      expectedFrom: 'in_progress',
      expectedRevision: created.revision,
    })).toThrow(StaleTaskRevisionError);
  });

  it('foreign key prevents deleting conversation with tasks', () => {
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'T1', agent_id: 'a' });
    expect(() => conversationRepo.delete('conv-1')).toThrow();
    expect(taskRepo.getById('task-1')).toBeDefined();
  });

  it('stores dependencies as JSON', () => {
    const task = taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'a',
      dependencies: ['dep-1', 'dep-2'],
    });
    expect(task.dependencies).toBe('["dep-1","dep-2"]');
  });
});

describe('message-repo', () => {
  beforeEach(() => {
    conversationRepo.create({ id: 'conv-1', title: 'Test' });
  });

  it('appends a message and returns ID', () => {
    const id = messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'user-1',
      content: 'Hello world',
    });
    expect(id).toBeTruthy();
    expect(id.startsWith('msg-')).toBe(true);
  });

  it('gets messages by conversation', () => {
    messageRepo.append({ conversationId: 'conv-1', senderType: 'human', senderId: 'u1', content: 'Msg 1' });
    messageRepo.append({ conversationId: 'conv-1', senderType: 'agent', senderId: 'a1', content: 'Msg 2' });
    const msgs = messageRepo.getByConversation('conv-1');
    expect(msgs.length).toBe(2);
    expect(msgs[0].content).toBe('Msg 1');
    expect(msgs[1].content).toBe('Msg 2');
  });

  it('paginates with cursor', () => {
    const id1 = messageRepo.append({ conversationId: 'conv-1', senderType: 'human', senderId: 'u1', content: 'A' });
    const id2 = messageRepo.append({ conversationId: 'conv-1', senderType: 'human', senderId: 'u1', content: 'B' });
    messageRepo.append({ conversationId: 'conv-1', senderType: 'human', senderId: 'u1', content: 'C' });

    const page = messageRepo.getByConversation('conv-1', { cursor: id1, limit: 1 });
    expect(page.length).toBe(1);
    expect(page[0].id).toBe(id2);
  });

  it('gets private history by conversation and agent in chronological order', () => {
    conversationRepo.create({ id: 'conv-2', title: 'Other' });
    messageRepo.append({ conversationId: 'conv-1', senderType: 'agent', senderId: 'agent-a', content: 'First' });
    messageRepo.append({ conversationId: 'conv-1', senderType: 'agent', senderId: 'agent-b', content: 'Other agent' });
    messageRepo.append({ conversationId: 'conv-1', senderType: 'agent', senderId: 'agent-a', content: 'Second' });
    messageRepo.append({ conversationId: 'conv-2', senderType: 'agent', senderId: 'agent-a', content: 'Other project' });
    expect(messageRepo.getByConversationAgent('conv-1', 'agent-a').map((row) => row.content)).toEqual(['First', 'Second']);
  });

  it('round-trips mentions as JSON', () => {
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'u1',
      content: '@agent-a please review',
      mentions: ['agent-a'],
    });
    const msgs = messageRepo.getByConversation('conv-1');
    expect(JSON.parse(msgs[0].mentions!)).toEqual(['agent-a']);
  });

  it('round-trips metadata as JSON', () => {
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'a1',
      content: 'result',
      metadata: { tokens: 42, model: 'gpt-4' },
    });
    const msgs = messageRepo.getByConversation('conv-1');
    expect(JSON.parse(msgs[0].metadata!)).toEqual({ tokens: 42, model: 'gpt-4' });
  });
});

describe('session-repo', () => {
  beforeEach(() => {
    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'T1', agent_id: 'agent-a' });
  });

  it('creates and finds an active session', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    const found = sessionRepo.findActive('agent-a', 'task-1');
    expect(found).toBeDefined();
    expect(found!.id).toBe('ses-1');
    expect(found!.status).toBe('active');
  });

  it('returns undefined when no active session', () => {
    expect(sessionRepo.findActive('agent-a', 'task-1')).toBeUndefined();
  });

  it('increments message count', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    sessionRepo.incrementMessageCount('ses-1');
    sessionRepo.incrementMessageCount('ses-1');
    expect(sessionRepo.getById('ses-1')!.message_count).toBe(2);
  });

  it('seals a session', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    sessionRepo.seal('ses-1', 'task completed');
    const sealed = sessionRepo.getById('ses-1')!;
    expect(sealed.status).toBe('sealed');
    expect(sealed.seal_reason).toBe('task completed');
    expect(sealed.sealed_at).toBeTruthy();
  });

  it('findActive returns undefined after sealing', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    sessionRepo.seal('ses-1', 'done');
    expect(sessionRepo.findActive('agent-a', 'task-1')).toBeUndefined();
  });

  it('lists active sessions by conversation', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    const active = sessionRepo.listActiveByConversation('conv-1');
    expect(active.length).toBe(1);
  });

  it('enforces unique constraint on (agent_id, task_id, seq)', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 0 });
    expect(() => {
      sessionRepo.create({ id: 'ses-2', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 0 });
    }).toThrow();
  });

  it('allows a new sequence after the prior project session is sealed', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 0 });
    sessionRepo.seal('ses-1', 'rotated');
    const ses2 = sessionRepo.create({ id: 'ses-2', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 1 });
    expect(ses2.id).toBe('ses-2');
  });

  it('keeps one active logical session per project and agent', () => {
    const first = sessionRepo.getOrCreateActive({
      id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 0,
    });
    const again = sessionRepo.getOrCreateActive({
      id: 'ses-2', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 1,
    });
    expect(again.id).toBe(first.id);
    expect(sessionRepo.listActiveByConversation('conv-1')).toHaveLength(1);
  });

  it('binds runtime identity once and rejects replacement', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    expect(sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-1')).toEqual({
      status: 'bound', current: 'runtime-1',
    });
    expect(sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-1')).toEqual({
      status: 'unchanged', current: 'runtime-1',
    });
    expect(sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-2')).toEqual({
      status: 'mismatch', current: 'runtime-1',
    });
  });

  it('releases a failed unconfirmed runtime binding but not an unobserved binding', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-unconfirmed');

    expect(sessionRepo.releaseUnconfirmedRuntimeSessionId('ses-1', 'runtime-unconfirmed')).toBe(false);

    invocationRepo.create({
      id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a', session_id: 'ses-1',
    });
    invocationRepo.transition('inv-1', {
      to: 'terminated',
      outcome: 'cancelled',
      reason_code: 'acp_cancelled',
    });

    expect(sessionRepo.releaseUnconfirmedRuntimeSessionId('ses-1', 'runtime-unconfirmed')).toBe(true);
    expect(sessionRepo.getById('ses-1')?.cli_session_id).toBeNull();
  });

  it('seals a confirmed generation only when its latest invocation is a persisted ACP load failure', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    invocationRepo.create({
      id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a', session_id: 'ses-1',
    });
    sessionRepo.confirmRuntimeSessionId('ses-1', 'runtime-confirmed', 'inv-1');
    invocationRepo.create({
      id: 'inv-2', conversation_id: 'conv-1', agent_id: 'agent-a', session_id: 'ses-1',
    });
    invocationRepo.transition('inv-2', {
      to: 'terminated',
      outcome: 'failed',
      reason_code: 'acp_session_load_failed',
    });

    expect(sessionRepo.sealIfLatestInvocationLoadFailed('ses-1')).toBe(true);
    expect(sessionRepo.getById('ses-1')).toMatchObject({
      status: 'sealed',
      seal_reason: 'runtime_session_load_failed',
      cli_session_id: 'runtime-confirmed',
    });
    expect(sessionRepo.getOrCreateActive({
      id: 'ses-2', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 1,
    }).id).toBe('ses-2');
  });

  it('keeps a generation when the latest failure is unrelated to session loading', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-confirmed');
    invocationRepo.create({
      id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a', session_id: 'ses-1',
    });
    invocationRepo.transition('inv-1', {
      to: 'terminated',
      outcome: 'timed_out',
      reason_code: 'acp_timeout',
    });

    expect(sessionRepo.sealIfLatestInvocationLoadFailed('ses-1')).toBe(false);
    expect(sessionRepo.getById('ses-1')?.status).toBe('active');
  });

  it('backfills a compatible legacy generation from its latest successful invocation', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      session_id: 'ses-1',
      engine: 'codex',
      account_id: 'account-openai',
    });
    sessionRepo.confirmRuntimeSessionId('ses-1', 'codex-session', 'inv-1');
    invocationRepo.transition('inv-1', { to: 'terminated', outcome: 'completed' });

    expect(sessionRepo.sealIfExecutionProfileChanged('ses-1', {
      engine: 'codex',
      runtimeId: 'codex-cli',
      accountId: 'account-openai',
    })).toBe(false);
    expect(sessionRepo.getById('ses-1')).toMatchObject({
      status: 'active',
      engine: 'codex',
      runtime_id: 'codex-cli',
      account_id: 'account-openai',
    });
  });

  it('treats blank and absent account ids as the same execution profile', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
      executionProfile: {
        engine: 'codex',
        runtimeId: 'codex-cli',
      },
    });

    expect(sessionRepo.sealIfExecutionProfileChanged('ses-1', {
      engine: 'codex',
      runtimeId: 'codex-cli',
      accountId: '',
    })).toBe(false);
    expect(sessionRepo.getById('ses-1')?.status).toBe('active');
  });

  it('seals a Codex generation before Claude can load its runtime session id', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      session_id: 'ses-1',
      engine: 'codex',
      account_id: 'account-openai',
    });
    sessionRepo.confirmRuntimeSessionId('ses-1', 'codex-session', 'inv-1');
    invocationRepo.transition('inv-1', { to: 'terminated', outcome: 'completed' });

    expect(sessionRepo.sealIfExecutionProfileChanged('ses-1', {
      engine: 'claude',
      runtimeId: 'claude-cli',
      accountId: 'account-anthropic',
    })).toBe(true);
    expect(sessionRepo.getById('ses-1')).toMatchObject({
      status: 'sealed',
      seal_reason: 'runtime_profile_changed',
      cli_session_id: 'codex-session',
    });
  });

  it.each([
    {
      label: 'runtime',
      next: { engine: 'codex', runtimeId: 'codex-remote', accountId: 'account-openai' },
    },
    {
      label: 'account',
      next: { engine: 'codex', runtimeId: 'codex-cli', accountId: 'account-other' },
    },
  ])('seals an established generation when its $label changes', ({ next }) => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
      executionProfile: {
        engine: 'codex',
        runtimeId: 'codex-cli',
        accountId: 'account-openai',
      },
    });

    expect(sessionRepo.sealIfExecutionProfileChanged('ses-1', next)).toBe(true);
    expect(sessionRepo.getById('ses-1')).toMatchObject({
      status: 'sealed',
      seal_reason: 'runtime_profile_changed',
    });
  });

  it('keeps session binding and invocation outcome under separate owners', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    invocationRepo.create({
      id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a', session_id: 'ses-1',
    });

    expect(sessionRepo.confirmRuntimeSessionId('ses-1', 'runtime-confirmed', 'inv-1')).toEqual({
      status: 'bound', current: 'runtime-confirmed',
    });
    expect(sessionRepo.getById('ses-1')?.cli_session_id).toBe('runtime-confirmed');
    expect(invocationRepo.getById('inv-1')).toMatchObject({
      status: 'planned',
      outcome: null,
    });
    invocationRepo.transition('inv-1', {
      to: 'terminated',
      outcome: 'completed',
      exit_code: 0,
      cli_session_id: 'runtime-confirmed',
    });
    expect(invocationRepo.getById('inv-1')).toMatchObject({
      status: 'terminated',
      outcome: 'completed',
      exit_code: 0,
      cli_session_id: 'runtime-confirmed',
    });
    expect(sessionRepo.releaseUnconfirmedRuntimeSessionId('ses-1', 'runtime-confirmed')).toBe(false);
  });

  it('does not confirm an invocation when runtime identity mismatches', () => {
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-confirmed');
    invocationRepo.create({
      id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a', session_id: 'ses-1',
    });

    expect(sessionRepo.confirmRuntimeSessionId('ses-1', 'runtime-other', 'inv-1')).toEqual({
      status: 'mismatch', current: 'runtime-confirmed',
    });
    expect(invocationRepo.getById('inv-1')?.status).toBe('planned');
  });

  it('keeps a two-project by two-agent identity matrix stable for three turns', () => {
    conversationRepo.create({ id: 'conv-2', title: 'Test 2' });
    const bindings = new Map<string, string>();

    for (const projectId of ['conv-1', 'conv-2']) {
      for (const agentId of ['agent-a', 'agent-b']) {
        const key = `${projectId}:${agentId}`;
        for (let turn = 0; turn < 3; turn += 1) {
          const logical = sessionRepo.getOrCreateActive({
            id: `ses-${projectId}-${agentId}-${turn}`,
            conversationId: projectId,
            agentId,
            taskId: `task-${projectId}-${turn}`,
            seq: turn,
          });
          const runtimeId = `runtime-${projectId}-${agentId}`;
          sessionRepo.bindRuntimeSessionId(logical.id, runtimeId);
          expect(sessionRepo.getById(logical.id)?.cli_session_id).toBe(runtimeId);
          bindings.set(key, runtimeId);
        }
      }
    }

    expect(bindings.size).toBe(4);
    expect(new Set(bindings.values()).size).toBe(4);
  });
});

describe('invocation-repo', () => {
  beforeEach(() => {
    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'T1', agent_id: 'agent-a' });
  });

  it('creates an invocation with planned status and no outcome', () => {
    const inv = invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      task_id: 'task-1',
    });
    expect(inv.status).toBe('planned');
    expect(inv.outcome).toBeNull();
    expect(inv.agent_id).toBe('agent-a');
  });

  it('transitions lifecycle independently from a completed outcome', () => {
    invocationRepo.create({ id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a' });
    invocationRepo.transition('inv-1', { to: 'starting', expectedFrom: 'planned' });
    invocationRepo.transition('inv-1', { to: 'running', expectedFrom: 'starting' });
    expect(invocationRepo.getById('inv-1')!.status).toBe('running');

    invocationRepo.transition('inv-1', {
      to: 'terminated',
      expectedFrom: 'running',
      outcome: 'completed',
      exit_code: 0,
    });
    const inv = invocationRepo.getById('inv-1')!;
    expect(inv.status).toBe('terminated');
    expect(inv.outcome).toBe('completed');
    expect(inv.exit_code).toBe(0);
  });

  it('records failure with error message', () => {
    invocationRepo.create({ id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a' });
    invocationRepo.transition('inv-1', {
      to: 'terminated',
      outcome: 'failed',
      exit_code: 1,
      error_message: 'OOM',
    });
    const inv = invocationRepo.getById('inv-1')!;
    expect(inv.status).toBe('terminated');
    expect(inv.outcome).toBe('failed');
    expect(inv.error_message).toBe('OOM');
  });

  it('gets invocations by agent', () => {
    invocationRepo.create({ id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a' });
    invocationRepo.create({ id: 'inv-2', conversation_id: 'conv-1', agent_id: 'agent-b' });
    const invs = invocationRepo.getByAgent('agent-a');
    expect(invs.length).toBe(1);
    expect(invs[0].id).toBe('inv-1');
  });

  it('gets invocations by conversation', () => {
    invocationRepo.create({ id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a' });
    const invs = invocationRepo.getByConversation('conv-1');
    expect(invs.length).toBe(1);
  });

  it('requires retry to create a new invocation identity', () => {
    invocationRepo.create({ id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a' });
    invocationRepo.transition('inv-1', { to: 'starting' });
    invocationRepo.transition('inv-1', {
      to: 'terminated',
      outcome: 'failed',
      exit_code: 1,
    });
    expect(() => invocationRepo.transition('inv-1', { to: 'running' })).toThrow();

    invocationRepo.create({ id: 'inv-2', conversation_id: 'conv-1', agent_id: 'agent-a' });
    invocationRepo.transition('inv-2', { to: 'starting' });
    invocationRepo.transition('inv-2', { to: 'running' });
    expect(invocationRepo.getById('inv-2')!.status).toBe('running');
  });

  it('stores optional fields', () => {
    const inv = invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      engine: 'opencode',
      account_id: 'acct-1',
      prompt: 'Fix the bug',
      session_id: 'ses-1',
    });
    expect(inv.engine).toBe('opencode');
    expect(inv.account_id).toBe('acct-1');
    expect(inv.prompt).toBe('Fix the bug');
    expect(inv.session_id).toBe('ses-1');
  });
});
