import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { projectRepo } from '../repositories/project-repo';
import { AutomationRepository } from './repository';

describe('AutomationRepository', () => {
  beforeEach(() => setTestDb(createTestDb()));
  afterEach(() => resetDb());

  it('keeps reusable definitions separate from event-deduplicated runs', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: 'C:/alpha' });
    const repo = new AutomationRepository();
    const definition = repo.create({
      id: 'automation-1', projectId: project.id, name: '评审后通知', enabled: true,
      trigger: { type: 'event', eventType: 'review.decision_recorded', conditions: [{ field: 'payload.status', operator: 'equals', value: 'approved' }] },
      actions: [{ id: 'notify', type: 'notify', message: '评审已经通过' }],
    });

    expect(definition).toMatchObject({ enabled: true, revision: 1, trigger: { type: 'event' } });
    const first = repo.createRun({ id: 'run-1', automationId: definition.id, projectId: project.id, sourceEventId: 'event-1', triggerContext: { type: 'review.decision_recorded' } });
    expect(first).toMatchObject({ status: 'pending', trace: [] });
    expect(() => repo.createRun({ id: 'run-2', automationId: definition.id, projectId: project.id, sourceEventId: 'event-1', triggerContext: {} })).toThrow();
  });

  it('persists step trace and terminal failure independently from the definition', () => {
    const project = projectRepo.create({ name: 'Beta', rootPath: 'C:/beta' });
    const repo = new AutomationRepository();
    const definition = repo.create({ id: 'automation-2', projectId: project.id, name: '派发检查', trigger: { type: 'manual' }, actions: [{ id: 'dispatch', type: 'dispatch_agent', agentId: 'reviewer', prompt: '检查最新变更' }] });
    repo.createRun({ id: 'run-3', automationId: definition.id, projectId: project.id, triggerContext: { source: 'manual' } });
    const failed = repo.updateRun('run-3', { status: 'failed', currentStep: 0, trace: [{ stepId: 'dispatch', actionType: 'dispatch_agent', status: 'failed', startedAt: '2026-08-25T00:00:00.000Z', completedAt: '2026-08-25T00:00:01.000Z', error: 'agent_missing' }], errorCode: 'agent_missing', errorMessage: 'Agent 不存在', startedAt: '2026-08-25T00:00:00.000Z', completedAt: '2026-08-25T00:00:01.000Z' });
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'agent_missing', trace: [{ stepId: 'dispatch', status: 'failed' }] });
    expect(repo.get(definition.id)).toMatchObject({ revision: 1, enabled: false });
  });
});
