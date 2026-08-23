import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { WorkspaceCommandService } from './service';

describe('WorkspaceCommandService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  it('creates one delivery and returns the same receipt on replay', async () => {
    const service = new WorkspaceCommandService({
      db,
      now: () => new Date('2026-08-23T08:00:00.000Z'),
      idFactory: () => 'receipt-1',
    });
    const command = {
      type: 'delivery.create' as const,
      idempotencyKey: 'create-delivery-1',
      deliveryId: 'delivery-1',
      projectPath: '',
      actor: { type: 'user' as const, id: 'user-1' },
      issuedAt: '2026-08-23T08:00:00.000Z',
      title: '统一应用层',
      goal: '所有用户操作通过一个命令入口',
      priority: 'p1' as const,
      autonomous: false,
    };

    const accepted = await service.submit(command);
    const replay = await service.submit(command);

    expect(accepted).toMatchObject({ status: 'accepted', duplicate: false, deliveryId: 'delivery-1' });
    expect(replay).toMatchObject({ status: 'accepted', duplicate: true, deliveryId: 'delivery-1' });
    expect(conversationRepo.list()).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) count FROM workspace_command_journal').get()).toEqual({ count: 1 });
  });

  it('keeps a deletion receipt after the aggregate is removed', async () => {
    conversationRepo.create({ id: 'delivery-2', title: '删除目标', project_path: 'C:/repo' });
    const service = new WorkspaceCommandService({ db, idFactory: () => 'receipt-delete' });
    const command = {
      type: 'delivery.delete' as const,
      idempotencyKey: 'delete-delivery-2',
      deliveryId: 'delivery-2',
      projectPath: 'C:/repo',
      actor: { type: 'user' as const, id: 'user-1' },
      issuedAt: '2026-08-23T08:00:00.000Z',
    };

    const accepted = await service.submit(command);
    const replay = await service.submit(command);

    expect(accepted.status).toBe('accepted');
    expect(replay.duplicate).toBe(true);
    expect(conversationRepo.getById('delivery-2')).toBeUndefined();
    expect(db.prepare(`SELECT state FROM workspace_command_journal WHERE idempotency_key='delete-delivery-2'`).get())
      .toEqual({ state: 'final' });
  });

  it('rejects task completion without an authoritative review gate', async () => {
    conversationRepo.create({ id: 'delivery-3', title: '任务目标' });
    db.prepare(`
      INSERT INTO task (
        id,conversation_id,title,status,agent_id,dependencies,artifacts,revision,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run('task-1', 'delivery-3', '实现', 'in_review', 'agent-1', '[]', '[]', 0, '2026-08-23T08:00:00.000Z', '2026-08-23T08:00:00.000Z');
    const service = new WorkspaceCommandService({ db, idFactory: () => 'receipt-task' });

    const receipt = await service.submit({
      type: 'task.transition',
      idempotencyKey: 'complete-task-1',
      deliveryId: 'delivery-3',
      projectPath: '',
      taskId: 'task-1',
      expectedTaskRevision: 0,
      status: 'done',
      actor: { type: 'user', id: 'user-1' },
      issuedAt: '2026-08-23T08:00:00.000Z',
    });

    expect(receipt).toMatchObject({
      status: 'rejected',
      reasonCode: 'task_completion_gate_required',
    });
  });

  it('rejects a task command whose project scope does not match the delivery', async () => {
    conversationRepo.create({ id: 'delivery-4', title: 'Scoped target', project_path: 'C:/correct' });
    const service = new WorkspaceCommandService({ db });

    await expect(service.submit({
      type: 'task.create',
      idempotencyKey: 'wrong-project-task',
      deliveryId: 'delivery-4',
      projectPath: 'C:/other',
      actor: { type: 'user', id: 'user-1' },
      issuedAt: '2026-08-23T08:00:00.000Z',
      task: {
        id: 'task-wrong-scope',
        title: 'Should not exist',
        agentId: 'agent-1',
        dependencies: [],
      },
    })).rejects.toMatchObject({ reasonCode: 'workspace_command_scope_mismatch' });
    expect(db.prepare('SELECT COUNT(*) count FROM task').get()).toEqual({ count: 0 });
  });

  it('does not adopt a pre-existing delivery with different goal under a missing receipt', async () => {
    conversationRepo.create({ id: 'delivery-5', title: 'Existing', goal: 'Original goal' });
    const service = new WorkspaceCommandService({ db });

    await expect(service.submit({
      type: 'delivery.create',
      idempotencyKey: 'conflicting-create',
      deliveryId: 'delivery-5',
      projectPath: '',
      actor: { type: 'user', id: 'user-1' },
      issuedAt: '2026-08-23T08:00:00.000Z',
      title: 'Existing',
      goal: 'Different goal',
      priority: 'p2',
      autonomous: false,
    })).rejects.toMatchObject({ reasonCode: 'workspace_command_delivery_conflict' });
    expect(conversationRepo.getById('delivery-5')?.goal).toBe('Original goal');
  });

  it('keeps create receipts after deletion so an old create intent cannot recreate the delivery', async () => {
    const service = new WorkspaceCommandService({ db });
    const create = {
      type: 'delivery.create' as const,
      idempotencyKey: 'create-then-delete',
      deliveryId: 'delivery-history',
      projectPath: '',
      actor: { type: 'user' as const, id: 'user-1' },
      issuedAt: '2026-08-23T08:00:00.000Z',
      title: 'Historical delivery',
      goal: 'Preserve command history',
      priority: 'p2' as const,
      autonomous: false,
    };
    await service.submit(create);
    await service.submit({
      type: 'delivery.delete',
      idempotencyKey: 'delete-after-create',
      deliveryId: create.deliveryId,
      projectPath: '',
      actor: create.actor,
      issuedAt: '2026-08-23T08:01:00.000Z',
    });

    const replay = await service.submit(create);
    expect(replay).toMatchObject({ status: 'accepted', duplicate: true });
    expect(conversationRepo.getById(create.deliveryId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) count FROM workspace_command_journal').get()).toEqual({ count: 2 });
  });

  it('does not let a concurrent owner execute the same in-flight command', async () => {
    const now = '2026-08-23T08:00:00.000Z';
    const command = {
      type: 'delivery.create' as const,
      idempotencyKey: 'busy-create',
      deliveryId: 'delivery-busy',
      projectPath: '',
      actor: { type: 'user' as const, id: 'user-1' },
      issuedAt: now,
      title: 'Busy delivery',
      goal: 'Only one owner',
      priority: 'p2' as const,
      autonomous: false,
    };
    const canonical = (value: unknown): unknown => Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonical(item)]))
        : value;
    const requestDigest = createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex');
    db.prepare(`
      INSERT INTO workspace_command_journal (
        id,idempotency_key,request_digest,command_type,state,owner_token,
        lease_expires_at,receipt_json,created_at,updated_at
      ) VALUES ('journal-1','busy-create',?,'delivery.create','processing',
        'owner-1','2026-08-23T08:05:00.000Z',NULL,?,?)
    `).run(requestDigest, now, now);
    const service = new WorkspaceCommandService({ db, now: () => new Date(now) });
    await expect(service.submit(command)).rejects.toMatchObject({ reasonCode: 'workspace_command_in_progress' });
    expect(conversationRepo.getById('delivery-busy')).toBeUndefined();
  });

  it('persists work phases through the same scoped command journal', async () => {
    conversationRepo.create({ id: 'delivery-phases', title: 'Phased work', project_path: 'C:/repo' });
    const service = new WorkspaceCommandService({ db, now: () => new Date('2026-08-23T08:00:00.000Z') });
    const receipt = await service.submit({
      type: 'work.phase.upsert',
      idempotencyKey: 'phase-upsert-1',
      deliveryId: 'delivery-phases',
      projectPath: 'C:/repo',
      actor: { type: 'user', id: 'user-1' },
      issuedAt: '2026-08-23T08:00:00.000Z',
      phase: { id: 'phase-1', title: 'Planning', description: '', order: 0, status: 'planned' },
    });
    expect(receipt).toMatchObject({ status: 'accepted', result: { phase: { id: 'phase-1' } } });
    expect(db.prepare('SELECT conversation_id FROM phase WHERE id=?').get('phase-1'))
      .toEqual({ conversation_id: 'delivery-phases' });
  });
});
