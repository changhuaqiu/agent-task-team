import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { HumanCommand } from '@/lib/human-command/types';
import type { TeamRuntime } from '@/lib/team-runtime';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { upsertAgent } from '@/server/db/agentQueries';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import {
  HumanCommandIdempotencyConflictError,
  HumanCommandService,
} from './service';

const NOW = new Date('2026-08-16T10:00:00.000Z');

function runtime(agentIds: string[]): TeamRuntime {
  return {
    conversationId: 'delivery-1',
    roster: agentIds.map((id) => ({
      id,
      displayName: id,
      source: 'preset-agent',
      accountIds: [],
      skills: [],
    })),
    explainHandoffBlock: () => undefined,
    initialAgentId: agentIds[0] ?? null,
  };
}

function command(overrides: Partial<HumanCommand> = {}): HumanCommand {
  return {
    type: 'delivery.requirement.submit',
    idempotencyKey: 'requirement-1',
    projectPath: 'C:/projects/example',
    deliveryId: 'delivery-1',
    actor: { type: 'user', id: 'human' },
    content: '实现已确认的交付要求',
    targetAgentIds: ['mario'],
    issuedAt: NOW.toISOString(),
    ...overrides,
  };
}

function planCommand(): Extract<HumanCommand, { type: 'delivery.plan.request' }> {
  return {
    type: 'delivery.plan.request',
    idempotencyKey: 'plan-1',
    projectPath: 'C:/projects/example',
    deliveryId: 'delivery-1',
    actor: { type: 'user', id: 'human' },
    issuedAt: NOW.toISOString(),
  };
}

describe('HumanCommandService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    upsertAgent({
      id: 'mario',
      name: 'Mario',
      roleCardId: 'developer',
      theme: 'red',
      emoji: '🍄',
      isPreset: true,
    });
    conversationRepo.create({
      id: 'delivery-1',
      title: 'Delivery',
      project_path: 'C:/projects/example',
    });
  });

  afterEach(() => resetDb());

  it('atomically records the user fact, A2A possession, Inbox work and receipt', () => {
    const receipt = new HumanCommandService({
      db,
      now: () => NOW,
      idFactory: () => 'receipt-1',
      resolveRuntime: () => runtime(['mario']),
    }).submit(command());

    expect(receipt).toMatchObject({
      status: 'accepted',
      duplicate: false,
      messageId: expect.any(String),
      targetAgentIds: ['mario'],
    });
    expect(db.prepare('SELECT sender_type,content FROM chat_message').get()).toEqual({
      sender_type: 'human',
      content: '实现已确认的交付要求',
    });
    expect(db.prepare('SELECT root_trigger_id,status FROM a2a_possession_chain').get())
      .toEqual({ root_trigger_id: receipt.messageId, status: 'active' });
    expect(db.prepare('SELECT project_agent_id,status FROM agent_inbox_item').get())
      .toEqual({ project_agent_id: 'mario', status: 'enqueued' });
    expect(db.prepare('SELECT idempotency_key FROM human_command_receipt').get())
      .toEqual({ idempotency_key: 'requirement-1' });
  });

  it('returns the persisted receipt for an exact retry without duplicating facts', () => {
    const service = new HumanCommandService({
      db,
      now: () => NOW,
      resolveRuntime: () => runtime(['mario']),
    });
    const first = service.submit(command());
    const duplicate = service.submit(command());

    expect(duplicate).toEqual({ ...first, duplicate: true });
    expect(db.prepare('SELECT COUNT(*) count FROM chat_message').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) count FROM human_command_receipt').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) count FROM agent_inbox_item').get()).toEqual({ count: 1 });
  });

  it('persists a validated reply relation and derives one stable thread root', () => {
    const rootId = db.prepare(`
      INSERT INTO chat_message (
        id,conversation_id,task_id,sender_type,sender_id,content,content_type,
        mentions,intent,metadata,visibility,invocation_id,created_at
      ) VALUES ('root-message','delivery-1',NULL,'agent','mario','原始结论','text',NULL,'general',NULL,'public',NULL,?)
      RETURNING id
    `).get(NOW.toISOString()) as { id: string };
    const service = new HumanCommandService({
      db,
      now: () => NOW,
      resolveRuntime: () => runtime(['mario']),
    });

    const first = service.submit(command({
      idempotencyKey: 'reply-1', content: '第一层回复', replyToMessageId: rootId.id,
    }));
    const second = service.submit(command({
      idempotencyKey: 'reply-2', content: '第二层回复', replyToMessageId: first.messageId,
    }));
    const rows = db.prepare(`
      SELECT id,metadata FROM chat_message WHERE id IN (?,?) ORDER BY created_at,id
    `).all(first.messageId, second.messageId) as Array<{ id: string; metadata: string }>;
    const metadata = rows.map((row) => JSON.parse(row.metadata));

    expect(metadata).toMatchObject([
      { replyToMessageId: 'root-message', threadRootId: 'root-message', replyPreview: '原始结论' },
      { replyToMessageId: first.messageId, threadRootId: 'root-message', replyPreview: '第一层回复' },
    ]);
  });

  it('rejects reusing an idempotency key for a different command', () => {
    const service = new HumanCommandService({
      db,
      now: () => NOW,
      resolveRuntime: () => runtime(['mario']),
    });
    service.submit(command());

    expect(() => service.submit(command({ content: '另一条要求' })))
      .toThrow(HumanCommandIdempotencyConflictError);
    expect(db.prepare('SELECT COUNT(*) count FROM chat_message').get()).toEqual({ count: 1 });
  });

  it('persists a visible rejection without creating a partial user fact', () => {
    const receipt = new HumanCommandService({
      db,
      now: () => NOW,
      resolveRuntime: () => runtime([]),
    }).submit(command({ targetAgentIds: [] }));

    expect(receipt).toMatchObject({
      status: 'rejected',
      reasonCode: 'a2a_no_available_agent',
    });
    expect(db.prepare('SELECT COUNT(*) count FROM chat_message').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) count FROM human_command_receipt').get()).toEqual({ count: 1 });
  });

  it('persists and deduplicates a rejection when the delivery no longer exists', () => {
    const service = new HumanCommandService({
      db,
      now: () => NOW,
      resolveRuntime: () => runtime(['mario']),
    });
    const missing = command({ deliveryId: 'delivery-missing', idempotencyKey: 'missing-1' });

    const first = service.submit(missing);
    const duplicate = service.submit(missing);

    expect(first).toMatchObject({
      status: 'rejected',
      reasonCode: 'human_command_delivery_not_found',
    });
    expect(duplicate).toEqual({ ...first, duplicate: true });
    expect(db.prepare(`
      SELECT conversation_id,idempotency_key FROM human_command_receipt
      WHERE idempotency_key='missing-1'
    `).get()).toEqual({ conversation_id: null, idempotency_key: 'missing-1' });
  });

  it('rolls back a non-offered handoff and persists the rejection receipt', () => {
    const receipt = new HumanCommandService({
      db,
      now: () => NOW,
      resolveRuntime: () => runtime(['mario']),
      handoff: { submit: () => ({ status: 'aborted' as const }) },
    }).submit(command());

    expect(receipt).toMatchObject({
      status: 'rejected',
      reasonCode: 'human_command_handoff_not_offered',
    });
    expect(db.prepare('SELECT COUNT(*) count FROM chat_message').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) count FROM a2a_possession_chain').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) count FROM human_command_receipt').get()).toEqual({ count: 1 });
  });

  it('falls back to the validated roster when the configured initial agent is stale', () => {
    const staleRuntime = runtime(['mario']);
    staleRuntime.initialAgentId = 'removed-agent';

    const receipt = new HumanCommandService({
      db,
      now: () => NOW,
      resolveRuntime: () => staleRuntime,
    }).submit(command({ targetAgentIds: [] }));

    expect(receipt).toMatchObject({
      status: 'accepted',
      targetAgentIds: ['mario'],
    });
    expect(db.prepare('SELECT project_agent_id FROM agent_inbox_item').get())
      .toEqual({ project_agent_id: 'mario' });
  });

  it('rolls back the message when durable handoff creation fails', () => {
    const service = new HumanCommandService({
      db,
      resolveRuntime: () => runtime(['mario']),
      handoff: { submit: () => { throw new Error('inbox unavailable'); } },
    });

    expect(() => service.submit(command())).toThrow('inbox unavailable');
    expect(db.prepare('SELECT COUNT(*) count FROM chat_message').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) count FROM human_command_receipt').get()).toEqual({ count: 0 });
  });

  it('routes planning through one durable Inbox item and receipt', () => {
    const service = new HumanCommandService({
      db,
      now: () => NOW,
      resolveRuntime: () => runtime(['mario']),
    });

    const first = service.submit(planCommand());
    const retry = service.submit(planCommand());

    expect(first).toMatchObject({
      commandType: 'delivery.plan.request',
      status: 'accepted',
      targetAgentIds: ['mario'],
    });
    expect(retry).toEqual({ ...first, duplicate: true });
    expect(db.prepare('SELECT project_agent_id,status,command_json FROM agent_inbox_item').get())
      .toMatchObject({
        project_agent_id: 'mario',
        status: 'enqueued',
        command_json: expect.stringContaining('"contextScenario":"planning"'),
      });
    expect(db.prepare('SELECT COUNT(*) count FROM chat_message').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) count FROM human_command_receipt').get()).toEqual({ count: 1 });
  });

  it('routes a task progress request to the authoritative task owner', () => {
    taskRepo.create({
      id: 'TASK-PROGRESS',
      conversation_id: 'delivery-1',
      title: 'Progress target',
      agent_id: 'mario',
    });
    const receipt = new HumanCommandService({
      db,
      now: () => NOW,
      resolveRuntime: () => runtime(['mario']),
    }).submit({
      type: 'task.progress.request',
      idempotencyKey: 'progress-1',
      projectPath: 'C:/projects/example',
      deliveryId: 'delivery-1',
      taskId: 'TASK-PROGRESS',
      actor: { type: 'user', id: 'human' },
      request: '请汇报当前进度',
      issuedAt: NOW.toISOString(),
    });

    expect(receipt).toMatchObject({
      commandType: 'task.progress.request',
      taskId: 'TASK-PROGRESS',
      targetAgentIds: ['mario'],
      status: 'accepted',
    });
    expect(db.prepare('SELECT project_agent_id,command_json FROM agent_inbox_item').get())
      .toMatchObject({
        project_agent_id: 'mario',
        command_json: expect.stringContaining('"taskId":"TASK-PROGRESS"'),
      });
    expect(db.prepare('SELECT COUNT(*) count FROM invocation').get()).toEqual({ count: 0 });
  });
});
