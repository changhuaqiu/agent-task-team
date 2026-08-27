import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { projectRepo } from '../repositories/project-repo';
import { AutomationRepository } from '../automations';
import {
  asAutomationCreateCommand,
  asAutomationRetryCommand,
  asAutomationSetEnabledCommand,
  asAutomationTriggerCommand,
  asAutomationUpdateCommand,
  CommandService,
} from './service';

describe('Automation commands', () => {
  beforeEach(() => setTestDb(createTestDb()));
  afterEach(() => resetDb());

  it('creates disabled, revision-fenced definitions and returns stable duplicate receipts', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: 'C:/alpha' });
    const service = new CommandService();
    const create = asAutomationCreateCommand({
      commandId: 'create-1', idempotencyKey: 'create-1', projectId: project.id,
      definition: { name: '评审通知', trigger: { type: 'manual' }, actions: [{ id: 'notify', type: 'notify', message: '完成' }] },
    });
    const created = service.execute(create);
    expect(created).toMatchObject({ status: 'applied', revision: 1, result: { automation: { enabled: false } } });
    expect(service.execute(create)).toMatchObject({ status: 'duplicate', eventIds: created.eventIds });
    const automation = (created.result as { automation: { id: string } }).automation;

    const updated = service.execute(asAutomationUpdateCommand({
      commandId: 'update-1', idempotencyKey: 'update-1', projectId: project.id,
      expectedRevision: 1,
      definition: { id: automation.id, name: '评审完成通知', trigger: { type: 'manual' }, actions: [{ id: 'notify', type: 'notify', message: '完成' }] },
    }));
    expect(updated).toMatchObject({ status: 'applied', revision: 2 });
    expect(service.execute(asAutomationSetEnabledCommand({
      commandId: 'enable-stale', idempotencyKey: 'enable-stale', projectId: project.id,
      automationId: automation.id, expectedRevision: 1, enabled: true,
    }))).toMatchObject({ status: 'conflict', reasonCode: 'automation_revision_conflict' });
    expect(service.execute(asAutomationSetEnabledCommand({
      commandId: 'enable-1', idempotencyKey: 'enable-1', projectId: project.id,
      automationId: automation.id, expectedRevision: 2, enabled: true,
    }))).toMatchObject({ status: 'applied', revision: 3, result: { automation: { enabled: true } } });
  });

  it('manual trigger creates a durable pending run instead of executing inside the command request', () => {
    const project = projectRepo.create({ name: 'Beta', rootPath: 'C:/beta' });
    const definition = new AutomationRepository().create({
      id: 'automation-manual', projectId: project.id, name: '手动检查',
      trigger: { type: 'manual' }, actions: [{ id: 'notify', type: 'notify', message: '开始' }],
    });
    const receipt = new CommandService().execute(asAutomationTriggerCommand({
      commandId: 'trigger-1', idempotencyKey: 'trigger-1', projectId: project.id, automationId: definition.id,
    }));
    expect(receipt).toMatchObject({ status: 'applied', result: { run: { status: 'pending', automationId: definition.id } } });
    const run = (receipt.result as { run: { id: string } }).run;
    const repository = new AutomationRepository();
    const snapshot = repository.getRun(run.id)!;
    repository.updateRun(run.id, { status: 'failed', currentStep: 0, trace: snapshot.trace, errorCode: 'permanent', errorMessage: 'permanent', completedAt: new Date().toISOString() });
    const retried = new CommandService().execute(asAutomationRetryCommand({
      commandId: 'retry-1', idempotencyKey: 'retry-1', projectId: project.id, runId: run.id,
    }));
    expect(retried).toMatchObject({ status: 'applied', result: { run: { id: run.id, status: 'pending', retryCount: 1 } } });
    expect(new CommandService().execute(asAutomationRetryCommand({ commandId: 'retry-1-replay', idempotencyKey: 'retry-1', projectId: project.id, runId: run.id }))).toMatchObject({ status: 'duplicate', result: { run: { id: run.id, retryCount: 1 } } });
  });

  it('binds idempotency replay to project, subject, revision, input, and non-blank identity', () => {
    const alpha = projectRepo.create({ name: 'Alpha', rootPath: 'C:/alpha-idempotency' });
    const beta = projectRepo.create({ name: 'Beta', rootPath: 'C:/beta-idempotency' });
    const service = new CommandService();
    const definition = { name: '统一幂等', trigger: { type: 'manual' } as const, actions: [{ id: 'notify', type: 'notify' as const, message: '完成' }] };
    const created = service.execute(asAutomationCreateCommand({ commandId: 'same-create', idempotencyKey: 'same-create', projectId: alpha.id, definition }));
    expect(created.status).toBe('applied');
    expect(service.execute(asAutomationCreateCommand({ commandId: 'cross-project', idempotencyKey: 'same-create', projectId: beta.id, definition }))).toMatchObject({ status: 'conflict' });
    expect(service.execute(asAutomationCreateCommand({ commandId: '', idempotencyKey: '', projectId: alpha.id, definition }))).toMatchObject({ status: 'rejected', reasonCode: 'command_envelope_mismatch' });

    const automationId = (created.result as { automation: { id: string } }).automation.id;
    const enabled = service.execute(asAutomationSetEnabledCommand({ commandId: 'toggle', idempotencyKey: 'toggle', projectId: alpha.id, automationId, expectedRevision: 1, enabled: true }));
    expect(enabled.status).toBe('applied');
    expect(service.execute(asAutomationSetEnabledCommand({ commandId: 'toggle-opposite', idempotencyKey: 'toggle', projectId: alpha.id, automationId, expectedRevision: 2, enabled: false }))).toMatchObject({ status: 'conflict' });

    const update = asAutomationUpdateCommand({ commandId: 'update-replay', idempotencyKey: 'update-replay', projectId: alpha.id, expectedRevision: 2, definition: { id: automationId, ...definition } });
    expect(service.execute(update).status).toBe('applied');
    expect(service.execute(asAutomationUpdateCommand({ ...update, commandId: 'update-replay-changed', expectedRevision: 3, definition: update.input }))).toMatchObject({ status: 'conflict' });
  });
});
