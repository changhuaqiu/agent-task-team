import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { applyMigrations } from '@/server/db/migrate';
import { resetSeq } from '@/server/repositories/sortable-id';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { messageRepo } from '@/server/repositories/message-repo';
import {
  InvalidTaskGraphError,
  StaleTaskGraphRevisionError,
  taskGraphRepo,
  type TaskActionRow,
} from '@/server/repositories/task-graph-repo';

let db: DatabaseType;

function createConversation() {
  return conversationRepo.create({ id: 'conv-1', title: 'Group Chat Flow' });
}

function createTask(id: string, title = id, agentId = 'planner') {
  return taskRepo.create({
    id,
    conversation_id: 'conv-1',
    title,
    agent_id: agentId,
  });
}

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  resetSeq();
  createConversation();
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('task graph migrations', () => {
  it('creates task graph tables', () => {
    const rows = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name IN (
          'task_action', 'task_edge', 'task_artifact_ref', 'chat_task_binding',
          'task_graph_revision'
        )
      ORDER BY name ASC
    `).all() as { name: string }[];

    expect(rows.map((row) => row.name)).toEqual([
      'chat_task_binding',
      'task_action',
      'task_artifact_ref',
      'task_edge',
      'task_graph_revision',
    ]);
  });

  it('backfills existing tasks as created actions during migration', () => {
    const legacyDb = new Database(':memory:');
    try {
      legacyDb.exec(`
        CREATE TABLE _schema_version (version INTEGER PRIMARY KEY);
        INSERT INTO _schema_version (version) VALUES (17);
        CREATE TABLE conversation (
          id TEXT PRIMARY KEY,
          title TEXT,
          goal TEXT,
          status TEXT,
          priority TEXT,
          project_path TEXT,
          participants TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE task (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversation(id),
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          dependencies TEXT,
          artifacts TEXT,
          review_note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE agent_session (
          id TEXT PRIMARY KEY,
          cli_session_id TEXT,
          conversation_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          seq INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          context_health TEXT,
          usage_snapshot TEXT,
          message_count INTEGER NOT NULL DEFAULT 0,
          seal_reason TEXT,
          created_at TEXT NOT NULL,
          sealed_at TEXT,
          UNIQUE(agent_id, task_id, seq)
        );
      `);
      legacyDb.prepare('INSERT INTO conversation (id, created_at, updated_at) VALUES (?, ?, ?)')
        .run('legacy-conv', '2026-05-15T00:00:00.000Z', '2026-05-15T00:00:00.000Z');
      legacyDb.prepare(`
        INSERT INTO task (id, conversation_id, title, status, agent_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('legacy-task', 'legacy-conv', '旧任务', 'pending', 'planner', '2026-05-15T00:01:00.000Z', '2026-05-15T00:01:00.000Z');

      applyMigrations(legacyDb);

      const action = legacyDb.prepare('SELECT * FROM task_action WHERE id = ?')
        .get('task-action-migrated-legacy-task') as TaskActionRow;
      expect(action.type).toBe('task.created');
      expect(JSON.parse(action.task_ids)).toEqual(['legacy-task']);
      expect(JSON.parse(action.payload)).toMatchObject({ migrated: 1, title: '旧任务' });
    } finally {
      legacyDb.close();
    }
  });
});

describe('taskGraphRepo atomic commit', () => {
  it('commits tasks, dependency edges and revision as one graph change', () => {
    const committed = taskGraphRepo.commit({
      conversationId: 'conv-1',
      expectedRevision: 0,
      idempotencyKey: 'graph-1',
      actorId: 'planner',
      actorType: 'agent',
      tasks: [
        { id: 'task-foundation', title: 'Foundation', agent_id: 'builder' },
        {
          id: 'task-ui',
          title: 'UI',
          agent_id: 'frontend',
          dependencies: ['task-foundation'],
        },
      ],
    });

    expect(committed).toMatchObject({
      revision: 1,
      tasks: [{ id: 'task-foundation' }, { id: 'task-ui' }],
      edges: [{
        from_task_id: 'task-ui',
        to_task_id: 'task-foundation',
        type: 'depends_on',
      }],
      action: { type: 'task.split' },
    });
    expect(taskGraphRepo.revision('conv-1')).toBe(1);
    expect(taskGraphRepo.commit({
      conversationId: 'conv-1',
      expectedRevision: 0,
      idempotencyKey: 'graph-1',
      actorId: 'planner',
      actorType: 'agent',
      tasks: [
        { id: 'task-foundation', title: 'Foundation', agent_id: 'builder' },
        {
          id: 'task-ui',
          title: 'UI',
          agent_id: 'frontend',
          dependencies: ['task-foundation'],
        },
      ],
    })).toMatchObject({
      revision: 1,
      action: { id: committed.action.id },
    });
    taskRepo.update('task-foundation', { title: 'Changed later' });
    expect(taskGraphRepo.commit({
      conversationId: 'conv-1',
      expectedRevision: 0,
      idempotencyKey: 'graph-1',
      actorId: 'planner',
      actorType: 'agent',
      tasks: [
        { id: 'task-foundation', title: 'Foundation', agent_id: 'builder' },
        {
          id: 'task-ui',
          title: 'UI',
          agent_id: 'frontend',
          dependencies: ['task-foundation'],
        },
      ],
    }).tasks[0]).toMatchObject({
      id: 'task-foundation',
      title: 'Foundation',
      revision: 0,
    });
  });

  it('rolls back the whole graph on missing dependencies or cycles', () => {
    expect(() => taskGraphRepo.commit({
      conversationId: 'conv-1',
      expectedRevision: 0,
      idempotencyKey: 'graph-missing',
      actorId: 'planner',
      actorType: 'agent',
      tasks: [{
        id: 'task-orphan',
        title: 'Orphan',
        agent_id: 'builder',
        dependencies: ['task-missing'],
      }],
    })).toThrow(InvalidTaskGraphError);
    expect(taskRepo.getByConversation('conv-1')).toEqual([]);
    expect(taskGraphRepo.revision('conv-1')).toBe(0);

    expect(() => taskGraphRepo.commit({
      conversationId: 'conv-1',
      expectedRevision: 0,
      idempotencyKey: 'graph-cycle',
      actorId: 'planner',
      actorType: 'agent',
      tasks: [
        { id: 'task-a', title: 'A', agent_id: 'a', dependencies: ['task-b'] },
        { id: 'task-b', title: 'B', agent_id: 'b', dependencies: ['task-a'] },
      ],
    })).toThrow(InvalidTaskGraphError);
    expect(taskRepo.getByConversation('conv-1')).toEqual([]);
  });

  it('rejects a concurrent writer with stale graph revision', () => {
    taskGraphRepo.commit({
      conversationId: 'conv-1',
      expectedRevision: 0,
      idempotencyKey: 'graph-a',
      actorId: 'planner',
      actorType: 'agent',
      tasks: [{ id: 'task-a', title: 'A', agent_id: 'a' }],
    });

    expect(() => taskGraphRepo.commit({
      conversationId: 'conv-1',
      expectedRevision: 0,
      idempotencyKey: 'graph-b',
      actorId: 'other-planner',
      actorType: 'agent',
      tasks: [{ id: 'task-b', title: 'B', agent_id: 'b' }],
    })).toThrow(StaleTaskGraphRevisionError);
    expect(taskRepo.getById('task-b')).toBeUndefined();
  });

  it('replays the original mutation result after later graph revisions', () => {
    const firstInput = {
      conversationId: 'conv-1',
      expectedRevision: 0,
      idempotencyKey: 'mutation-first',
      operation: 'record_marker',
      request: { marker: 'first' },
      execute: () => {
        const action = taskGraphRepo.appendAction({
          conversationId: 'conv-1',
          actorId: 'planner',
          actorType: 'agent' as const,
          type: 'task.created' as const,
          payload: { marker: 'first' },
        });
        return { actionId: action.id, result: { marker: 'first', actionId: action.id } };
      },
    };
    const first = taskGraphRepo.mutate(firstInput);
    taskGraphRepo.mutate({
      conversationId: 'conv-1',
      expectedRevision: 1,
      idempotencyKey: 'mutation-second',
      operation: 'record_marker',
      request: { marker: 'second' },
      execute: () => {
        const action = taskGraphRepo.appendAction({
          conversationId: 'conv-1',
          actorId: 'planner',
          actorType: 'agent',
          type: 'task.created',
          payload: { marker: 'second' },
        });
        return { actionId: action.id, result: { marker: 'second', actionId: action.id } };
      },
    });

    expect(taskGraphRepo.mutate(firstInput)).toEqual({
      revision: 1,
      result: first.result,
      replayed: true,
    });
    expect(taskGraphRepo.revision('conv-1')).toBe(2);
  });
});

describe('taskGraphRepo actions and graph view', () => {
  it('records structured task actions without relying on chat text', () => {
    createTask('task-root', 'A2A group chat refactor');

    const action = taskGraphRepo.appendAction({
      conversationId: 'conv-1',
      actorId: 'planner',
      actorType: 'agent',
      type: 'task.created',
      taskIds: ['task-root'],
      payload: { title: 'A2A group chat refactor' },
    });

    expect(action.id).toMatch(/^task-action-/);
    expect(JSON.parse(action.task_ids)).toEqual(['task-root']);
    expect(JSON.parse(action.payload)).toEqual({ title: 'A2A group chat refactor' });

    const graph = taskGraphRepo.getGraph('conv-1');
    expect(graph.tasks.map((task) => task.id)).toEqual(['task-root']);
    expect(graph.actions.map((item) => item.id)).toEqual([action.id]);
  });

  it('creates split edges and rejects subtask cycles', () => {
    createTask('task-root', 'Root');
    createTask('task-ui', 'Chat UI');
    createTask('task-model', 'Task model');

    const split = taskGraphRepo.appendAction({
      conversationId: 'conv-1',
      actorId: 'planner',
      actorType: 'agent',
      type: 'task.split',
      taskIds: ['task-root', 'task-ui', 'task-model'],
    });

    taskGraphRepo.addEdge({
      conversationId: 'conv-1',
      fromTaskId: 'task-ui',
      toTaskId: 'task-root',
      type: 'subtask_of',
      createdByActionId: split.id,
    });
    taskGraphRepo.addEdge({
      conversationId: 'conv-1',
      fromTaskId: 'task-model',
      toTaskId: 'task-root',
      type: 'subtask_of',
      createdByActionId: split.id,
    });

    expect(taskGraphRepo.listEdges('conv-1').map((edge) => [edge.from_task_id, edge.to_task_id])).toEqual([
      ['task-ui', 'task-root'],
      ['task-model', 'task-root'],
    ]);
    expect(() => taskGraphRepo.addEdge({
      conversationId: 'conv-1',
      fromTaskId: 'task-root',
      toTaskId: 'task-ui',
      type: 'subtask_of',
      createdByActionId: split.id,
    })).toThrow(/cycle/);
  });

  it('models dependency waiting and rejects dependency cycles', () => {
    createTask('task-contract', 'Contract');
    createTask('task-ui', 'UI');

    const action = taskGraphRepo.appendAction({
      conversationId: 'conv-1',
      actorId: 'planner',
      actorType: 'agent',
      type: 'task.status_changed',
      taskIds: ['task-contract', 'task-ui'],
    });

    taskGraphRepo.addEdge({
      conversationId: 'conv-1',
      fromTaskId: 'task-contract',
      toTaskId: 'task-ui',
      type: 'depends_on',
      createdByActionId: action.id,
    });

    expect(() => taskGraphRepo.addEdge({
      conversationId: 'conv-1',
      fromTaskId: 'task-ui',
      toTaskId: 'task-contract',
      type: 'depends_on',
      createdByActionId: action.id,
    })).toThrow(/cycle/);
  });

  it('merges branches without deleting source tasks', () => {
    createTask('task-model', 'Model');
    createTask('task-ui', 'UI');
    createTask('task-integration', 'Integration');

    const merge = taskGraphRepo.appendAction({
      conversationId: 'conv-1',
      actorId: 'planner',
      actorType: 'agent',
      type: 'task.merged',
      taskIds: ['task-model', 'task-ui', 'task-integration'],
    });

    taskGraphRepo.addEdge({
      conversationId: 'conv-1',
      fromTaskId: 'task-model',
      toTaskId: 'task-integration',
      type: 'merged_into',
      createdByActionId: merge.id,
    });
    taskGraphRepo.addEdge({
      conversationId: 'conv-1',
      fromTaskId: 'task-ui',
      toTaskId: 'task-integration',
      type: 'merged_into',
      createdByActionId: merge.id,
    });

    const graph = taskGraphRepo.getGraph('conv-1');
    expect(graph.tasks.map((task) => task.id)).toEqual(['task-model', 'task-ui', 'task-integration']);
    expect(graph.edges.filter((edge) => edge.type === 'merged_into')).toHaveLength(2);
  });

  it('records cancel actions while preserving graph history', () => {
    createTask('task-old', 'Cancelled branch');

    const action = taskGraphRepo.appendAction({
      conversationId: 'conv-1',
      actorId: 'user',
      actorType: 'user',
      type: 'task.cancelled',
      taskIds: ['task-old'],
      payload: { reason: '方向调整' },
    });
    taskRepo.transition('task-old', { to: 'cancelled', reviewNote: '方向调整' });

    const graph = taskGraphRepo.getGraph('conv-1');
    expect(graph.tasks[0].status).toBe('cancelled');
    expect(graph.actions[0].id).toBe(action.id);
    expect(JSON.parse(graph.actions[0].payload)).toEqual({ reason: '方向调整' });
  });
});

describe('taskGraphRepo handoffs, artifacts, and chat bindings', () => {
  it('keeps owner unchanged until handoff is accepted', () => {
    createTask('task-ui', 'Chat UI', 'ux');

    taskGraphRepo.recordHandoffRequested({
      conversationId: 'conv-1',
      taskId: 'task-ui',
      fromAgentId: 'ux',
      toAgentId: 'frontend',
      passId: 'pass-1',
      requestedAction: 'Implement the task capsule UI.',
    });

    expect(taskRepo.getById('task-ui')!.agent_id).toBe('ux');

    const accepted = taskGraphRepo.recordHandoffAccepted({
      conversationId: 'conv-1',
      taskId: 'task-ui',
      fromAgentId: 'ux',
      toAgentId: 'frontend',
      passId: 'pass-1',
    });

    expect(accepted.type).toBe('task.handoff_accepted');
    expect(taskRepo.getById('task-ui')!.agent_id).toBe('frontend');
    expect(taskRepo.getById('task-ui')!.status).toBe('in_progress');
  });

  it('links chat messages, actions, and artifacts without changing task facts', () => {
    createTask('task-ui', 'Chat UI', 'frontend');
    const messageId = messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'frontend',
      content: 'I attached the first mockup for #T-ui.',
    });
    const action = taskGraphRepo.appendAction({
      conversationId: 'conv-1',
      actorId: 'frontend',
      actorType: 'agent',
      type: 'task.artifact_attached',
      taskIds: ['task-ui'],
      messageId,
      payload: { label: 'Task capsule mockup' },
    });

    const artifact = taskGraphRepo.addArtifact({
      conversationId: 'conv-1',
      taskId: 'task-ui',
      kind: 'design',
      label: 'Task capsule mockup',
      path: 'design/task-capsule.png',
      createdByActionId: action.id,
    });
    const binding = taskGraphRepo.bindMessage({
      conversationId: 'conv-1',
      messageId,
      taskId: 'task-ui',
      actionId: action.id,
    });

    const graph = taskGraphRepo.getGraph('conv-1');
    expect(artifact.path).toBe('design/task-capsule.png');
    expect(binding.message_id).toBe(messageId);
    expect(graph.artifacts).toHaveLength(1);
    expect(graph.bindings).toHaveLength(1);
    expect(taskRepo.getById('task-ui')!.status).toBe('ready');
  });
});
