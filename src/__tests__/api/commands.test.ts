import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/commands';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { WorkContractRepository } from '@/server/work-contract/repository';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import { agentDefinitionRepo } from '@/server/agents/agent-definition-repo';

function saveRunnableAgent(id: string) {
  return agentDefinitionRepo.save({
    id, name: id, roleCardId: 'preset-planner', runtimeId: 'codex',
    accountIds: [], skillIds: [], instructions: `Run as ${id}.`,
  });
}

function response() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
}

describe('/api/commands', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    const now = '2026-08-23T12:00:00.000Z';
    db.prepare('INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run('project-command-api', 'Command API', 'active', now, now);
  });

  afterEach(() => resetDb());

  it('returns the canonical receipt used by MCP and CLI adapters', () => {
    const contract = new WorkContractRepository().issue({
      workId: 'work-command-api',
      attemptId: 'attempt-command-api',
      projectId: 'project-command-api',
      agentId: 'builder',
      goal: 'Build',
      acceptanceCriteria: ['done'],
      role: {},
      permissions: {},
      authoritativeRefs: ['context:api'],
      authoritativeRevisions: { context: 'api' },
      contextSnapshotRef: 'context:api',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'trace-command-api',
      causationId: 'trigger-command-api',
    });
    const outcome = {
      outcomeId: 'outcome-command-api',
      idempotencyKey: 'outcome-command-api-key',
      contractId: contract.contractId,
      outcomeType: 'submit_task_result',
      payload: { summary: 'done' },
      evidenceRefs: ['artifact:api'],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: '2026-08-23T12:01:00.000Z',
    };
    const res = response();
    handler(
      { method: 'POST', body: { name: 'work.submit_outcome', input: outcome } } as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res).toMatchObject({
      statusCode: 202,
      body: {
        commandId: outcome.outcomeId,
        status: 'applied',
        subject: { type: 'agent_work', id: contract.workId },
        evidenceRefs: ['artifact:api'],
        result: { exitAccepted: true },
      },
    });
  });

  it('creates a project through the human command adapter', () => {
    const res = response();
    handler({
      method: 'POST',
      body: {
        name: 'project.create',
        commandId: 'project-api-create',
        idempotencyKey: 'project-api-create',
        input: { name: 'Alpha', rootPath: 'C:/projects/alpha' },
      },
    } as NextApiRequest, res as unknown as NextApiResponse);
    expect(res).toMatchObject({
      statusCode: 202,
      body: {
        status: 'applied',
        subject: { type: 'project' },
        result: { project: { name: 'Alpha', root_path: 'C:/projects/alpha' } },
      },
    });
  });

  it('creates a first-class review through the same human command adapter', () => {
    const projectRes = response();
    handler({ method: 'POST', body: {
      name: 'project.create', commandId: 'review-api-project', idempotencyKey: 'review-api-project',
      input: { name: 'Review API', rootPath: 'C:/projects/review-api' },
    } } as NextApiRequest, projectRes as unknown as NextApiResponse);
    const projectId = (projectRes.body as { result: { project: { id: string } } }).result.project.id;
    const res = response();
    handler({ method: 'POST', body: {
      name: 'review.create', commandId: 'review-api-create', idempotencyKey: 'review-api-create', projectId,
      input: { repositoryRoot: 'C:/projects/review-api', baseRef: 'main', compareRef: 'feature/api', title: 'API review' },
    } } as NextApiRequest, res as unknown as NextApiResponse);
    expect(res).toMatchObject({
      statusCode: 202,
      body: { status: 'applied', subject: { type: 'review' }, result: { review: { title: 'API review', status: 'open' } } },
    });
  });

  it('creates Work through the shared command adapter used by CLI and UI', () => {
    const projectRes = response();
    handler({ method: 'POST', body: {
      name: 'project.create', commandId: 'work-api-project', idempotencyKey: 'work-api-project',
      input: { name: 'Work API', rootPath: 'C:/projects/work-api' },
    } } as NextApiRequest, projectRes as unknown as NextApiResponse);
    const projectId = (projectRes.body as { result: { project: { id: string } } }).result.project.id;
    const res = response();
    handler({ method: 'POST', body: {
      name: 'work.create', commandId: 'work-api-create', idempotencyKey: 'work-api-create', projectId,
      input: { title: 'API work', category: 'issue', description: 'One command kernel.' },
    } } as NextApiRequest, res as unknown as NextApiResponse);
    expect(res).toMatchObject({
      statusCode: 202,
      body: { status: 'applied', subject: { type: 'work' }, result: { task: { title: 'API work' } } },
    });
  });

  it('deploys an Agent team through the shared command adapter', () => {
    saveRunnableAgent('api-agent');
    const projectRes = response();
    handler({ method: 'POST', body: {
      name: 'project.create', commandId: 'team-api-project', idempotencyKey: 'team-api-project',
      input: { name: 'Team API', rootPath: 'C:/projects/team-api' },
    } } as NextApiRequest, projectRes as unknown as NextApiResponse);
    const project = (projectRes.body as { result: { project: { id: string; workspace_conversation_id: string } } }).result.project;
    const team = teamPackRepo.seedLegacy({
      name: 'api-team', displayName: 'API team', description: '', teamMode: 'parallel',
      roles: [{ id: 'api-agent', displayName: 'API agent', soul: 'Work.', required: true }],
      workflow: { type: 'linear', steps: [] },
      communicationMatrix: { 'api-agent': { canSendTo: [], canReceiveFrom: [] } },
    });
    const res = response();
    handler({ method: 'POST', body: {
      name: 'agent_team.deploy', commandId: 'team-api-deploy', idempotencyKey: 'team-api-deploy', projectId: project.id,
      input: { teamId: team.id, channelId: project.workspace_conversation_id },
    } } as NextApiRequest, res as unknown as NextApiResponse);
    expect(res).toMatchObject({
      statusCode: 202,
      body: { status: 'applied', result: { teamId: team.id, channelId: project.workspace_conversation_id } },
    });
  });

  it('creates an Agent team through the shared command adapter', () => {
    saveRunnableAgent('api-created-agent');
    const res = response();
    handler({ method: 'POST', body: {
      name: 'agent_team.create', commandId: 'team-api-create', idempotencyKey: 'team-api-create', projectId: 'workspace',
      input: {
        name: 'api-created-team', displayName: 'API created team', description: '', teamMode: 'parallel',
        members: [{ agentId: 'api-created-agent', required: true }],
        workflow: { type: 'linear', steps: [] },
        communicationMatrix: { 'api-created-agent': { canSendTo: [], canReceiveFrom: [] } },
      },
    } } as NextApiRequest, res as unknown as NextApiResponse);
    expect(res).toMatchObject({
      statusCode: 202,
      body: { status: 'applied', subject: { type: 'agent_team' }, result: { team: { displayName: 'API created team' } } },
    });
  });

  it('creates and revision-fences Agent definitions through the human command adapter', () => {
    const createRes = response();
    handler({ method: 'POST', body: {
      name: 'agent.create', commandId: 'agent-api-create', idempotencyKey: 'agent-api-create',
      input: {
        name: 'API Reviewer', roleCardId: 'preset-reviewer', instructions: 'Review independently.',
        runtimeId: 'codex', runtimeMode: 'defaults', accountIds: [], skillIds: [],
        audience: { mode: 'owner', ids: [] }, parallelism: 2,
        instanceNamePool: ['Birch', 'Ridge'], permissions: { canModifyCode: false, canReview: true },
      },
    } } as NextApiRequest, createRes as unknown as NextApiResponse);
    expect(createRes).toMatchObject({
      statusCode: 202,
      body: {
        status: 'applied', revision: 1, subject: { type: 'agent' },
        result: { agent: { name: 'API Reviewer', parallelism: 2, instance_name_pool: ['Birch', 'Ridge'] } },
      },
    });
    const agentId = (createRes.body as { subject: { id: string } }).subject.id;

    const updateRes = response();
    handler({ method: 'POST', body: {
      name: 'agent.update', commandId: 'agent-api-update', idempotencyKey: 'agent-api-update', expectedRevision: 1,
      input: {
        id: agentId, name: 'API Principal Reviewer', roleCardId: 'preset-reviewer', instructions: 'Review independently.',
        runtimeId: 'codex', runtimeMode: 'defaults', accountIds: [], skillIds: [],
        audience: { mode: 'owner', ids: [] }, parallelism: 3,
        instanceNamePool: ['Birch', 'Ridge'], permissions: { canModifyCode: false, canReview: true },
      },
    } } as NextApiRequest, updateRes as unknown as NextApiResponse);
    expect(updateRes).toMatchObject({
      statusCode: 202,
      body: { status: 'applied', revision: 2, result: { agent: { id: agentId, name: 'API Principal Reviewer', parallelism: 3 } } },
    });

    const staleRes = response();
    handler({ method: 'POST', body: {
      name: 'agent.update', commandId: 'agent-api-stale', idempotencyKey: 'agent-api-stale', expectedRevision: 1,
      input: {
        id: agentId, name: 'Stale Reviewer', roleCardId: 'preset-reviewer', instructions: 'Review independently.',
        runtimeId: 'codex', runtimeMode: 'defaults', accountIds: [], skillIds: [],
        audience: { mode: 'owner', ids: [] }, parallelism: 1, instanceNamePool: [],
        permissions: { canModifyCode: false, canReview: true },
      },
    } } as NextApiRequest, staleRes as unknown as NextApiResponse);
    expect(staleRes).toMatchObject({
      statusCode: 409,
      body: { status: 'conflict', reasonCode: 'agent_revision_conflict' },
    });
  });
});
