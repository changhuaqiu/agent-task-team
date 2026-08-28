import type Database from 'better-sqlite3';
import type {
  AutomationAction,
  AutomationCondition,
  AutomationDecision,
  AutomationRun,
  AutomationStepTrace,
  ProjectAutomation,
} from '@/shared/automation';
import type { CommandReceipt } from '../command-kernel/types';
import type { WorkCreateCommand } from '../command-kernel/service';
import { getDb } from '../db';
import { agentDefinitionRepo } from '../agents/agent-definition-repo';
import { messageRepo } from '../repositories/message-repo';
import type { MessageRow } from '../repositories/message-repo';
import { generateSortableId } from '../repositories/sortable-id';
import { AgentInbox, AgentInboxCapacityError } from '../platform-events/agent-inbox';
import { PlatformEventLog } from '../platform-events/event-log';
import type { PlatformEvent, PlatformEventHandler } from '../platform-events';
import { AutomationRepository } from './repository';

interface ProjectIdentity {
  projectId: string;
  conversationId: string;
}

type PerformedAction =
  | { status: 'completed'; output: Record<string, unknown> }
  | { status: 'waiting_decision'; output: Record<string, unknown> };

export interface AutomationRuntimeOptions {
  db?: Database.Database;
  repository?: AutomationRepository;
  eventLog?: PlatformEventLog;
  inbox?: AgentInbox;
  now?: () => Date;
  idFactory?: (prefix: string) => string;
  onMessagePosted?: (message: MessageRow) => void;
  executeCommand?: (command: WorkCreateCommand) => CommandReceipt;
}

export interface AutomationDecisionResult {
  decision: AutomationDecision;
  run: AutomationRun;
  duplicate: boolean;
}

export interface AutomationEventResult {
  matched: number;
  created: number;
}

export class AutomationRuntime {
  private readonly database?: Database.Database;
  private readonly repository: AutomationRepository;
  private readonly eventLog: PlatformEventLog;
  private readonly inbox: AgentInbox;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;
  private readonly onMessagePosted?: (message: MessageRow) => void;
  private readonly executeCommand?: (command: WorkCreateCommand) => CommandReceipt;

  constructor(options: AutomationRuntimeOptions = {}) {
    this.database = options.db;
    this.repository = options.repository ?? new AutomationRepository(options.db);
    this.eventLog = options.eventLog ?? new PlatformEventLog({ db: options.db });
    this.inbox = options.inbox ?? new AgentInbox({ db: options.db, eventLog: this.eventLog });
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? ((prefix) => generateSortableId(prefix));
    this.onMessagePosted = options.onMessagePosted;
    this.executeCommand = options.executeCommand;
  }

  readonly handle: PlatformEventHandler = async (event, { signal, attemptNo = 1, maxAttempts = 10 }) => {
    if (signal.aborted) throw new Error('automation_processing_aborted');
    if (event.type === 'automation.run.requested') {
      await this.executeRun(event.aggregate.id, event, { attemptNo, maxAttempts });
      return;
    }
    if (event.type.startsWith('automation.')) return;
    this.processEvent(event);
  };

  processEvent(event: PlatformEvent): AutomationEventResult {
    if (event.type.startsWith('automation.')) return { matched: 0, created: 0 };
    if (isRuntimeObservationMessage(event)) return { matched: 0, created: 0 };
    const identity = this.resolveProject(event.projectId);
    if (!identity) return { matched: 0, created: 0 };
    const definitions = this.repository.listEventRevisionsAt(identity.projectId, event.type, event.recordedAt)
      .filter((definition) => definition.trigger.type === 'event' && definition.trigger.conditions.every((condition) => matchesCondition(event, condition)));
    let created = 0;
    for (const definition of definitions) {
      const existing = this.repository.getRunBySourceEvent(definition.id, event.eventId);
      if (existing) continue;
      const run = this.createRequestedRun(definition, identity, {
        sourceEventId: event.eventId,
        triggerContext: eventContext(event),
        causationId: event.eventId,
        correlationId: event.correlationId,
      });
      if (run) created += 1;
    }
    return { matched: definitions.length, created };
  }

  triggerManual(automationId: string, actorId: string, correlationId: string): AutomationRun {
    const definition = this.repository.get(automationId);
    if (!definition) throw new Error('automation_not_found');
    const identity = this.resolveProject(definition.projectId);
    if (!identity) throw new Error('automation_project_not_found');
    const run = this.createRequestedRun(definition, identity, {
      triggerContext: { source: 'manual', actor: { id: actorId } },
      correlationId,
    });
    if (!run) throw new Error('automation_run_create_failed');
    return run;
  }

  retryRun(runId: string, actorId: string, correlationId: string): AutomationRun {
    const existing = this.repository.getRun(runId);
    if (!existing) throw new Error('automation_run_not_found');
    const identity = this.resolveProject(existing.projectId);
    if (!identity) throw new Error('automation_project_not_found');
    return this.db().transaction(() => {
      const retried = this.repository.retryRun(runId, this.now().toISOString());
      if (!retried) throw new Error('automation_run_not_retryable');
      this.appendRequestedEvent(retried, identity, {
        actor: { type: 'user', id: actorId },
        correlationId,
      });
      return retried;
    }).immediate();
  }

  decide(
    decisionId: string,
    status: 'approved' | 'denied',
    actorId: string,
    note: string | undefined,
    correlationId: string,
  ): AutomationDecisionResult {
    const existing = this.repository.getDecision(decisionId);
    if (!existing) throw new Error('automation_decision_not_found');
    const identity = this.resolveProject(existing.projectId);
    if (!identity) throw new Error('automation_project_not_found');
    return this.db().transaction(() => {
      const run = this.repository.getRun(existing.runId);
      if (!run) throw new Error('automation_run_not_found');
      if (run.status !== 'waiting_decision' && existing.status === 'pending') {
        throw new Error('automation_run_not_waiting_decision');
      }
      const resolved = this.repository.resolveDecision({
        id: decisionId,
        status,
        decidedBy: actorId,
        note,
      }, this.now().toISOString());
      if (resolved.duplicate) {
        return { decision: resolved.decision, run, duplicate: true };
      }
      const completedAt = this.now().toISOString();
      const currentTrace = run.trace.find((item) => item.stepId === resolved.decision.stepId);
      const trace = upsertTrace(run.trace, {
        stepId: resolved.decision.stepId,
        actionType: 'request_decision',
        status: status === 'approved' ? 'completed' : 'cancelled',
        startedAt: currentTrace?.startedAt ?? resolved.decision.createdAt,
        completedAt,
        output: {
          decisionId: resolved.decision.id,
          decision: status,
          ...(resolved.decision.note ? { note: resolved.decision.note } : {}),
        },
      });
      const requestContext: PlatformEvent = {
        eventId: `automation-decision:${resolved.decision.id}:${status}`,
        type: `automation.decision.${status}`,
        category: 'domain',
        envelopeVersion: 1,
        schemaVersion: 1,
        projectId: identity.conversationId,
        streamKey: `automation-run:${run.id}`,
        streamSequence: 0,
        aggregate: { type: 'automation_run', id: run.id },
        actor: { type: 'user', id: actorId },
        subject: { type: 'automation_decision', id: resolved.decision.id },
        correlationId,
        causationId: `automation-run:${run.id}`,
        occurredAt: completedAt,
        recordedAt: completedAt,
        payload: { runId: run.id, decisionId: resolved.decision.id, status },
      };
      if (status === 'approved') {
        const nextStep = Math.max(0, (run.currentStep ?? 0) + 1);
        const resumed = this.repository.updateRun(run.id, {
          status: 'pending', currentStep: nextStep, trace, startedAt: run.startedAt,
        }, completedAt);
        this.appendDecisionEvent('automation.decision.approved', resumed, identity, requestContext, resolved.decision);
        this.appendRequestedEvent(resumed, identity, {
          actor: { type: 'user', id: actorId }, correlationId,
          causationId: requestContext.eventId, requestKey: `decision:${decisionId}`,
        });
        return { decision: resolved.decision, run: resumed, duplicate: false };
      }
      const cancelled = this.repository.updateRun(run.id, {
        status: 'cancelled', currentStep: run.currentStep, trace,
        startedAt: run.startedAt, completedAt,
        errorCode: 'automation_decision_denied',
        errorMessage: note?.trim() || 'automation_decision_denied',
      }, completedAt);
      this.appendDecisionEvent('automation.decision.denied', cancelled, identity, requestContext, resolved.decision);
      return { decision: resolved.decision, run: cancelled, duplicate: false };
    }).immediate();
  }

  claimDueSchedules(at = this.now()): number {
    let claimed = 0;
    for (const definition of this.repository.listEnabledSchedules()) {
      if (definition.trigger.type !== 'schedule') continue;
      const intervalMs = definition.trigger.intervalMinutes * 60_000;
      const windowStart = new Date(Math.floor(at.getTime() / intervalMs) * intervalMs).toISOString();
      if (!definition.activationWatermarkAt || Date.parse(definition.activationWatermarkAt) > Date.parse(windowStart)) continue;
      const scheduleClaim = `${definition.id}:${windowStart}`;
      if (this.repository.getRunByScheduleClaim(definition.id, scheduleClaim)) continue;
      const identity = this.resolveProject(definition.projectId);
      if (!identity) continue;
      const run = this.createRequestedRun(definition, identity, {
        scheduleClaim,
        triggerContext: { source: 'schedule', windowStart, intervalMinutes: definition.trigger.intervalMinutes },
        correlationId: scheduleClaim,
      });
      if (run) claimed += 1;
    }
    return claimed;
  }

  private createRequestedRun(
    definition: ProjectAutomation,
    identity: ProjectIdentity,
    input: {
      sourceEventId?: string;
      scheduleClaim?: string;
      triggerContext: Record<string, unknown>;
      correlationId: string;
      causationId?: string;
    },
  ): AutomationRun | undefined {
    const db = this.db();
    try {
      return db.transaction(() => {
        const run = this.repository.createRun({
          id: this.idFactory('automation-run'),
          automationId: definition.id,
          projectId: definition.projectId,
          sourceEventId: input.sourceEventId,
          scheduleClaim: input.scheduleClaim,
          triggerContext: input.triggerContext,
          definitionRevision: definition.revision,
          triggerSnapshot: definition.trigger,
          actionsSnapshot: definition.actions,
        }, this.now().toISOString());
        this.appendRequestedEvent(run, identity, {
          actor: { type: 'system', id: 'automation-runtime' },
          correlationId: input.correlationId,
          causationId: input.causationId,
        });
        return run;
      }).immediate();
    } catch (error) {
      const duplicate = input.sourceEventId
        ? this.repository.getRunBySourceEvent(definition.id, input.sourceEventId)
        : input.scheduleClaim
          ? this.repository.getRunByScheduleClaim(definition.id, input.scheduleClaim)
          : undefined;
      if (duplicate) return undefined;
      throw error;
    }
  }

  private async executeRun(
    runId: string,
    requestEvent: PlatformEvent,
    delivery: { attemptNo: number; maxAttempts: number },
  ): Promise<void> {
    let run = this.repository.getRun(runId);
    if (!run || ['completed', 'failed', 'cancelled', 'skipped'].includes(run.status)) return;
    const identity = this.resolveProject(run.projectId);
    if (!identity) throw new Error('automation_project_not_found');
    const startedAt = run.startedAt ?? this.now().toISOString();
    const trace = [...run.trace];
    this.repository.updateRun(run.id, {
      status: 'running',
      currentStep: run.currentStep ?? 0,
      trace,
      startedAt,
    }, startedAt);
    const startIndex = Math.max(0, run.currentStep ?? 0);
    for (let index = startIndex; index < run.actionsSnapshot.length; index += 1) {
      const action = run.actionsSnapshot[index];
      const stepStartedAt = this.now().toISOString();
      const activeTrace = upsertTrace(trace, {
        stepId: action.id,
        actionType: action.type,
        status: 'running',
        startedAt: stepStartedAt,
      });
      this.repository.updateRun(run.id, { status: 'running', currentStep: index, trace: activeTrace, startedAt }, stepStartedAt);
      try {
        const completedAt = this.now().toISOString();
        const { performed, completedTrace } = this.db().transaction(() => {
          const performed = this.performAction(run!, identity, action, requestEvent);
          if (performed.status === 'waiting_decision') {
            const waitingTrace = upsertTrace(activeTrace, {
              stepId: action.id,
              actionType: action.type,
              status: 'waiting_decision',
              startedAt: stepStartedAt,
              output: performed.output,
            });
            this.repository.updateRun(run!.id, {
              status: 'waiting_decision', currentStep: index, trace: waitingTrace, startedAt,
            }, completedAt);
            return { performed, completedTrace: waitingTrace };
          }
          const completedTrace = upsertTrace(activeTrace, {
            stepId: action.id,
            actionType: action.type,
            status: 'completed',
            startedAt: stepStartedAt,
            completedAt,
            output: performed.output,
          });
          this.repository.updateRun(run!.id, { status: 'running', currentStep: index + 1, trace: completedTrace, startedAt }, completedAt);
          return { performed, completedTrace };
        }).immediate();
        trace.splice(0, trace.length, ...completedTrace);
        if (performed.status === 'waiting_decision') return;
        if (typeof performed.output.messageId === 'string' && this.onMessagePosted) {
          const message = messageRepo.getById(performed.output.messageId);
          if (message) {
            try {
              this.onMessagePosted(message);
            } catch (error) {
              console.warn('[automation] post-persistence message projection failed:', error);
            }
          }
        }
      } catch (error) {
        if (isRetryableActionError(error)) {
          if (delivery.attemptNo < delivery.maxAttempts) throw error;
          const completedAt = this.now().toISOString();
          const originalMessage = error instanceof Error ? error.message : String(error);
          const failedTrace = upsertTrace(activeTrace, {
            stepId: action.id,
            actionType: action.type,
            status: 'failed',
            startedAt: stepStartedAt,
            completedAt,
            error: originalMessage,
          });
          this.db().transaction(() => {
            this.repository.updateRun(run!.id, {
              status: 'failed', currentStep: index, trace: failedTrace,
              errorCode: 'automation_retry_exhausted', errorMessage: originalMessage,
              startedAt, completedAt,
            }, completedAt);
            this.appendRunEvent('automation.run.failed', run!, identity, requestEvent, {
              stepId: action.id,
              errorCode: 'automation_retry_exhausted',
              attemptNo: delivery.attemptNo,
              maxAttempts: delivery.maxAttempts,
            });
          }).immediate();
          return;
        }
        const completedAt = this.now().toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);
        const failedTrace = upsertTrace(activeTrace, {
          stepId: action.id,
          actionType: action.type,
          status: 'failed',
          startedAt: stepStartedAt,
          completedAt,
          error: errorMessage,
        });
        this.db().transaction(() => {
          this.repository.updateRun(run!.id, {
            status: 'failed', currentStep: index, trace: failedTrace,
            errorCode: errorMessage.split(':')[0], errorMessage, startedAt, completedAt,
          }, completedAt);
          this.appendRunEvent('automation.run.failed', run!, identity, requestEvent, { stepId: action.id, errorCode: errorMessage.split(':')[0] });
        }).immediate();
        return;
      }
      run = this.repository.getRun(run.id)!;
    }
    const completedAt = this.now().toISOString();
    this.db().transaction(() => {
      this.repository.updateRun(run!.id, { status: 'completed', currentStep: run!.actionsSnapshot.length, trace, startedAt, completedAt }, completedAt);
      this.appendRunEvent('automation.run.completed', run!, identity, requestEvent, { stepCount: run!.actionsSnapshot.length });
    }).immediate();
  }

  private performAction(
    run: AutomationRun,
    identity: ProjectIdentity,
    action: AutomationAction,
    requestEvent: PlatformEvent,
  ): PerformedAction {
    if (action.type === 'notify') {
      const messageId = messageRepo.append({
        conversationId: identity.conversationId,
        senderType: 'system',
        senderId: 'automation',
        content: renderTemplate(action.message, run.triggerContext),
        metadata: { source: 'automation', automationId: run.automationId, automationRunId: run.id, stepId: action.id },
      }, this.db());
      this.eventLog.append({
        type: 'automation.notification.posted', category: 'domain', projectId: identity.conversationId,
        streamKey: `automation-run:${run.id}`, aggregate: { type: 'automation_run', id: run.id },
        actor: { type: 'system', id: 'automation-runtime' }, subject: { type: 'message', id: messageId },
        correlationId: requestEvent.correlationId, causationId: requestEvent.eventId,
        dedupeKey: `automation-notification:${run.id}:${action.id}`,
        payload: { automationId: run.automationId, runId: run.id, stepId: action.id, messageId },
      });
      return { status: 'completed', output: { messageId } };
    }
    if (action.type === 'dispatch_agent') {
      if (!agentDefinitionRepo.get(action.agentId)) throw new Error(`automation_agent_not_found:${action.agentId}`);
      const item = this.inbox.enqueue({
        projectId: identity.conversationId,
        projectAgentId: action.agentId,
        idempotencyKey: `automation:${run.id}:${action.id}`,
        sourceEvent: requestEvent,
        command: {
          source: 'workflow',
          prompt: renderTemplate(action.prompt, run.triggerContext),
          correlationId: `automation-run:${run.id}`,
          causationId: requestEvent.eventId,
          contextScenario: 'execution',
          executionSubject: {
            kind: 'ad_hoc_execution',
            id: `automation:${run.id}:${action.id}`,
          },
        },
      });
      return { status: 'completed', output: { inboxItemId: item.id, agentId: action.agentId } };
    }
    if (action.type === 'product_command') {
      if (!this.executeCommand) throw new Error('automation_command_executor_unavailable');
      const commandIdentity = `automation:${run.id}:${action.id}`;
      const command: WorkCreateCommand = {
        commandId: commandIdentity,
        name: 'work.create',
        projectId: run.projectId,
        actor: { type: 'system', id: `automation:${run.automationId}` },
        idempotencyKey: commandIdentity,
        correlationId: requestEvent.correlationId,
        causationId: requestEvent.eventId,
        input: {
          title: renderTemplate(action.command.input.title, run.triggerContext),
          category: action.command.input.category,
          description: action.command.input.description
            ? renderTemplate(action.command.input.description, run.triggerContext)
            : undefined,
        },
      };
      const receipt = this.executeCommand(command);
      if (receipt.status === 'delivery_unknown') throw new Error('automation_command_delivery_unknown');
      if (receipt.status !== 'applied' && receipt.status !== 'duplicate') {
        throw new Error(`automation_command_${receipt.status}:${receipt.reasonCode ?? 'unknown'}`);
      }
      return {
        status: 'completed',
        output: {
          commandName: command.name,
          receiptStatus: receipt.status,
          ...(receipt.subject ? { subject: `${receipt.subject.type}:${receipt.subject.id}` } : {}),
          ...(receipt.revision !== undefined ? { revision: receipt.revision } : {}),
          eventIds: receipt.eventIds,
          evidenceRefs: receipt.evidenceRefs,
        },
      };
    }
    const prompt = renderTemplate(action.prompt, run.triggerContext);
    const pending = this.repository.requestDecision({
      id: this.idFactory('automation-decision'),
      automationId: run.automationId,
      runId: run.id,
      projectId: run.projectId,
      stepId: action.id,
      prompt,
      requestedBy: 'automation-runtime',
    }, this.now().toISOString());
    this.eventLog.append({
      type: 'automation.decision.requested', category: 'domain', projectId: identity.conversationId,
      streamKey: `automation-run:${run.id}`, aggregate: { type: 'automation_run', id: run.id },
      actor: { type: 'system', id: 'automation-runtime' },
      subject: { type: 'automation_decision', id: pending.id },
      correlationId: requestEvent.correlationId, causationId: requestEvent.eventId,
      dedupeKey: `automation-decision-requested:${run.id}:${action.id}`,
      payload: { automationId: run.automationId, runId: run.id, stepId: action.id, decisionId: pending.id, prompt },
    });
    return { status: 'waiting_decision', output: { decisionId: pending.id, prompt } };
  }

  private appendDecisionEvent(
    type: 'automation.decision.approved' | 'automation.decision.denied',
    run: AutomationRun,
    identity: ProjectIdentity,
    requestEvent: PlatformEvent,
    decision: AutomationDecision,
  ): void {
    this.eventLog.append({
      type, category: 'domain', projectId: identity.conversationId,
      streamKey: `automation-run:${run.id}`, aggregate: { type: 'automation_run', id: run.id },
      actor: requestEvent.actor,
      subject: { type: 'automation_decision', id: decision.id },
      correlationId: requestEvent.correlationId, causationId: requestEvent.eventId,
      dedupeKey: `${type}:${decision.id}`,
      payload: { automationId: run.automationId, runId: run.id, decisionId: decision.id, stepId: decision.stepId },
    });
  }

  private appendRunEvent(
    type: 'automation.run.completed' | 'automation.run.failed',
    run: AutomationRun,
    identity: ProjectIdentity,
    requestEvent: PlatformEvent,
    payload: Record<string, unknown>,
  ): void {
    this.eventLog.append({
      type,
      category: 'domain',
      projectId: identity.conversationId,
      streamKey: `automation-run:${run.id}`,
      aggregate: { type: 'automation_run', id: run.id },
      actor: { type: 'system', id: 'automation-runtime' },
      subject: { type: 'automation', id: run.automationId },
      correlationId: requestEvent.correlationId,
      causationId: requestEvent.eventId,
      dedupeKey: `${type}:${run.id}`,
      payload,
    });
  }

  private appendRequestedEvent(
    run: AutomationRun,
    identity: ProjectIdentity,
    input: {
      actor: { type: 'system' | 'user'; id: string };
      correlationId: string;
      causationId?: string;
      requestKey?: string;
    },
  ): void {
    this.eventLog.append({
      type: 'automation.run.requested',
      category: 'coordination',
      projectId: identity.conversationId,
      streamKey: `automation-run:${run.id}`,
      aggregate: { type: 'automation_run', id: run.id },
      actor: input.actor,
      subject: { type: 'automation', id: run.automationId },
      correlationId: input.correlationId,
      causationId: input.causationId,
      dedupeKey: `automation-run-requested:${run.id}:${run.retryCount}:${input.requestKey ?? 'run'}`,
      payload: {
        automationId: run.automationId,
        projectId: run.projectId,
        definitionRevision: run.definitionRevision,
        retryCount: run.retryCount,
      },
    });
  }

  private resolveProject(scopeId: string): ProjectIdentity | undefined {
    return this.db().prepare(`
      SELECT project.id AS projectId, conversation.id AS conversationId
      FROM project
      JOIN conversation ON conversation.project_id=project.id AND conversation.workspace_kind='project_workspace'
      WHERE project.id=? OR conversation.id=?
      ORDER BY CASE WHEN project.id=? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(scopeId, scopeId, scopeId) as ProjectIdentity | undefined;
  }

  private db(): Database.Database {
    return this.database ?? getDb();
  }
}

function isRuntimeObservationMessage(event: PlatformEvent): boolean {
  if (event.type !== 'chat.message.persisted') return false;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
  return ['thinking', 'tool_use', 'tool_result'].includes(String(payload.contentType ?? 'text'));
}

function eventContext(event: PlatformEvent): Record<string, unknown> {
  return {
    type: event.type,
    actor: event.actor,
    subject: event.subject,
    payload: event.payload,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
  };
}

function contextValue(context: Record<string, unknown>, path: string): string {
  let current: unknown = context;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[key];
  }
  return current === undefined || current === null ? '' : String(current);
}

function matchesCondition(event: PlatformEvent, condition: AutomationCondition): boolean {
  const actual = contextValue(eventContext(event), condition.field);
  if (condition.operator === 'equals') return actual === condition.value;
  if (condition.operator === 'not_equals') return actual !== condition.value;
  return actual.includes(condition.value);
}

function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) => contextValue(context, path));
}

function upsertTrace(trace: AutomationStepTrace[], next: AutomationStepTrace): AutomationStepTrace[] {
  const index = trace.findIndex((item) => item.stepId === next.stepId);
  if (index < 0) return [...trace, next];
  return trace.map((item, itemIndex) => itemIndex === index ? next : item);
}

function isRetryableActionError(error: unknown): boolean {
  if (error instanceof AgentInboxCapacityError) return true;
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
}
