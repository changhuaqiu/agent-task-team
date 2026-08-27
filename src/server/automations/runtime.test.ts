import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { agentDefinitionRepo } from '../agents/agent-definition-repo';
import { projectRepo } from '../repositories/project-repo';
import { PlatformEventLog } from '../platform-events/event-log';
import { AgentInbox } from '../platform-events/agent-inbox';
import { AutomationRepository } from './repository';
import { AutomationRuntime } from './runtime';
import { DomainEventPublisher } from '../platform-events/domain-events';
import { CommandService } from '../command-kernel/service';

describe('AutomationRuntime', () => {
  beforeEach(() => setTestDb(createTestDb()));
  afterEach(() => resetDb());

  it('deduplicates event runs, posts a project notification, and enqueues Agent work', async () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: 'C:/alpha' });
    agentDefinitionRepo.save({
      id: 'reviewer', name: 'Reviewer', instructions: '检查变更', runtimeId: 'codex',
      accountIds: [], skillIds: [], permissions: { canModifyCode: false, canReview: true },
    });
    const repository = new AutomationRepository();
    const definition = repository.create({
      id: 'automation-1', projectId: project.id, name: '评审通过后继续', enabled: true,
      trigger: { type: 'event', eventType: 'review.decision_recorded', conditions: [{ field: 'payload.status', operator: 'equals', value: 'approved' }] },
      actions: [
        { id: 'notify', type: 'notify', message: '评审 {{payload.status}}，开始复核' },
        { id: 'dispatch', type: 'dispatch_agent', agentId: 'reviewer', prompt: '复核 {{payload.title}}' },
      ],
    });
    const eventLog = new PlatformEventLog();
    const source = eventLog.append({
      type: 'review.decision_recorded', category: 'domain', projectId: project.workspace_conversation_id,
      streamKey: 'review:1', aggregate: { type: 'review', id: 'review-1' },
      actor: { type: 'user', id: 'owner' }, correlationId: 'review-1',
      payload: { status: 'approved', title: 'PR 42' },
    });
    const runtime = new AutomationRuntime();

    expect(runtime.processEvent(source)).toEqual({ matched: 1, created: 1 });
    expect(runtime.processEvent(source)).toEqual({ matched: 1, created: 0 });
    const run = repository.listRuns(definition.id)[0];
    const requested = eventLog.listStream(`automation-run:${run.id}`)[0];
    await runtime.handle(requested, { signal: new AbortController().signal });

    expect(repository.getRun(run.id)).toMatchObject({ status: 'completed', currentStep: 2 });
    expect(getDb().prepare('SELECT content FROM chat_message WHERE conversation_id=?').get(project.workspace_conversation_id))
      .toEqual({ content: '评审 approved，开始复核' });
    expect(new AgentInbox().getByIdempotencyKey(project.workspace_conversation_id, 'reviewer', `automation:${run.id}:dispatch`))
      .toMatchObject({
        status: 'enqueued',
        command: {
          source: 'workflow', prompt: '复核 PR 42',
          executionSubject: { kind: 'ad_hoc_execution', id: `automation:${run.id}:dispatch` },
        },
      });
  });

  it('never treats automation events as user triggers and claims one schedule run per window', () => {
    const project = projectRepo.create({ name: 'Beta', rootPath: 'C:/beta' });
    const repository = new AutomationRepository();
    repository.create({
      id: 'event-loop', projectId: project.id, name: '非法回环应被隔离', enabled: true,
      trigger: { type: 'event', eventType: 'automation.run.completed', conditions: [] },
      actions: [{ id: 'notify', type: 'notify', message: '不应执行' }],
    });
    repository.create({
      id: 'schedule-1', projectId: project.id, name: '每小时检查', enabled: true,
      trigger: { type: 'schedule', intervalMinutes: 60 },
      actions: [{ id: 'notify', type: 'notify', message: '检查' }],
    }, '2026-08-25T09:00:00.000Z');
    const runtime = new AutomationRuntime({ now: () => new Date('2026-08-25T10:37:00.000Z') });
    const ownEvent = new PlatformEventLog().append({
      type: 'automation.run.completed', category: 'domain', projectId: project.workspace_conversation_id,
      streamKey: 'automation-run:x', aggregate: { type: 'automation_run', id: 'x' },
      actor: { type: 'system', id: 'automation-runtime' }, correlationId: 'x', payload: {},
    });

    expect(runtime.processEvent(ownEvent)).toEqual({ matched: 0, created: 0 });
    expect(runtime.claimDueSchedules()).toBe(1);
    expect(runtime.claimDueSchedules()).toBe(0);
    expect(repository.listRuns('schedule-1')).toHaveLength(1);
  });

  it('does not replay events recorded before a definition was enabled', () => {
    const project = projectRepo.create({ name: 'Gamma', rootPath: 'C:/gamma' });
    const eventLog = new PlatformEventLog({ now: () => new Date('2026-08-25T08:00:00.000Z') });
    const historical = eventLog.append({
      type: 'task.status_changed', category: 'domain', projectId: project.workspace_conversation_id,
      streamKey: 'task:old', aggregate: { type: 'task', id: 'old' },
      actor: { type: 'system', id: 'task-owner' }, correlationId: 'old', occurredAt: '2026-08-25T08:00:00.000Z',
      payload: { status: 'done' },
    });
    const repository = new AutomationRepository();
    repository.create({
      id: 'automation-new', projectId: project.id, name: '只处理启用后的事件', enabled: true,
      trigger: { type: 'event', eventType: 'task.status_changed', conditions: [] },
      actions: [{ id: 'notify', type: 'notify', message: '完成' }],
    }, '2026-08-25T09:00:00.000Z');

    expect(new AutomationRuntime().processEvent(historical)).toEqual({ matched: 0, created: 0 });
  });

  it('uses the definition revision effective at event time and freezes its actions in the run', async () => {
    const project = projectRepo.create({ name: 'Delta', rootPath: 'C:/delta' });
    const repository = new AutomationRepository();
    const created = repository.create({
      id: 'versioned', projectId: project.id, name: '版本化事件',
      trigger: { type: 'event', eventType: 'task.done', conditions: [] },
      actions: [{ id: 'notify-old', type: 'notify', message: '旧动作' }],
    }, '2020-01-01T08:00:00.000Z');
    repository.setEnabled(created.id, 1, true, '2020-01-01T09:00:00.000Z');
    const eventLog = new PlatformEventLog();
    const source = new DomainEventPublisher(getDb()).publish({
      type: 'task.done', projectId: project.workspace_conversation_id,
      aggregate: { type: 'task', id: 'task-versioned' }, projectAgentId: 'reviewer',
      occurredAt: '2026-08-25T09:30:00.000Z',
      payload: { previousStatus: 'in_review', status: 'done', agentId: 'reviewer' },
    });
    repository.update(created.id, 2, {
      name: '版本化事件', trigger: { type: 'event', eventType: 'task.done', conditions: [] },
      actions: [{ id: 'notify-new', type: 'notify', message: '新动作' }],
    }, '2099-01-01T10:00:00.000Z');

    const runtime = new AutomationRuntime({ eventLog });
    expect(runtime.processEvent(source)).toEqual({ matched: 1, created: 1 });
    const run = repository.listRuns(created.id)[0];
    expect(run).toMatchObject({ definitionRevision: 2, actionsSnapshot: [{ id: 'notify-old', message: '旧动作' }] });
    await runtime.handle(eventLog.listStream(`automation-run:${run.id}`)[0], { signal: new AbortController().signal });
    expect(getDb().prepare('SELECT content FROM chat_message WHERE conversation_id=?').get(project.workspace_conversation_id)).toEqual({ content: '旧动作' });
  });

  it('rethrows retryable AgentInbox capacity failures and resumes the same frozen run', async () => {
    const project = projectRepo.create({ name: 'Epsilon', rootPath: 'C:/epsilon' });
    agentDefinitionRepo.save({ id: 'worker', name: 'Worker', instructions: '执行', runtimeId: 'codex', accountIds: [], skillIds: [], permissions: { canModifyCode: true, canReview: false } });
    const eventLog = new PlatformEventLog();
    const inbox = new AgentInbox({ eventLog, maxPendingPerRuntimeLane: 1 });
    const fillerEvent = eventLog.append({ type: 'task.ready', category: 'domain', projectId: project.workspace_conversation_id, streamKey: 'task:filler', aggregate: { type: 'task', id: 'filler' }, actor: { type: 'system', id: 'test' }, correlationId: 'filler', payload: {} });
    inbox.enqueue({ projectId: project.workspace_conversation_id, projectAgentId: 'worker', idempotencyKey: 'filler', sourceEvent: fillerEvent, command: { source: 'workflow', prompt: '占位' } });
    const repository = new AutomationRepository();
    const definition = repository.create({ id: 'capacity', projectId: project.id, name: '容量重试', trigger: { type: 'manual' }, actions: [{ id: 'dispatch', type: 'dispatch_agent', agentId: 'worker', prompt: '继续' }] });
    const runtime = new AutomationRuntime({ eventLog, inbox });
    const run = runtime.triggerManual(definition.id, 'owner', 'capacity-run');
    const request = eventLog.listStream(`automation-run:${run.id}`)[0];

    await expect(runtime.handle(request, { signal: new AbortController().signal })).rejects.toThrow('agent_inbox_lane_capacity_exceeded');
    expect(repository.getRun(run.id)).toMatchObject({ status: 'running', currentStep: 0, definitionRevision: 1 });
    await runtime.handle(request, { signal: new AbortController().signal, attemptNo: 10, maxAttempts: 10 });
    expect(repository.getRun(run.id)).toMatchObject({ status: 'failed', currentStep: 0, errorCode: 'automation_retry_exhausted' });
    getDb().prepare('DELETE FROM agent_inbox_item WHERE idempotency_key=?').run('filler');
    const retried = runtime.retryRun(run.id, 'owner', 'capacity-retry');
    expect(retried).toMatchObject({ id: run.id, status: 'pending', retryCount: 1 });
    const retryRequest = eventLog.listStream(`automation-run:${run.id}`).find((event) => (event.payload as { retryCount?: number }).retryCount === 1)!;
    await runtime.handle(retryRequest, { signal: new AbortController().signal });
    expect(repository.getRun(run.id)).toMatchObject({ status: 'completed', currentStep: 1, retryCount: 1 });
  });

  it('creates formal Work through CommandService, waits durably, and resumes after approval', async () => {
    const project = projectRepo.create({ name: 'Zeta', rootPath: 'C:/zeta' });
    const repository = new AutomationRepository();
    const definition = repository.create({
      id: 'command-and-decision', projectId: project.id, name: '创建后确认',
      trigger: { type: 'manual' },
      actions: [
        { id: 'create-work', type: 'product_command', command: { name: 'work.create', input: { title: '处理 {{actor.id}} 的请求', category: 'change_request' } } },
        { id: 'confirm', type: 'request_decision', prompt: '是否继续通知？' },
        { id: 'notify', type: 'notify', message: '已批准' },
      ],
    });
    const eventLog = new PlatformEventLog();
    const commandService = new CommandService();
    const runtime = new AutomationRuntime({
      eventLog,
      executeCommand: (command) => commandService.execute(command),
    });
    const run = runtime.triggerManual(definition.id, 'owner', 'decision-run');
    const initialRequest = eventLog.listStream(`automation-run:${run.id}`)
      .find((event) => event.type === 'automation.run.requested')!;

    await runtime.handle(initialRequest, { signal: new AbortController().signal });

    const waiting = repository.getRun(run.id)!;
    expect(waiting).toMatchObject({ status: 'waiting_decision', currentStep: 1 });
    expect(waiting.trace).toMatchObject([
      { stepId: 'create-work', status: 'completed', output: { commandName: 'work.create', receiptStatus: 'applied' } },
      { stepId: 'confirm', status: 'waiting_decision' },
    ]);
    const tasks = getDb().prepare('SELECT title FROM task WHERE conversation_id=?').all(project.workspace_conversation_id);
    expect(tasks).toEqual([{ title: '处理 owner 的请求' }]);
    const decision = repository.listDecisionsForRun(run.id)[0];
    expect(decision).toMatchObject({ status: 'pending', prompt: '是否继续通知？', stepId: 'confirm' });

    const restartedRuntime = new AutomationRuntime({
      eventLog,
      executeCommand: (command) => commandService.execute(command),
    });
    expect(restartedRuntime.decide(decision.id, 'approved', 'owner', '继续', 'decision-approved'))
      .toMatchObject({ duplicate: false, run: { status: 'pending', currentStep: 2 }, decision: { status: 'approved' } });
    expect(restartedRuntime.decide(decision.id, 'approved', 'owner', '继续', 'decision-approved-replay'))
      .toMatchObject({ duplicate: true, decision: { status: 'approved' } });
    const resumeRequest = eventLog.listStream(`automation-run:${run.id}`)
      .filter((event) => event.type === 'automation.run.requested').at(-1)!;
    await restartedRuntime.handle(resumeRequest, { signal: new AbortController().signal });

    expect(repository.getRun(run.id)).toMatchObject({ status: 'completed', currentStep: 3 });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM task WHERE conversation_id=?').get(project.workspace_conversation_id))
      .toEqual({ count: 1 });
    expect(getDb().prepare('SELECT content FROM chat_message WHERE conversation_id=?').get(project.workspace_conversation_id))
      .toEqual({ content: '已批准' });
  });
});
