import { createHash } from 'node:crypto';
import { getDb } from '../db';
import {
  AgentOutcomeIdempotencyConflictError,
  WorkContractInvariantError,
  workContractRepo,
} from '../work-contract/repository';
import type { AgentOutcome } from '../work-contract/types';
import { PlatformEventDedupeConflictError, PlatformEventLog, type PlatformEvent } from '../platform-events';
import { canonicalProjectRootPath, projectRepo, type ProjectRow } from '../repositories/project-repo';
import { projectAgentMembershipRepo } from '../repositories/project-agent-membership-repo';
import { conversationRepo, type ConversationRow } from '../repositories/conversation-repo';
import {
  projectReviewFromRow,
  projectReviewRepo,
} from '../repositories/project-review-repo';
import type { ProjectReview, ProjectReviewStatus } from '@/shared/project-review';
import { teamPackRepo } from '../repositories/team-pack-repo';
import {
  agentDefinitionRepo,
  type AgentDefinition,
  type SaveAgentDefinitionInput,
} from '../agents/agent-definition-repo';
import { loadCatalog } from '../agent/acp/catalog';
import { taskCommandService } from '../repositories/task-command-service';
import {
  InvalidTaskGraphError,
  StaleTaskGraphRevisionError,
  TaskGraphIdempotencyConflictError,
} from '../repositories/task-graph-repo';
import type { TaskRow } from '../repositories/task-repo';
import type { AgentTeamDefinitionInput, TeamPack } from '@/types/teamPack';
import type { CommandReceipt, ProductCommand } from './types';
import type { AutomationDecision, AutomationRun, ProjectAutomation } from '@/shared/automation';
import type { ProjectRelease, ProjectReleaseTarget } from '@/shared/project-release';
import { projectReleaseRepo } from '../repositories/project-release-repo';
import {
  AutomationRepository,
  AutomationRuntime,
  type AutomationDefinitionInput,
  validateAutomationDefinition,
} from '../automations';

export type WorkSubmitOutcomeCommand = ProductCommand<'work.submit_outcome', AgentOutcome>;
export type WorkCreateCommand = ProductCommand<'work.create', {
  title: string;
  category: TaskRow['category'];
  description?: string;
}>;
export type ProjectCreateCommand = ProductCommand<'project.create', {
  name: string;
  rootPath: string;
}>;
export type ProjectAgentAddCommand = ProductCommand<'project.agent.add', { agentId: string }>;
export type ProjectAgentRemoveCommand = ProductCommand<'project.agent.remove', { agentId: string }>;
export type ReviewCreateCommand = ProductCommand<'review.create', {
  repositoryRoot: string;
  baseRef: string;
  compareRef: string;
  title: string;
  description?: string;
}>;
export type ReviewRecordDecisionCommand = ProductCommand<'review.record_decision', {
  reviewId: string;
  status: Extract<ProjectReviewStatus, 'changes_requested' | 'approved' | 'closed'>;
  summary: string;
}>;
export type AgentTeamDeployCommand = ProductCommand<'agent_team.deploy', {
  teamId: string;
  channelId: string;
}>;
export type AgentTeamCreateCommand = ProductCommand<'agent_team.create', AgentTeamDefinitionInput>;
export type AgentTeamUpdateCommand = ProductCommand<'agent_team.update', AgentTeamDefinitionInput & { id: string }>;
export type AgentTeamDeleteCommand = ProductCommand<'agent_team.delete', { teamId: string }>;
export type AgentCreateCommand = ProductCommand<'agent.create', SaveAgentDefinitionInput>;
export type AgentUpdateCommand = ProductCommand<'agent.update', SaveAgentDefinitionInput & { id: string }>;
export type AutomationCreateCommand = ProductCommand<'automation.create', AutomationDefinitionInput>;
export type AutomationUpdateCommand = ProductCommand<'automation.update', AutomationDefinitionInput & { id: string }>;
export type AutomationSetEnabledCommand = ProductCommand<'automation.set_enabled', { automationId: string; enabled: boolean }>;
export type AutomationTriggerCommand = ProductCommand<'automation.trigger', { automationId: string }>;
export type AutomationRetryCommand = ProductCommand<'automation.retry', { runId: string }>;
export type AutomationDecideCommand = ProductCommand<'automation.decide', {
  decisionId: string;
  decision: 'approved' | 'denied';
  note?: string;
}>;
export type ReleaseCreateCommand = ProductCommand<'release.create', {
  name: string;
  description?: string;
  targets: ProjectReleaseTarget[];
}>;
export type ReleasePublishCommand = ProductCommand<'release.publish', { releaseId: string }>;
export type SupportedProductCommand =
  | WorkSubmitOutcomeCommand
  | WorkCreateCommand
  | ProjectCreateCommand
  | ProjectAgentAddCommand
  | ProjectAgentRemoveCommand
  | ReviewCreateCommand
  | ReviewRecordDecisionCommand
  | AgentTeamCreateCommand
  | AgentTeamUpdateCommand
  | AgentTeamDeleteCommand
  | AgentTeamDeployCommand
  | AgentCreateCommand
  | AgentUpdateCommand
  | AutomationCreateCommand
  | AutomationUpdateCommand
  | AutomationSetEnabledCommand
  | AutomationTriggerCommand
  | AutomationRetryCommand
  | AutomationDecideCommand
  | ReleaseCreateCommand
  | ReleasePublishCommand;

export interface WorkOutcomeCommandResult {
  outcomeId: string;
  outcomeType: AgentOutcome['outcomeType'];
  exitAccepted: boolean;
}

export interface WorkCreateCommandResult {
  task: TaskRow;
}

export interface ProjectCreateCommandResult {
  project: ProjectRow;
  workspace: ConversationRow;
}

export interface ProjectAgentMembershipCommandResult {
  projectId: string;
  agentId: string;
  agentIds: string[];
}

export interface ReviewCommandResult {
  review: ProjectReview;
}

export interface AgentTeamDeployCommandResult {
  teamId: string;
  channelId: string;
  assignedAgentIds: string[];
  runtimeReadiness: 'pending_first_trigger';
}

export interface AgentTeamCreateCommandResult {
  team: TeamPack;
}

export interface AgentTeamDeleteCommandResult {
  teamId: string;
}

export interface AgentCommandResult {
  agent: AgentDefinition;
  runtimeConfiguration: 'applies_on_next_trigger';
}

export interface AutomationCommandResult {
  automation: ProjectAutomation;
  run?: AutomationRun;
  decision?: AutomationDecision;
}

export interface ReleaseCommandResult {
  release: ProjectRelease;
}

export type SupportedCommandResult = WorkOutcomeCommandResult | WorkCreateCommandResult | ProjectCreateCommandResult | ProjectAgentMembershipCommandResult | ReviewCommandResult | AgentTeamCreateCommandResult | AgentTeamDeleteCommandResult | AgentTeamDeployCommandResult | AgentCommandResult | AutomationCommandResult | ReleaseCommandResult;

function validateAgentIds(ids: string[]): string[] {
  const catalogIds = new Set(loadCatalog().map((entry) => entry.id));
  const seen = new Set<string>();
  return ids.map((rawAgentId) => {
    const agentId = rawAgentId.trim();
    if (seen.has(agentId)) throw new Error(`agent_team_member_duplicate:${agentId}`);
    seen.add(agentId);
    const agent = agentDefinitionRepo.get(agentId);
    if (!agent) throw new Error(`agent_team_member_not_found:${agentId}`);
    if (!agent.runtime_id || !catalogIds.has(agent.runtime_id)) {
      throw new Error(`agent_team_member_runtime_missing:${agentId}`);
    }
    return agent.id;
  });
}

function validateAgentTeamMembers(team: AgentTeamDefinitionInput): string[] {
  const memberIds = validateAgentIds(team.members.map((member) => member.agentId));
  const memberSet = new Set(memberIds);
  const requireMember = (rawAgentId: string, location: string) => {
    const agentId = rawAgentId.trim();
    if (!memberSet.has(agentId)) throw new Error(`agent_team_topology_member_not_found:${location}:${agentId}`);
  };

  if (team.workflow.type === 'linear') {
    for (const [index, step] of (team.workflow.steps ?? []).entries()) {
      requireMember(step.role, `workflow.steps.${index}.role`);
    }
  } else {
    for (const [index, state] of (team.workflow.states ?? []).entries()) {
      requireMember(state.role, `workflow.states.${index}.role`);
    }
  }

  for (const [ownerId, routes] of Object.entries(team.communicationMatrix)) {
    requireMember(ownerId, `communicationMatrix.${ownerId}`);
    for (const [field, targets] of [
      ['canSendTo', routes.canSendTo],
      ['canReceiveFrom', routes.canReceiveFrom],
      ['canEscalateTo', routes.canEscalateTo ?? []],
    ] as const) {
      for (const targetId of targets) requireMember(targetId, `communicationMatrix.${ownerId}.${field}`);
    }
  }

  return memberIds;
}

function outcomeEventIds(outcomeId: string): string[] {
  return (getDb().prepare(`
    SELECT id FROM platform_event
    WHERE aggregate_type='agent_outcome' AND aggregate_id=?
    ORDER BY stream_sequence,id
  `).all(outcomeId) as Array<{ id: string }>).map((row) => row.id);
}

function rejectedReceipt(
  command: WorkSubmitOutcomeCommand,
  reasonCode: string,
  recordedAt = new Date().toISOString(),
): CommandReceipt<WorkOutcomeCommandResult> {
  return {
    commandId: command.commandId,
    status: 'rejected',
    reasonCode,
    subject: command.subject ?? { type: 'agent_work', id: command.input.workId },
    eventIds: outcomeEventIds(command.input.outcomeId),
    evidenceRefs: command.input.evidenceRefs,
    recordedAt,
  };
}

function genericRejectedReceipt(
  command: SupportedProductCommand,
  reasonCode: string,
): CommandReceipt<SupportedCommandResult> {
  return {
    commandId: command.commandId,
    status: 'rejected',
    reasonCode,
    ...(command.subject ? { subject: command.subject } : {}),
    eventIds: [],
    evidenceRefs: [],
    recordedAt: new Date().toISOString(),
  };
}

export class CommandService {
  execute(command: SupportedProductCommand): CommandReceipt<SupportedCommandResult> {
    if (command.name === 'work.create') return this.createWork(command);
    if (command.name === 'project.create') return this.createProject(command);
    if (command.name === 'project.agent.add') return this.changeProjectAgent(command, 'add');
    if (command.name === 'project.agent.remove') return this.changeProjectAgent(command, 'remove');
    if (command.name === 'review.create') return this.createReview(command);
    if (command.name === 'review.record_decision') return this.recordReviewDecision(command);
    if (command.name === 'agent_team.create') return this.createAgentTeam(command);
    if (command.name === 'agent_team.update') return this.updateAgentTeam(command);
    if (command.name === 'agent_team.delete') return this.deleteAgentTeam(command);
    if (command.name === 'agent_team.deploy') return this.deployAgentTeam(command);
    if (command.name === 'agent.create') return this.createAgent(command);
    if (command.name === 'agent.update') return this.updateAgent(command);
    if (command.name === 'automation.create') return this.createAutomation(command);
    if (command.name === 'automation.update') return this.updateAutomation(command);
    if (command.name === 'automation.set_enabled') return this.setAutomationEnabled(command);
    if (command.name === 'automation.trigger') return this.triggerAutomation(command);
    if (command.name === 'automation.retry') return this.retryAutomation(command);
    if (command.name === 'automation.decide') return this.decideAutomation(command);
    if (command.name === 'release.create') return this.createRelease(command);
    if (command.name === 'release.publish') return this.publishRelease(command);
    if (command.name !== 'work.submit_outcome') return genericRejectedReceipt(command, 'command_not_supported');
    const outcome = command.input;
    if (
      command.commandId !== outcome.outcomeId
      || command.projectId !== outcome.projectId
      || command.idempotencyKey !== outcome.idempotencyKey
      || command.correlationId !== outcome.correlationId
      || command.causationId !== outcome.causationId
    ) {
      return rejectedReceipt(command, 'command_envelope_mismatch');
    }
    try {
      const admission = workContractRepo.admitOutcome(outcome);
      // A duplicate replays the persisted admission decision. In particular,
      // replaying a rejected outcome must never turn it into an accepted exit.
      const accepted = admission.outcome.admission_status === 'accepted';
      const reasonCode = admission.status === 'rejected'
        ? admission.reasonCode
        : admission.outcome.rejection_reason ?? undefined;
      return {
        commandId: command.commandId,
        status: !accepted
          ? 'rejected'
          : admission.status === 'accepted'
          ? 'applied'
          : 'duplicate',
        ...(reasonCode ? { reasonCode } : {}),
        subject: command.subject ?? { type: 'agent_work', id: outcome.workId },
        eventIds: outcomeEventIds(outcome.outcomeId),
        evidenceRefs: outcome.evidenceRefs,
        result: {
          outcomeId: admission.outcome.id,
          outcomeType: admission.outcome.outcome_type,
          exitAccepted: accepted,
        },
        recordedAt: admission.outcome.recorded_at,
      };
    } catch (error) {
      if (error instanceof AgentOutcomeIdempotencyConflictError) {
        return {
          ...rejectedReceipt(command, error.reasonCode),
          status: 'conflict',
        };
      }
      if (error instanceof WorkContractInvariantError) {
        return rejectedReceipt(command, error.reasonCode);
      }
      throw error;
    }
  }

  private createWork(command: WorkCreateCommand): CommandReceipt<WorkCreateCommandResult> {
    if (
      command.projectId === 'workspace'
      || command.subject
      || !['user', 'agent', 'system'].includes(command.actor.type)
      || !command.commandId.trim()
      || !command.idempotencyKey.trim()
      || !command.input.title.trim()
      || !['issue', 'change_request', 'improvement'].includes(command.input.category)
    ) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<WorkCreateCommandResult>;
    }
    const project = projectRepo.getById(command.projectId);
    if (!project?.workspace_conversation_id) {
      return genericRejectedReceipt(command, 'work_project_not_found') as CommandReceipt<WorkCreateCommandResult>;
    }
    const taskId = `work-${createHash('sha256').update(command.idempotencyKey).digest('hex').slice(0, 24)}`;
    try {
      return getDb().transaction((): CommandReceipt<WorkCreateCommandResult> => {
        const replaying = taskCommandService.hasRecordedCommand(
          project.workspace_conversation_id,
          command.idempotencyKey,
        );
        const commit = taskCommandService.create({
          conversationId: project.workspace_conversation_id,
          expectedGraphRevision: taskCommandService.expectedGraphRevision(
            project.workspace_conversation_id,
            command.idempotencyKey,
          ),
          idempotencyKey: command.idempotencyKey,
          actor: { type: command.actor.type as 'user' | 'agent' | 'system', id: command.actor.id },
          correlationId: command.correlationId,
          causationId: command.causationId,
          task: {
            id: taskId,
            title: command.input.title.trim(),
            category: command.input.category,
            description: command.input.description?.trim() ?? '',
            agent_id: '',
            dependencies: [],
            artifacts: [],
          },
        });
        const task = commit.tasks[0];
        if (!task) throw new Error('work_create_missing_task');
        const event = new PlatformEventLog().append({
          type: 'work.created',
          category: 'domain',
          projectId: project.workspace_conversation_id,
          streamKey: `work:${task.id}`,
          aggregate: { type: 'work', id: task.id, version: task.revision },
          actor: { type: command.actor.type as 'user' | 'agent' | 'system', id: command.actor.id },
          subject: { type: 'work', id: task.id },
          correlationId: command.correlationId,
          causationId: command.causationId,
          dedupeKey: `command:${command.idempotencyKey}:work.created`,
          payload: {
            projectId: command.projectId,
            title: command.input.title.trim(),
            category: command.input.category,
            description: command.input.description?.trim() ?? '',
          },
        });
        return {
          commandId: command.commandId,
          status: replaying ? 'duplicate' : 'applied',
          subject: { type: 'work', id: task.id },
          revision: task.revision,
          eventIds: [event.eventId],
          evidenceRefs: [],
          result: { task },
          recordedAt: event.recordedAt,
        };
      })();
    } catch (error) {
      if (error instanceof TaskGraphIdempotencyConflictError || error instanceof PlatformEventDedupeConflictError) {
        return { ...genericRejectedReceipt(command, 'command_idempotency_conflict'), status: 'conflict' } as CommandReceipt<WorkCreateCommandResult>;
      }
      if (error instanceof StaleTaskGraphRevisionError) {
        return { ...genericRejectedReceipt(command, error.reasonCode), status: 'conflict' } as CommandReceipt<WorkCreateCommandResult>;
      }
      if (error instanceof InvalidTaskGraphError) {
        return genericRejectedReceipt(command, error.message) as CommandReceipt<WorkCreateCommandResult>;
      }
      throw error;
    }
  }

  private createProject(command: ProjectCreateCommand): CommandReceipt<ProjectCreateCommandResult> {
    if (
      command.projectId !== 'workspace'
      || command.subject
      || command.actor.type !== 'user'
      || !command.commandId.trim()
      || !command.idempotencyKey.trim()
    ) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<ProjectCreateCommandResult>;
    }
    try {
      return getDb().transaction((): CommandReceipt<ProjectCreateCommandResult> => {
        const eventLog = new PlatformEventLog();
        const dedupeKey = `command:${command.idempotencyKey}:project.registered`;
        const replaying = Boolean(eventLog.getByDedupeKey(dedupeKey));
        const existing = projectRepo.getByRootPath(command.input.rootPath);
        const project = projectRepo.create(command.input);
        const workspace = conversationRepo.getById(project.workspace_conversation_id);
        if (!workspace || workspace.workspace_kind !== 'project_workspace') {
          throw new Error('project_workspace_not_found');
        }
        const payload = replaying
          ? {
              name: command.input.name.trim(),
              rootPath: canonicalProjectRootPath(command.input.rootPath),
            }
          : {
              name: project.name,
              rootPath: canonicalProjectRootPath(project.root_path),
            };
        const event = eventLog.append({
          type: 'project.registered',
          category: 'domain',
          projectId: project.workspace_conversation_id,
          streamKey: `project:${project.id}`,
          aggregate: { type: 'project', id: project.id },
          actor: { type: 'user', id: command.actor.id },
          subject: { type: 'project', id: project.id },
          correlationId: command.correlationId,
          causationId: command.causationId,
          dedupeKey,
          // Dedupe compares the canonical incoming command, not the resulting
          // row. This preserves conflict detection when a path already exists
          // but the caller reuses the key with a different requested name.
          payload,
        });
        return {
          commandId: command.commandId,
          status: existing ? 'duplicate' : 'applied',
          subject: { type: 'project', id: project.id },
          eventIds: [event.eventId],
          evidenceRefs: [],
          result: { project, workspace },
          recordedAt: event.recordedAt,
        };
      })();
    } catch (error) {
      if (error instanceof PlatformEventDedupeConflictError) {
        return {
          ...genericRejectedReceipt(command, error.reasonCode),
          status: 'conflict',
        } as CommandReceipt<ProjectCreateCommandResult>;
      }
      const reasonCode = error instanceof Error ? error.message : 'project_create_failed';
      if (reasonCode === 'project_name_required' || reasonCode === 'project_path_required') {
        return genericRejectedReceipt(command, reasonCode) as CommandReceipt<ProjectCreateCommandResult>;
      }
      throw error;
    }
  }

  private changeProjectAgent(
    command: ProjectAgentAddCommand | ProjectAgentRemoveCommand,
    action: 'add' | 'remove',
  ): CommandReceipt<ProjectAgentMembershipCommandResult> {
    const agentId = command.input.agentId.trim();
    if (
      command.projectId === 'workspace'
      || command.subject?.type !== 'agent'
      || command.subject.id !== agentId
      || command.actor.type !== 'user'
      || !hasCommandIdentity(command)
      || !agentId
    ) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<ProjectAgentMembershipCommandResult>;
    }
    const eventType = action === 'add' ? 'project.agent_added' : 'project.agent_removed';
    const dedupeKey = `command:${command.idempotencyKey}:${eventType}`;
    const canonicalCommand = { name: command.name, projectId: command.projectId, agentId };
    const eventLog = new PlatformEventLog();
    try {
      return getDb().transaction((): CommandReceipt<ProjectAgentMembershipCommandResult> => {
        const existingEvent = eventLog.getByDedupeKey(dedupeKey);
        if (existingEvent) {
          const frozen = existingEvent.payload as {
            command?: typeof canonicalCommand;
            result?: ProjectAgentMembershipCommandResult;
          };
          if (!frozen.command || !frozen.result || canonicalJson(frozen.command) !== canonicalJson(canonicalCommand)) {
            throw new PlatformEventDedupeConflictError(dedupeKey);
          }
          const replay = eventLog.append({
            type: eventType,
            category: 'domain',
            projectId: existingEvent.projectId,
            streamKey: existingEvent.streamKey,
            aggregate: existingEvent.aggregate,
            actor: { type: 'user', id: command.actor.id },
            subject: existingEvent.subject,
            correlationId: command.correlationId,
            causationId: command.causationId,
            dedupeKey,
            payload: existingEvent.payload,
          });
          return {
            commandId: command.commandId,
            status: 'duplicate',
            subject: replay.subject,
            eventIds: [replay.eventId],
            evidenceRefs: [],
            result: frozen.result,
            recordedAt: replay.recordedAt,
          };
        }

        const project = projectRepo.getById(command.projectId);
        if (!project?.workspace_conversation_id) throw new Error('project_not_found');
        if (action === 'add') validateAgentIds([agentId]);
        const changed = action === 'add'
          ? projectAgentMembershipRepo.add(project.id, agentId, 'manual')
          : projectAgentMembershipRepo.remove(project.id, agentId);
        const result: ProjectAgentMembershipCommandResult = {
          projectId: project.id,
          agentId,
          agentIds: projectAgentMembershipRepo.listAgentIdsByProject(project.id),
        };
        const event = eventLog.append({
          type: eventType,
          category: 'domain',
          projectId: project.workspace_conversation_id,
          streamKey: `project:${project.id}:agents`,
          aggregate: { type: 'project', id: project.id },
          actor: { type: 'user', id: command.actor.id },
          subject: { type: 'agent', id: agentId },
          correlationId: command.correlationId,
          causationId: command.causationId,
          dedupeKey,
          payload: { command: canonicalCommand, result },
        });
        return {
          commandId: command.commandId,
          status: changed ? 'applied' : 'duplicate',
          subject: { type: 'agent', id: agentId },
          eventIds: [event.eventId],
          evidenceRefs: [],
          result,
          recordedAt: event.recordedAt,
        };
      })();
    } catch (error) {
      if (error instanceof PlatformEventDedupeConflictError) {
        return { ...genericRejectedReceipt(command, error.reasonCode), status: 'conflict' } as CommandReceipt<ProjectAgentMembershipCommandResult>;
      }
      const reasonCode = error instanceof Error ? error.message : 'project_agent_change_failed';
      return genericRejectedReceipt(command, reasonCode) as CommandReceipt<ProjectAgentMembershipCommandResult>;
    }
  }

  private createReview(command: ReviewCreateCommand): CommandReceipt<ReviewCommandResult> {
    if (
      command.projectId === 'workspace'
      || command.subject
      || !['user', 'agent'].includes(command.actor.type)
      || !command.commandId.trim()
      || !command.idempotencyKey.trim()
    ) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<ReviewCommandResult>;
    }
    const reviewId = `review-${createHash('sha256').update(command.idempotencyKey).digest('hex').slice(0, 24)}`;
    try {
      return getDb().transaction((): CommandReceipt<ReviewCommandResult> => {
        const created = projectReviewRepo.create({
          id: reviewId,
          projectId: command.projectId,
          ...command.input,
        });
        const project = projectRepo.getById(command.projectId);
        if (!project?.workspace_conversation_id) throw new Error('review_project_workspace_not_found');
        const event = new PlatformEventLog().append({
          type: 'review.created',
          category: 'domain',
          projectId: project.workspace_conversation_id,
          streamKey: `review:${reviewId}`,
          aggregate: { type: 'review', id: reviewId, version: 1 },
          actor: { type: command.actor.type as 'user' | 'agent', id: command.actor.id },
          subject: { type: 'review', id: reviewId },
          correlationId: command.correlationId,
          causationId: command.causationId,
          dedupeKey: `command:${command.idempotencyKey}:review.created`,
          payload: {
            repositoryRoot: command.input.repositoryRoot.trim().replace(/[\\/]+$/, ''),
            baseRef: command.input.baseRef.trim(),
            compareRef: command.input.compareRef.trim(),
            title: command.input.title.trim(),
            description: command.input.description?.trim() ?? '',
          },
        });
        const resultRow = created.created ? created.row : {
          ...created.row,
          repository_root: String(event.payload.repositoryRoot),
          base_ref: String(event.payload.baseRef),
          compare_ref: String(event.payload.compareRef),
          title: String(event.payload.title),
          description: String(event.payload.description),
          status: 'open' as const,
          decision_summary: null,
          revision: event.aggregate.version ?? 1,
          created_at: event.recordedAt,
          updated_at: event.recordedAt,
        };
        return {
          commandId: command.commandId,
          status: created.created ? 'applied' : 'duplicate',
          subject: { type: 'review', id: reviewId },
          revision: resultRow.revision,
          eventIds: [event.eventId],
          evidenceRefs: [],
          result: { review: projectReviewFromRow(resultRow) },
          recordedAt: event.recordedAt,
        };
      })();
    } catch (error) {
      if (error instanceof PlatformEventDedupeConflictError) {
        return { ...genericRejectedReceipt(command, error.reasonCode), status: 'conflict' } as CommandReceipt<ReviewCommandResult>;
      }
      const reasonCode = error instanceof Error ? error.message : 'review_create_failed';
      const status = reasonCode === 'review_idempotency_conflict' ? 'conflict' : 'rejected';
      return { ...genericRejectedReceipt(command, reasonCode), status } as CommandReceipt<ReviewCommandResult>;
    }
  }

  private recordReviewDecision(command: ReviewRecordDecisionCommand): CommandReceipt<ReviewCommandResult> {
    if (
      command.subject?.type !== 'review'
      || command.subject.id !== command.input.reviewId
      || !['user', 'agent'].includes(command.actor.type)
      || !Number.isSafeInteger(command.expectedRevision)
      || Number(command.expectedRevision) < 1
    ) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<ReviewCommandResult>;
    }
    const reviewAtStart = projectReviewRepo.getById(command.input.reviewId);
    if (!reviewAtStart) return genericRejectedReceipt(command, 'review_not_found') as CommandReceipt<ReviewCommandResult>;
    if (reviewAtStart.project_id !== command.projectId) {
      return genericRejectedReceipt(command, 'review_project_mismatch') as CommandReceipt<ReviewCommandResult>;
    }
    const project = projectRepo.getById(command.projectId);
    if (!project?.workspace_conversation_id) {
      return genericRejectedReceipt(command, 'review_project_workspace_not_found') as CommandReceipt<ReviewCommandResult>;
    }
    const eventLog = new PlatformEventLog();
    const eventInput = {
      type: 'review.decision_recorded' as const,
      category: 'domain' as const,
      projectId: project.workspace_conversation_id,
      streamKey: `review:${command.input.reviewId}`,
      aggregate: { type: 'review', id: command.input.reviewId, version: Number(command.expectedRevision) + 1 },
      actor: { type: command.actor.type as 'user' | 'agent', id: command.actor.id },
      subject: { type: 'review', id: command.input.reviewId },
      correlationId: command.correlationId,
      causationId: command.causationId,
      dedupeKey: `command:${command.idempotencyKey}:review.decision_recorded`,
      payload: { status: command.input.status, summary: command.input.summary.trim() },
    };
    try {
      return getDb().transaction((): CommandReceipt<ReviewCommandResult> => {
        const existingEvent = eventLog.getByDedupeKey(eventInput.dedupeKey);
        if (existingEvent) {
          const replay = eventLog.append(eventInput);
          const current = projectReviewRepo.getById(command.input.reviewId);
          if (!current) throw new Error('review_not_found');
          const originalPayload = replay.payload as {
            status: ReviewRecordDecisionCommand['input']['status'];
            summary: string;
          };
          const originalRevision = replay.aggregate.version ?? Number(command.expectedRevision) + 1;
          const original = projectReviewFromRow({
            ...current,
            status: originalPayload.status,
            decision_summary: originalPayload.summary,
            revision: originalRevision,
            updated_at: replay.recordedAt,
          });
          return {
            commandId: command.commandId,
            status: 'duplicate',
            subject: { type: 'review', id: current.id },
            revision: originalRevision,
            eventIds: [replay.eventId],
            evidenceRefs: [],
            result: { review: original },
            recordedAt: replay.recordedAt,
          };
        }
        const updated = projectReviewRepo.recordDecision({
          id: command.input.reviewId,
          expectedRevision: Number(command.expectedRevision),
          status: command.input.status,
          summary: command.input.summary,
        });
        const event = eventLog.append(eventInput);
        return {
          commandId: command.commandId,
          status: 'applied',
          subject: { type: 'review', id: updated.id },
          revision: updated.revision,
          eventIds: [event.eventId],
          evidenceRefs: [],
          result: { review: projectReviewFromRow(updated) },
          recordedAt: event.recordedAt,
        };
      })();
    } catch (error) {
      if (error instanceof PlatformEventDedupeConflictError) {
        return { ...genericRejectedReceipt(command, error.reasonCode), status: 'conflict' } as CommandReceipt<ReviewCommandResult>;
      }
      const reasonCode = error instanceof Error ? error.message : 'review_decision_failed';
      const status = reasonCode === 'review_revision_conflict' ? 'conflict' : 'rejected';
      return { ...genericRejectedReceipt(command, reasonCode), status } as CommandReceipt<ReviewCommandResult>;
    }
  }

  private deployAgentTeam(command: AgentTeamDeployCommand): CommandReceipt<AgentTeamDeployCommandResult> {
    if (
      command.subject?.type !== 'agent_team'
      || command.subject.id !== command.input.teamId
      || command.actor.type !== 'user'
      || !hasCommandIdentity(command)
      || !command.input.channelId.trim()
    ) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AgentTeamDeployCommandResult>;
    }
    const eventLog = new PlatformEventLog();
    const dedupeKey = `command:${command.idempotencyKey}:agent_team.deployed`;
    const payload = canonicalAgentTeamDeployPayload(command);
    try {
      return getDb().transaction((): CommandReceipt<AgentTeamDeployCommandResult> => {
        const existingEvent = eventLog.getByDedupeKey(dedupeKey);
        if (existingEvent) {
          const frozen = agentTeamDeployEventPayload(existingEvent.payload);
          const legacyProject = !frozen.command.projectId
            ? getDb().prepare('SELECT project_id FROM conversation WHERE id=?').get(frozen.result.channelId) as {
              project_id: string | null;
            } | undefined
            : undefined;
          if (!frozen.command.projectId && !legacyProject?.project_id) {
            throw new Error('agent_team_event_project_identity_missing');
          }
          const frozenCommand = {
            ...frozen.command,
            projectId: frozen.command.projectId || legacyProject!.project_id!,
          };
          if (canonicalJson(frozenCommand) !== canonicalJson(payload)) {
            throw new PlatformEventDedupeConflictError(dedupeKey);
          }
          const replay = eventLog.append({
            type: 'agent_team.deployed', category: 'domain', projectId: existingEvent.projectId,
            streamKey: existingEvent.streamKey, aggregate: existingEvent.aggregate,
            actor: { type: 'user', id: command.actor.id }, subject: existingEvent.subject,
            correlationId: command.correlationId, causationId: command.causationId,
            dedupeKey, payload: existingEvent.payload,
          });
          return {
            commandId: command.commandId,
            status: 'duplicate',
            subject: replay.subject,
            eventIds: [replay.eventId],
            evidenceRefs: [],
            result: frozen.result,
            recordedAt: replay.recordedAt,
          };
        }
        const team = teamPackRepo.getById(command.input.teamId);
        if (!team) throw new Error('agent_team_not_found');
        const assignedAgentIds = validateAgentIds(team.roles.map((role) => role.id));
        const channel = getDb().prepare(`
          SELECT id,project_id,team_pack_id FROM conversation
          WHERE id=? AND project_id=? AND workspace_kind='project_workspace'
        `).get(command.input.channelId, command.projectId) as {
          id: string;
          project_id: string;
          team_pack_id: string | null;
        } | undefined;
        if (!channel) throw new Error('agent_team_channel_not_found');
        const currentAgentIds = projectAgentMembershipRepo.listAgentIdsByProject(channel.project_id);
        const changed = channel.team_pack_id !== team.id
          || canonicalJson([...currentAgentIds].sort()) !== canonicalJson([...assignedAgentIds].sort());
        if (changed) {
          getDb().prepare('UPDATE conversation SET team_pack_id=?,updated_at=? WHERE id=?')
            .run(team.id, new Date().toISOString(), channel.id);
          projectAgentMembershipRepo.replace(channel.project_id, assignedAgentIds, 'team');
        }
        const result: AgentTeamDeployCommandResult = {
          teamId: team.id,
          channelId: channel.id,
          assignedAgentIds,
          runtimeReadiness: 'pending_first_trigger',
        };
        const event = eventLog.append({
          type: 'agent_team.deployed',
          category: 'domain',
          projectId: channel.id,
          streamKey: `channel:${channel.id}:agent_team`,
          aggregate: { type: 'agent_team', id: team.id, version: 1 },
          actor: { type: 'user', id: command.actor.id },
          subject: { type: 'agent_team', id: team.id },
          correlationId: command.correlationId,
          causationId: command.causationId,
          dedupeKey,
          payload: { command: payload, result },
        });
        return {
          commandId: command.commandId,
          status: changed ? 'applied' : 'duplicate',
          subject: { type: 'agent_team', id: team.id },
          eventIds: [event.eventId],
          evidenceRefs: [],
          result,
          recordedAt: event.recordedAt,
        };
      })();
    } catch (error) {
      if (error instanceof PlatformEventDedupeConflictError) {
        return { ...genericRejectedReceipt(command, error.reasonCode), status: 'conflict' } as CommandReceipt<AgentTeamDeployCommandResult>;
      }
      const reasonCode = error instanceof Error ? error.message : 'agent_team_deploy_failed';
      return genericRejectedReceipt(command, reasonCode) as CommandReceipt<AgentTeamDeployCommandResult>;
    }
  }

  private createAgentTeam(command: AgentTeamCreateCommand): CommandReceipt<AgentTeamCreateCommandResult> {
    if (
      command.projectId !== 'workspace'
      || command.subject
      || command.actor.type !== 'user'
      || !command.commandId.trim()
      || !command.idempotencyKey.trim()
      || !command.input.displayName?.trim()
      || !Array.isArray(command.input.members)
      || command.input.members.length === 0
    ) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AgentTeamCreateCommandResult>;
    }
    const eventLog = new PlatformEventLog();
    const dedupeKey = `command:${command.idempotencyKey}:agent_team.created`;
    const payload = canonicalAgentTeamPayload(command.input);
    try {
      return getDb().transaction((): CommandReceipt<AgentTeamCreateCommandResult> => {
        const existingEvent = eventLog.getByDedupeKey(dedupeKey);
        if (existingEvent) {
          const frozen = agentTeamEventPayload(existingEvent.payload);
          if (canonicalJson(frozen.command) !== canonicalJson(payload)) {
            throw new PlatformEventDedupeConflictError(dedupeKey);
          }
          const replay = eventLog.append({
            type: 'agent_team.created', category: 'domain', projectId: 'workspace',
            streamKey: `agent_team:${existingEvent.aggregate.id}`,
            aggregate: existingEvent.aggregate,
            actor: { type: 'user', id: command.actor.id },
            subject: existingEvent.subject,
            correlationId: command.correlationId,
            causationId: command.causationId,
            dedupeKey,
            payload: existingEvent.payload,
          });
          const team = frozen.team ?? teamPackRepo.getById(existingEvent.aggregate.id);
          if (!team) throw new Error('agent_team_not_found');
          return {
            commandId: command.commandId,
            status: 'duplicate',
            subject: { type: 'agent_team', id: team.id },
            eventIds: [replay.eventId],
            evidenceRefs: [],
            result: { team },
            recordedAt: replay.recordedAt,
          };
        }
        ensureWorkspaceConversation();
        validateAgentTeamMembers(command.input);
        const team = teamPackRepo.createFromAgentRefs(command.input);
        const event = eventLog.append({
          type: 'agent_team.created', category: 'domain', projectId: 'workspace',
          streamKey: `agent_team:${team.id}`,
          aggregate: { type: 'agent_team', id: team.id, version: 1 },
          actor: { type: 'user', id: command.actor.id },
          subject: { type: 'agent_team', id: team.id },
          correlationId: command.correlationId,
          causationId: command.causationId,
          dedupeKey,
          payload: { command: payload, team },
        });
        return {
          commandId: command.commandId,
          status: 'applied',
          subject: { type: 'agent_team', id: team.id },
          eventIds: [event.eventId],
          evidenceRefs: [],
          result: { team },
          recordedAt: event.recordedAt,
        };
      })();
    } catch (error) {
      if (error instanceof PlatformEventDedupeConflictError) {
        return { ...genericRejectedReceipt(command, error.reasonCode), status: 'conflict' } as CommandReceipt<AgentTeamCreateCommandResult>;
      }
      const reasonCode = error instanceof Error ? error.message : 'agent_team_create_failed';
      return genericRejectedReceipt(command, reasonCode) as CommandReceipt<AgentTeamCreateCommandResult>;
    }
  }

  private updateAgentTeam(command: AgentTeamUpdateCommand): CommandReceipt<AgentTeamCreateCommandResult> {
    if (
      command.projectId !== 'workspace'
      || command.actor.type !== 'user'
      || command.subject?.type !== 'agent_team'
      || command.subject.id !== command.input.id
      || !hasCommandIdentity(command)
      || !Number.isSafeInteger(command.expectedRevision)
      || Number(command.expectedRevision) < 1
      || !Array.isArray(command.input.members)
      || command.input.members.length === 0
    ) return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AgentTeamCreateCommandResult>;
    const eventLog = new PlatformEventLog();
    const dedupeKey = `command:${command.idempotencyKey}:agent_team.updated`;
    const payload = { expectedRevision: Number(command.expectedRevision), team: canonicalAgentTeamPayload(command.input) };
    try {
      return getDb().transaction((): CommandReceipt<AgentTeamCreateCommandResult> => {
        ensureWorkspaceConversation();
        const existingEvent = eventLog.getByDedupeKey(dedupeKey);
        if (existingEvent) {
          const frozen = agentTeamUpdateEventPayload(existingEvent.payload);
          if (canonicalJson(frozen.command) !== canonicalJson(payload)) throw new PlatformEventDedupeConflictError(dedupeKey);
          const replay = eventLog.append({
            type: 'agent_team.updated', category: 'domain', projectId: 'workspace',
            streamKey: `agent_team:${command.input.id}`, aggregate: existingEvent.aggregate,
            actor: { type: 'user', id: command.actor.id }, subject: { type: 'agent_team', id: command.input.id },
            correlationId: command.correlationId, causationId: command.causationId,
            dedupeKey, payload: existingEvent.payload,
          });
          return {
            commandId: command.commandId, status: 'duplicate', subject: replay.subject,
            revision: replay.aggregate.version, eventIds: [replay.eventId], evidenceRefs: [],
            result: { team: frozen.team }, recordedAt: replay.recordedAt,
          };
        }
        const current = teamPackRepo.getById(command.input.id);
        if (!current) throw new Error('agent_team_not_found');
        if ((current.revision ?? 1) !== command.expectedRevision) throw new Error('agent_team_revision_conflict');
        validateAgentTeamMembers(command.input);
        const updated = teamPackRepo.updateFromAgentRefs(command.input.id, command.input);
        const team = { ...updated, revision: Number(command.expectedRevision) + 1 };
        const event = eventLog.append({
          type: 'agent_team.updated', category: 'domain', projectId: 'workspace',
          streamKey: `agent_team:${team.id}`, aggregate: { type: 'agent_team', id: team.id, version: team.revision },
          actor: { type: 'user', id: command.actor.id }, subject: { type: 'agent_team', id: team.id },
          correlationId: command.correlationId, causationId: command.causationId,
          dedupeKey, payload: { command: payload, team },
        });
        return {
          commandId: command.commandId, status: 'applied', subject: event.subject,
          revision: team.revision, eventIds: [event.eventId], evidenceRefs: [], result: { team }, recordedAt: event.recordedAt,
        };
      })();
    } catch (error) {
      const reasonCode = error instanceof Error ? error.message : 'agent_team_update_failed';
      const status = error instanceof PlatformEventDedupeConflictError || reasonCode === 'agent_team_revision_conflict' ? 'conflict' : 'rejected';
      return { ...genericRejectedReceipt(command, reasonCode), status } as CommandReceipt<AgentTeamCreateCommandResult>;
    }
  }

  private deleteAgentTeam(command: AgentTeamDeleteCommand): CommandReceipt<AgentTeamDeleteCommandResult> {
    if (
      command.projectId !== 'workspace'
      || command.actor.type !== 'user'
      || command.subject?.type !== 'agent_team'
      || command.subject.id !== command.input.teamId
      || !hasCommandIdentity(command)
      || !Number.isSafeInteger(command.expectedRevision)
      || Number(command.expectedRevision) < 1
    ) return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AgentTeamDeleteCommandResult>;
    const eventLog = new PlatformEventLog();
    const dedupeKey = `command:${command.idempotencyKey}:agent_team.deleted`;
    const payload = { teamId: command.input.teamId, expectedRevision: Number(command.expectedRevision) };
    try {
      return getDb().transaction((): CommandReceipt<AgentTeamDeleteCommandResult> => {
        const existingEvent = eventLog.getByDedupeKey(dedupeKey);
        if (existingEvent) {
          if (canonicalJson(existingEvent.payload) !== canonicalJson(payload)) throw new PlatformEventDedupeConflictError(dedupeKey);
          const replay = eventLog.append({
            type: 'agent_team.deleted', category: 'domain', projectId: 'workspace',
            streamKey: `agent_team:${command.input.teamId}`, aggregate: existingEvent.aggregate,
            actor: { type: 'user', id: command.actor.id }, subject: command.subject,
            correlationId: command.correlationId, causationId: command.causationId,
            dedupeKey, payload: existingEvent.payload,
          });
          return { commandId: command.commandId, status: 'duplicate', subject: replay.subject, revision: replay.aggregate.version, eventIds: [replay.eventId], evidenceRefs: [], result: { teamId: command.input.teamId }, recordedAt: replay.recordedAt };
        }
        const team = teamPackRepo.getById(command.input.teamId);
        if (!team) throw new Error('agent_team_not_found');
        if ((team.revision ?? 1) !== command.expectedRevision) throw new Error('agent_team_revision_conflict');
        teamPackRepo.delete(team.id);
        const event = eventLog.append({
          type: 'agent_team.deleted', category: 'domain', projectId: 'workspace',
          streamKey: `agent_team:${team.id}`, aggregate: { type: 'agent_team', id: team.id, version: (team.revision ?? 1) + 1 },
          actor: { type: 'user', id: command.actor.id }, subject: { type: 'agent_team', id: team.id },
          correlationId: command.correlationId, causationId: command.causationId,
          dedupeKey, payload,
        });
        return { commandId: command.commandId, status: 'applied', subject: event.subject, revision: (team.revision ?? 1) + 1, eventIds: [event.eventId], evidenceRefs: [], result: { teamId: team.id }, recordedAt: event.recordedAt };
      })();
    } catch (error) {
      const reasonCode = error instanceof Error ? error.message : 'agent_team_delete_failed';
      const status = error instanceof PlatformEventDedupeConflictError || reasonCode === 'agent_team_revision_conflict' ? 'conflict' : 'rejected';
      return { ...genericRejectedReceipt(command, reasonCode), status } as CommandReceipt<AgentTeamDeleteCommandResult>;
    }
  }

  private createAgent(command: AgentCreateCommand): CommandReceipt<AgentCommandResult> {
    if (
      command.projectId !== 'workspace'
      || command.subject
      || command.actor.type !== 'user'
      || !command.commandId.trim()
      || !command.idempotencyKey.trim()
    ) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AgentCommandResult>;
    }
    const eventLog = new PlatformEventLog();
    const dedupeKey = `command:${command.idempotencyKey}:agent.created`;
    const agentId = `agent-${createHash('sha256').update(command.idempotencyKey).digest('hex').slice(0, 24)}`;
    const payload = canonicalAgentCommandPayload(command.input);
    try {
      return getDb().transaction((): CommandReceipt<AgentCommandResult> => {
        ensureWorkspaceConversation();
        const replayEvent = eventLog.getByDedupeKey(dedupeKey);
        if (replayEvent) {
          const replayPayload = agentEventPayload(replayEvent.payload);
          assertAgentReplayInput(dedupeKey, replayPayload.command, payload);
          const replay = eventLog.append({
            type: 'agent.created', category: 'domain', projectId: 'workspace',
            streamKey: `agent:${replayEvent.aggregate.id}`,
            aggregate: replayEvent.aggregate,
            actor: { type: 'user', id: command.actor.id },
            subject: replayEvent.subject,
            correlationId: command.correlationId,
            causationId: command.causationId,
            dedupeKey,
            payload: replayEvent.payload,
          });
          const agent = replayPayload.agent ?? agentDefinitionRepo.get(replayEvent.aggregate.id);
          if (!agent) throw new Error('agent_not_found');
          return agentReceipt(command, agent, replay.eventId, replay.recordedAt, 'duplicate');
        }
        const agent = agentDefinitionRepo.save({ ...command.input, id: agentId });
        const event = eventLog.append({
          type: 'agent.created', category: 'domain', projectId: 'workspace',
          streamKey: `agent:${agent.id}`,
          aggregate: { type: 'agent', id: agent.id, version: agent.revision },
          actor: { type: 'user', id: command.actor.id },
          subject: { type: 'agent', id: agent.id },
          correlationId: command.correlationId,
          causationId: command.causationId,
          dedupeKey,
          payload: { command: payload, agent },
        });
        return agentReceipt(command, agent, event.eventId, event.recordedAt, 'applied');
      })();
    } catch (error) {
      if (error instanceof PlatformEventDedupeConflictError) {
        return { ...genericRejectedReceipt(command, error.reasonCode), status: 'conflict' } as CommandReceipt<AgentCommandResult>;
      }
      return genericRejectedReceipt(command, error instanceof Error ? error.message : 'agent_create_failed') as CommandReceipt<AgentCommandResult>;
    }
  }

  private updateAgent(command: AgentUpdateCommand): CommandReceipt<AgentCommandResult> {
    if (
      command.projectId !== 'workspace'
      || command.actor.type !== 'user'
      || command.subject?.type !== 'agent'
      || command.subject.id !== command.input.id
      || !Number.isSafeInteger(command.expectedRevision)
      || Number(command.expectedRevision) < 1
    ) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AgentCommandResult>;
    }
    const eventLog = new PlatformEventLog();
    const dedupeKey = `command:${command.idempotencyKey}:agent.updated`;
    const payload = canonicalAgentCommandPayload(command.input, Number(command.expectedRevision));
    try {
      return getDb().transaction((): CommandReceipt<AgentCommandResult> => {
        ensureWorkspaceConversation();
        const replayEvent = eventLog.getByDedupeKey(dedupeKey);
        if (replayEvent) {
          const replayPayload = agentEventPayload(replayEvent.payload);
          assertAgentReplayInput(dedupeKey, replayPayload.command, payload);
          const replay = eventLog.append({
            type: 'agent.updated', category: 'domain', projectId: 'workspace',
            streamKey: `agent:${command.input.id}`,
            aggregate: replayEvent.aggregate,
            actor: { type: 'user', id: command.actor.id },
            subject: { type: 'agent', id: command.input.id },
            correlationId: command.correlationId,
            causationId: command.causationId,
            dedupeKey,
            payload: replayEvent.payload,
          });
          const agent = replayPayload.agent ?? agentDefinitionRepo.get(command.input.id);
          if (!agent) throw new Error('agent_not_found');
          return agentReceipt(command, agent, replay.eventId, replay.recordedAt, 'duplicate');
        }
        const current = agentDefinitionRepo.get(command.input.id);
        if (!current) throw new Error('agent_not_found');
        if (current.revision !== command.expectedRevision) throw new Error('agent_revision_conflict');
        const agent = agentDefinitionRepo.save(command.input);
        const event = eventLog.append({
          type: 'agent.updated', category: 'domain', projectId: 'workspace',
          streamKey: `agent:${agent.id}`,
          aggregate: { type: 'agent', id: agent.id, version: agent.revision },
          actor: { type: 'user', id: command.actor.id },
          subject: { type: 'agent', id: agent.id },
          correlationId: command.correlationId,
          causationId: command.causationId,
          dedupeKey,
          payload: { command: payload, agent },
        });
        return agentReceipt(command, agent, event.eventId, event.recordedAt, 'applied');
      })();
    } catch (error) {
      if (error instanceof PlatformEventDedupeConflictError || (error instanceof Error && error.message === 'agent_revision_conflict')) {
        const reasonCode = error instanceof PlatformEventDedupeConflictError ? error.reasonCode : 'agent_revision_conflict';
        return { ...genericRejectedReceipt(command, reasonCode), status: 'conflict' } as CommandReceipt<AgentCommandResult>;
      }
      return genericRejectedReceipt(command, error instanceof Error ? error.message : 'agent_update_failed') as CommandReceipt<AgentCommandResult>;
    }
  }

  private createAutomation(command: AutomationCreateCommand): CommandReceipt<AutomationCommandResult> {
    if (!hasCommandIdentity(command) || command.actor.type !== 'user' || command.subject || !projectRepo.getById(command.projectId)) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AutomationCommandResult>;
    }
    try {
      validateAutomationDefinition(command.input);
      const project = projectRepo.getById(command.projectId)!;
      const eventLog = new PlatformEventLog();
      const repository = new AutomationRepository();
      const dedupeKey = automationCommandDedupeKey(command);
      const payload = canonicalAutomationDefinition(command.input);
      const envelope = canonicalAutomationEnvelope(command, payload);
      return getDb().transaction(() => {
        const replay = eventLog.getByDedupeKey(dedupeKey);
        if (replay) return replayAutomationReceipt(command, replay, envelope);
        const definition = repository.create({
          id: `automation-${createHash('sha256').update(command.idempotencyKey).digest('hex').slice(0, 24)}`,
          projectId: command.projectId,
          ...payload,
          enabled: false,
        });
        const event = eventLog.append({
          type: 'automation.created', category: 'domain', projectId: project.workspace_conversation_id,
          streamKey: `automation:${definition.id}`,
          aggregate: { type: 'automation', id: definition.id, version: definition.revision },
          actor: { type: 'user', id: command.actor.id }, subject: { type: 'automation', id: definition.id },
          correlationId: command.correlationId, causationId: command.causationId,
          dedupeKey, payload: { command: envelope, automation: definition },
        });
        return automationReceipt(command, definition, event.eventId, event.recordedAt, 'applied');
      }).immediate();
    } catch (error) {
      return automationErrorReceipt(command, error, 'automation_create_failed');
    }
  }

  private createRelease(command: ReleaseCreateCommand): CommandReceipt<ReleaseCommandResult> {
    if (!command.commandId.trim() || !command.idempotencyKey.trim() || command.actor.type !== 'user' || command.subject || !projectRepo.getById(command.projectId)) {
      return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<ReleaseCommandResult>;
    }
    const eventLog = new PlatformEventLog();
    const dedupeKey = `command:${command.idempotencyKey}:release.create`;
    const canonical = {
      name: command.input.name.trim(),
      description: command.input.description?.trim() ?? '',
      targets: [...command.input.targets].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)),
    };
    const envelope = { name: command.name, projectId: command.projectId, actor: command.actor, input: canonical };
    try {
      const project = projectRepo.getById(command.projectId)!;
      return getDb().transaction(() => {
        const replay = eventLog.getByDedupeKey(dedupeKey);
        if (replay) return replayReleaseReceipt(command, replay, envelope);
        const created = projectReleaseRepo.create({
          id: `release-${createHash('sha256').update(command.idempotencyKey).digest('hex').slice(0, 24)}`,
          projectId: command.projectId,
          ...canonical,
        });
        const event = eventLog.append({
          type: 'release.created', category: 'domain', projectId: project.workspace_conversation_id,
          streamKey: `release:${created.release.id}`,
          aggregate: { type: 'release', id: created.release.id, version: created.release.revision },
          actor: { type: 'user', id: command.actor.id }, subject: { type: 'release', id: created.release.id },
          correlationId: command.correlationId, causationId: command.causationId, dedupeKey,
          payload: { command: envelope, release: created.release },
        });
        return releaseReceipt(command, created.release, event, created.created ? 'applied' : 'duplicate');
      })();
    } catch (error) {
      return releaseErrorReceipt(command, error);
    }
  }

  private publishRelease(command: ReleasePublishCommand): CommandReceipt<ReleaseCommandResult> {
    if (
      !command.commandId.trim() || !command.idempotencyKey.trim() || command.actor.type !== 'user'
      || command.subject?.type !== 'release' || command.subject.id !== command.input.releaseId
      || !Number.isSafeInteger(command.expectedRevision) || !projectRepo.getById(command.projectId)
    ) return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<ReleaseCommandResult>;
    const eventLog = new PlatformEventLog();
    const dedupeKey = `command:${command.idempotencyKey}:release.publish`;
    const envelope = { name: command.name, projectId: command.projectId, actor: command.actor, subject: command.subject, expectedRevision: command.expectedRevision, input: command.input };
    try {
      const project = projectRepo.getById(command.projectId)!;
      return getDb().transaction(() => {
        const replay = eventLog.getByDedupeKey(dedupeKey);
        if (replay) return replayReleaseReceipt(command, replay, envelope);
        const current = projectReleaseRepo.get(command.input.releaseId);
        if (current?.projectId !== command.projectId) throw new Error('command_envelope_mismatch');
        const release = projectReleaseRepo.publish(current.id, command.expectedRevision!);
        const event = eventLog.append({
          type: 'release.published', category: 'domain', projectId: project.workspace_conversation_id,
          streamKey: `release:${release.id}`,
          aggregate: { type: 'release', id: release.id, version: release.revision },
          actor: { type: 'user', id: command.actor.id }, subject: { type: 'release', id: release.id },
          correlationId: command.correlationId, causationId: command.causationId, dedupeKey,
          payload: { command: envelope, release },
        });
        return releaseReceipt(command, release, event, 'applied');
      })();
    } catch (error) {
      return releaseErrorReceipt(command, error);
    }
  }

  private updateAutomation(command: AutomationUpdateCommand): CommandReceipt<AutomationCommandResult> {
    if (
      !hasCommandIdentity(command)
      || command.actor.type !== 'user'
      || command.subject?.type !== 'automation'
      || command.subject.id !== command.input.id
      || !Number.isSafeInteger(command.expectedRevision)
      || !projectRepo.getById(command.projectId)
    ) return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AutomationCommandResult>;
    try {
      validateAutomationDefinition(command.input);
      const project = projectRepo.getById(command.projectId)!;
      const eventLog = new PlatformEventLog();
      const repository = new AutomationRepository();
      const dedupeKey = automationCommandDedupeKey(command);
      const payload = canonicalAutomationDefinition(command.input);
      const envelope = canonicalAutomationEnvelope(command, payload);
      return getDb().transaction(() => {
        const replay = eventLog.getByDedupeKey(dedupeKey);
        if (replay) return replayAutomationReceipt(command, replay, envelope);
        if (repository.get(command.input.id)?.projectId !== command.projectId) throw new Error('command_envelope_mismatch');
        const definition = repository.update(command.input.id, command.expectedRevision!, payload);
        if (!definition) throw new Error('automation_revision_conflict');
        const event = eventLog.append({
          type: 'automation.updated', category: 'domain', projectId: project.workspace_conversation_id,
          streamKey: `automation:${definition.id}`,
          aggregate: { type: 'automation', id: definition.id, version: definition.revision },
          actor: { type: 'user', id: command.actor.id }, subject: { type: 'automation', id: definition.id },
          correlationId: command.correlationId, causationId: command.causationId,
          dedupeKey, payload: { command: envelope, automation: definition },
        });
        return automationReceipt(command, definition, event.eventId, event.recordedAt, 'applied');
      }).immediate();
    } catch (error) {
      return automationErrorReceipt(command, error, 'automation_update_failed');
    }
  }

  private setAutomationEnabled(command: AutomationSetEnabledCommand): CommandReceipt<AutomationCommandResult> {
    const repository = new AutomationRepository();
    if (
      !hasCommandIdentity(command)
      || command.actor.type !== 'user'
      || command.subject?.type !== 'automation'
      || command.subject.id !== command.input.automationId
      || typeof command.input.enabled !== 'boolean'
      || !Number.isSafeInteger(command.expectedRevision)
      || !projectRepo.getById(command.projectId)
    ) return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AutomationCommandResult>;
    const eventType = command.input.enabled ? 'automation.enabled' : 'automation.disabled';
    const dedupeKey = automationCommandDedupeKey(command);
    const payload = { enabled: command.input.enabled };
    const envelope = canonicalAutomationEnvelope(command, payload);
    try {
      const project = projectRepo.getById(command.projectId)!;
      const eventLog = new PlatformEventLog();
      return getDb().transaction(() => {
        const replay = eventLog.getByDedupeKey(dedupeKey);
        if (replay) return replayAutomationReceipt(command, replay, envelope);
        if (repository.get(command.input.automationId)?.projectId !== command.projectId) throw new Error('command_envelope_mismatch');
        const definition = repository.setEnabled(command.input.automationId, command.expectedRevision!, command.input.enabled);
        if (!definition) throw new Error('automation_revision_conflict');
        const event = eventLog.append({
          type: eventType, category: 'domain', projectId: project.workspace_conversation_id,
          streamKey: `automation:${definition.id}`,
          aggregate: { type: 'automation', id: definition.id, version: definition.revision },
          actor: { type: 'user', id: command.actor.id }, subject: { type: 'automation', id: definition.id },
          correlationId: command.correlationId, causationId: command.causationId,
          dedupeKey, payload: { command: envelope, automation: definition },
        });
        return automationReceipt(command, definition, event.eventId, event.recordedAt, 'applied');
      }).immediate();
    } catch (error) {
      return automationErrorReceipt(command, error, 'automation_enable_failed');
    }
  }

  private triggerAutomation(command: AutomationTriggerCommand): CommandReceipt<AutomationCommandResult> {
    const repository = new AutomationRepository();
    if (
      !hasCommandIdentity(command)
      || command.actor.type !== 'user'
      || command.subject?.type !== 'automation'
      || command.subject.id !== command.input.automationId
      || !projectRepo.getById(command.projectId)
    ) return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AutomationCommandResult>;
    const dedupeKey = automationCommandDedupeKey(command);
    const payload = { automationId: command.input.automationId };
    const envelope = canonicalAutomationEnvelope(command, payload);
    try {
      const project = projectRepo.getById(command.projectId)!;
      const eventLog = new PlatformEventLog();
      return getDb().transaction(() => {
        const replay = eventLog.getByDedupeKey(dedupeKey);
        if (replay) return replayAutomationReceipt(command, replay, envelope);
        const current = repository.get(command.input.automationId);
        if (current?.projectId !== command.projectId) throw new Error('command_envelope_mismatch');
        const run = new AutomationRuntime().triggerManual(current.id, command.actor.id, command.correlationId);
        const event = eventLog.append({
          type: 'automation.triggered', category: 'domain', projectId: project.workspace_conversation_id,
          streamKey: `automation:${current.id}`,
          aggregate: { type: 'automation', id: current.id, version: current.revision },
          actor: { type: 'user', id: command.actor.id }, subject: { type: 'automation_run', id: run.id },
          correlationId: command.correlationId, causationId: command.causationId,
          dedupeKey, payload: { command: envelope, automation: current, run },
        });
        return automationReceipt(command, current, event.eventId, event.recordedAt, 'applied', run);
      }).immediate();
    } catch (error) {
      return automationErrorReceipt(command, error, 'automation_trigger_failed');
    }
  }

  private retryAutomation(command: AutomationRetryCommand): CommandReceipt<AutomationCommandResult> {
    if (
      !hasCommandIdentity(command)
      || command.actor.type !== 'user'
      || command.subject?.type !== 'automation_run'
      || command.subject.id !== command.input.runId
      || !projectRepo.getById(command.projectId)
    ) return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AutomationCommandResult>;
    const repository = new AutomationRepository();
    const eventLog = new PlatformEventLog();
    const dedupeKey = automationCommandDedupeKey(command);
    const envelope = canonicalAutomationEnvelope(command, { runId: command.input.runId });
    try {
      const project = projectRepo.getById(command.projectId)!;
      return getDb().transaction(() => {
        const replay = eventLog.getByDedupeKey(dedupeKey);
        if (replay) return replayAutomationReceipt(command, replay, envelope);
        const currentRun = repository.getRun(command.input.runId);
        if (currentRun?.projectId !== command.projectId) throw new Error('command_envelope_mismatch');
        const definition = repository.get(currentRun.automationId);
        if (!definition) throw new Error('automation_not_found');
        const run = new AutomationRuntime().retryRun(currentRun.id, command.actor.id, command.correlationId);
        const event = eventLog.append({
          type: 'automation.retried', category: 'domain', projectId: project.workspace_conversation_id,
          streamKey: `automation:${definition.id}`,
          aggregate: { type: 'automation', id: definition.id, version: definition.revision },
          actor: { type: 'user', id: command.actor.id }, subject: { type: 'automation_run', id: run.id },
          correlationId: command.correlationId, causationId: command.causationId,
          dedupeKey, payload: { command: envelope, automation: definition, run },
        });
        return automationReceipt(command, definition, event.eventId, event.recordedAt, 'applied', run);
      }).immediate();
    } catch (error) {
      return automationErrorReceipt(command, error, 'automation_retry_failed');
    }
  }

  private decideAutomation(command: AutomationDecideCommand): CommandReceipt<AutomationCommandResult> {
    if (
      !hasCommandIdentity(command)
      || command.actor.type !== 'user'
      || command.subject?.type !== 'automation_decision'
      || command.subject.id !== command.input.decisionId
      || !['approved', 'denied'].includes(command.input.decision)
      || !projectRepo.getById(command.projectId)
    ) return genericRejectedReceipt(command, 'command_envelope_mismatch') as CommandReceipt<AutomationCommandResult>;
    const repository = new AutomationRepository();
    const eventLog = new PlatformEventLog();
    const dedupeKey = automationCommandDedupeKey(command);
    const envelope = canonicalAutomationEnvelope(command, {
      decisionId: command.input.decisionId,
      decision: command.input.decision,
      note: command.input.note?.trim() ?? '',
    });
    try {
      const project = projectRepo.getById(command.projectId)!;
      return getDb().transaction(() => {
        const replay = eventLog.getByDedupeKey(dedupeKey);
        if (replay) return replayAutomationReceipt(command, replay, envelope);
        const pending = repository.getDecision(command.input.decisionId);
        if (pending?.projectId !== command.projectId) throw new Error('command_envelope_mismatch');
        const definition = repository.get(pending.automationId);
        if (!definition) throw new Error('automation_not_found');
        const result = new AutomationRuntime().decide(
          pending.id,
          command.input.decision,
          command.actor.id,
          command.input.note,
          command.correlationId,
        );
        const event = eventLog.append({
          type: 'automation.decision_recorded', category: 'domain', projectId: project.workspace_conversation_id,
          streamKey: `automation:${definition.id}`,
          aggregate: { type: 'automation', id: definition.id, version: definition.revision },
          actor: { type: 'user', id: command.actor.id }, subject: { type: 'automation_decision', id: result.decision.id },
          correlationId: command.correlationId, causationId: command.causationId,
          dedupeKey, payload: { command: envelope, automation: definition, run: result.run, decision: result.decision },
        });
        return automationReceipt(
          command,
          definition,
          event.eventId,
          event.recordedAt,
          result.duplicate ? 'duplicate' : 'applied',
          result.run,
          result.decision,
        );
      }).immediate();
    } catch (error) {
      return automationErrorReceipt(command, error, 'automation_decision_failed');
    }
  }
}

function ensureWorkspaceConversation(): void {
  if (conversationRepo.getById('workspace')) return;
  conversationRepo.create({
    id: 'workspace',
    title: 'Workspace',
    goal: 'Workspace-scoped product objects and events',
    workspace_kind: 'workstream',
  });
}

function canonicalAgentTeamPayload(input: AgentTeamDefinitionInput) {
  return {
    name: input.name.trim(),
    displayName: input.displayName.trim(),
    description: input.description.trim(),
    version: input.version?.trim() ?? '1.0.0',
    tags: [...new Set(input.tags ?? [])].sort(),
    category: input.category?.trim() ?? 'agent-team',
    members: input.members.map((member) => ({ agentId: member.agentId.trim(), required: member.required !== false })),
    teamMode: input.teamMode,
    workflow: input.workflow,
    communicationMatrix: input.communicationMatrix,
    sharedContext: input.sharedContext ?? null,
    rules: input.rules ?? null,
  };
}

function canonicalAgentTeamDeployPayload(command: AgentTeamDeployCommand) {
  return {
    projectId: command.projectId.trim(),
    teamId: command.input.teamId.trim(),
    channelId: command.input.channelId.trim(),
  };
}

interface AgentTeamDeployEventPayload {
  command: ReturnType<typeof canonicalAgentTeamDeployPayload>;
  result: AgentTeamDeployCommandResult;
}

function agentTeamDeployEventPayload(payload: unknown): AgentTeamDeployEventPayload {
  if (!payload || typeof payload !== 'object') throw new Error('agent_team_event_snapshot_missing');
  if ('command' in payload && 'result' in payload) return payload as AgentTeamDeployEventPayload;
  const legacy = payload as Partial<AgentTeamDeployCommandResult>;
  if (!legacy.teamId || !legacy.channelId || !Array.isArray(legacy.assignedAgentIds)) {
    throw new Error('agent_team_event_snapshot_missing');
  }
  const result: AgentTeamDeployCommandResult = {
    teamId: legacy.teamId,
    channelId: legacy.channelId,
    assignedAgentIds: legacy.assignedAgentIds,
    runtimeReadiness: 'pending_first_trigger',
  };
  return {
    command: { projectId: '', teamId: result.teamId, channelId: result.channelId },
    result,
  };
}

interface AgentTeamEventPayload {
  command: ReturnType<typeof canonicalAgentTeamPayload>;
  team?: TeamPack;
}

function agentTeamEventPayload(payload: unknown): AgentTeamEventPayload {
  if (payload && typeof payload === 'object' && 'command' in payload) return payload as AgentTeamEventPayload;
  return { command: payload as ReturnType<typeof canonicalAgentTeamPayload> };
}

interface AgentTeamUpdateEventPayload {
  command: { expectedRevision: number; team: ReturnType<typeof canonicalAgentTeamPayload> };
  team: TeamPack;
}

function agentTeamUpdateEventPayload(payload: unknown): AgentTeamUpdateEventPayload {
  if (!payload || typeof payload !== 'object' || !('command' in payload) || !('team' in payload)) {
    throw new Error('agent_team_event_snapshot_missing');
  }
  return payload as AgentTeamUpdateEventPayload;
}

function canonicalAgentCommandPayload(input: SaveAgentDefinitionInput, expectedRevision: number | null = null) {
  return {
    name: input.name.trim(),
    instructions: input.instructions.trim(),
    responsibility: input.responsibility ?? 'specialist',
    theme: input.theme?.trim() ?? '',
    emoji: input.emoji?.trim() ?? '🤖',
    avatarUrl: input.avatarUrl?.trim() ?? '',
    runtimeMode: input.runtimeMode ?? 'defaults',
    runtimeId: input.runtimeId,
    accountIds: [...new Set(input.accountIds)].sort(),
    model: input.model?.trim() ?? '',
    skillIds: [...new Set(input.skillIds)].sort(),
    permissions: input.permissions ?? { canModifyCode: false, canReview: false },
    audience: {
      mode: input.audience?.mode ?? 'owner',
      ids: [...new Set(input.audience?.ids ?? [])].sort(),
    },
    parallelism: input.parallelism ?? null,
    instanceNamePool: [...new Set(input.instanceNamePool ?? [])],
    runLocation: input.runLocation ?? 'local',
    expectedRevision,
  };
}

type CanonicalAgentCommandPayload = ReturnType<typeof canonicalAgentCommandPayload>;

interface AgentEventPayload {
  command: CanonicalAgentCommandPayload;
  agent?: AgentDefinition;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function agentEventPayload(payload: unknown): AgentEventPayload {
  if (payload && typeof payload === 'object' && 'command' in payload) {
    return payload as AgentEventPayload;
  }
  // Compatibility with Agent events written before receipts carried a frozen result snapshot.
  return { command: payload as CanonicalAgentCommandPayload };
}

function assertAgentReplayInput(
  dedupeKey: string,
  recorded: CanonicalAgentCommandPayload,
  requested: CanonicalAgentCommandPayload,
): void {
  if (canonicalJson(recorded) !== canonicalJson(requested)) {
    throw new PlatformEventDedupeConflictError(dedupeKey);
  }
}

function agentReceipt(
  command: AgentCreateCommand | AgentUpdateCommand,
  agent: AgentDefinition,
  eventId: string,
  recordedAt: string,
  status: 'applied' | 'duplicate',
): CommandReceipt<AgentCommandResult> {
  return {
    commandId: command.commandId,
    status,
    subject: { type: 'agent', id: agent.id },
    revision: agent.revision,
    eventIds: [eventId],
    evidenceRefs: [],
    result: { agent, runtimeConfiguration: 'applies_on_next_trigger' },
    recordedAt,
  };
}

function canonicalAutomationDefinition(input: AutomationDefinitionInput) {
  return {
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    trigger: input.trigger,
    actions: input.actions.map((action) => ({ ...action, id: action.id.trim() })),
  };
}

type AnyAutomationCommand =
  | AutomationCreateCommand
  | AutomationUpdateCommand
  | AutomationSetEnabledCommand
  | AutomationTriggerCommand
  | AutomationRetryCommand
  | AutomationDecideCommand;

function hasCommandIdentity(command: Pick<ProductCommand, 'commandId' | 'idempotencyKey'>): boolean {
  return Boolean(command.commandId.trim() && command.idempotencyKey.trim());
}

function automationCommandDedupeKey(command: AnyAutomationCommand): string {
  return `command:${command.idempotencyKey}:${command.name}`;
}

function canonicalAutomationEnvelope(command: AnyAutomationCommand, input: unknown) {
  return {
    name: command.name,
    projectId: command.projectId,
    actor: command.actor,
    subject: command.subject ?? null,
    expectedRevision: command.expectedRevision ?? null,
    input,
  };
}

interface AutomationEventPayload {
  command: unknown;
  automation: ProjectAutomation;
  run?: AutomationRun;
  decision?: AutomationDecision;
}

function replayAutomationReceipt(
  command: AnyAutomationCommand,
  event: PlatformEvent,
  requestedPayload: unknown,
): CommandReceipt<AutomationCommandResult> {
  const payload = event.payload as AutomationEventPayload;
  if (!payload?.automation || canonicalJson(payload.command) !== canonicalJson(requestedPayload)) {
    throw new PlatformEventDedupeConflictError(event.dedupeKey ?? command.idempotencyKey);
  }
  return automationReceipt(command, payload.automation, event.eventId, event.recordedAt, 'duplicate', payload.run, payload.decision);
}

function automationReceipt(
  command: AnyAutomationCommand,
  definition: ProjectAutomation,
  eventId: string,
  recordedAt: string,
  status: 'applied' | 'duplicate',
  run?: AutomationRun,
  decision?: AutomationDecision,
): CommandReceipt<AutomationCommandResult> {
  return {
    commandId: command.commandId,
    status,
    subject: run ? { type: 'automation_run', id: run.id } : { type: 'automation', id: definition.id },
    revision: definition.revision,
    eventIds: [eventId],
    evidenceRefs: [],
    result: { automation: definition, ...(run ? { run } : {}), ...(decision ? { decision } : {}) },
    recordedAt,
  };
}

function automationErrorReceipt(
  command: AnyAutomationCommand,
  error: unknown,
  fallback: string,
): CommandReceipt<AutomationCommandResult> {
  const message = error instanceof Error ? error.message : fallback;
  const reasonCode = message.includes('UNIQUE constraint failed: project_automation.project_id, project_automation.name')
    ? 'automation_name_conflict'
    : message;
  const conflict = error instanceof PlatformEventDedupeConflictError
    || reasonCode === 'automation_revision_conflict'
    || reasonCode === 'automation_name_conflict';
  return {
    ...genericRejectedReceipt(command, reasonCode),
    ...(conflict ? { status: 'conflict' as const } : {}),
  } as CommandReceipt<AutomationCommandResult>;
}

interface ReleaseEventPayload {
  command: unknown;
  release: ProjectRelease;
}

function replayReleaseReceipt(
  command: ReleaseCreateCommand | ReleasePublishCommand,
  event: PlatformEvent,
  envelope: unknown,
): CommandReceipt<ReleaseCommandResult> {
  const payload = event.payload as ReleaseEventPayload;
  if (!payload?.release || canonicalJson(payload.command) !== canonicalJson(envelope)) {
    throw new PlatformEventDedupeConflictError(event.dedupeKey ?? command.idempotencyKey);
  }
  return releaseReceipt(command, payload.release, event, 'duplicate');
}

function releaseReceipt(
  command: ReleaseCreateCommand | ReleasePublishCommand,
  release: ProjectRelease,
  event: Pick<PlatformEvent, 'eventId' | 'recordedAt'>,
  status: 'applied' | 'duplicate',
): CommandReceipt<ReleaseCommandResult> {
  return {
    commandId: command.commandId,
    status,
    subject: { type: 'release', id: release.id },
    revision: release.revision,
    eventIds: [event.eventId],
    evidenceRefs: release.targets.map((target) => `${target.type}:${target.id}`),
    result: { release },
    recordedAt: event.recordedAt,
  };
}

function releaseErrorReceipt(
  command: ReleaseCreateCommand | ReleasePublishCommand,
  error: unknown,
): CommandReceipt<ReleaseCommandResult> {
  const reasonCode = error instanceof Error ? error.message : 'release_command_failed';
  const conflict = error instanceof PlatformEventDedupeConflictError
    || reasonCode === 'release_revision_conflict'
    || reasonCode === 'release_idempotency_conflict'
    || reasonCode.includes('UNIQUE constraint failed');
  return {
    ...genericRejectedReceipt(command, reasonCode.includes('UNIQUE constraint failed') ? 'release_name_conflict' : reasonCode),
    ...(conflict ? { status: 'conflict' as const } : {}),
  } as CommandReceipt<ReleaseCommandResult>;
}

export const commandService = new CommandService();

export function asWorkSubmitOutcomeCommand(input: AgentOutcome): WorkSubmitOutcomeCommand {
  const contract = getDb().prepare('SELECT agent_id FROM work_contract WHERE id=?')
    .get(input.contractId) as { agent_id: string } | undefined;
  return {
    commandId: input.outcomeId,
    name: 'work.submit_outcome',
    projectId: input.projectId,
    actor: { type: 'agent', id: contract?.agent_id ?? 'unknown' },
    subject: { type: 'agent_work', id: input.workId },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    causationId: input.causationId,
    input,
  };
}

export function asWorkCreateCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  title: string;
  category: WorkCreateCommand['input']['category'];
  description?: string;
  actorId?: string;
}): WorkCreateCommand {
  return {
    commandId: input.commandId,
    name: 'work.create',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: {
      title: input.title,
      category: input.category,
      description: input.description,
    },
  };
}

export function asProjectCreateCommand(input: {
  commandId: string;
  idempotencyKey: string;
  name: string;
  rootPath: string;
  actorId?: string;
}): ProjectCreateCommand {
  return {
    commandId: input.commandId,
    name: 'project.create',
    projectId: 'workspace',
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: { name: input.name, rootPath: input.rootPath },
  };
}

export function asProjectAgentAddCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  agentId: string;
  actorId?: string;
}): ProjectAgentAddCommand {
  return {
    commandId: input.commandId,
    name: 'project.agent.add',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'agent', id: input.agentId },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: { agentId: input.agentId },
  };
}

export function asProjectAgentRemoveCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  agentId: string;
  actorId?: string;
}): ProjectAgentRemoveCommand {
  return {
    commandId: input.commandId,
    name: 'project.agent.remove',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'agent', id: input.agentId },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: { agentId: input.agentId },
  };
}

export function asReviewCreateCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  repositoryRoot: string;
  baseRef: string;
  compareRef: string;
  title: string;
  description?: string;
  actorId?: string;
}): ReviewCreateCommand {
  return {
    commandId: input.commandId,
    name: 'review.create',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: {
      repositoryRoot: input.repositoryRoot,
      baseRef: input.baseRef,
      compareRef: input.compareRef,
      title: input.title,
      description: input.description,
    },
  };
}

export function asReviewRecordDecisionCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  reviewId: string;
  expectedRevision: number;
  status: ReviewRecordDecisionCommand['input']['status'];
  summary: string;
  actorId?: string;
}): ReviewRecordDecisionCommand {
  return {
    commandId: input.commandId,
    name: 'review.record_decision',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'review', id: input.reviewId },
    idempotencyKey: input.idempotencyKey,
    expectedRevision: input.expectedRevision,
    correlationId: input.idempotencyKey,
    input: {
      reviewId: input.reviewId,
      status: input.status,
      summary: input.summary,
    },
  };
}

export function asAgentTeamDeployCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  teamId: string;
  channelId: string;
  actorId?: string;
}): AgentTeamDeployCommand {
  return {
    commandId: input.commandId,
    name: 'agent_team.deploy',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'agent_team', id: input.teamId },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: { teamId: input.teamId, channelId: input.channelId },
  };
}

export function asAgentTeamCreateCommand(input: {
  commandId: string;
  idempotencyKey: string;
  team: AgentTeamDefinitionInput;
  actorId?: string;
}): AgentTeamCreateCommand {
  return {
    commandId: input.commandId,
    name: 'agent_team.create',
    projectId: 'workspace',
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: input.team,
  };
}

export function asAgentTeamUpdateCommand(input: {
  commandId: string;
  idempotencyKey: string;
  expectedRevision: number;
  team: AgentTeamDefinitionInput & { id: string };
  actorId?: string;
}): AgentTeamUpdateCommand {
  return {
    commandId: input.commandId,
    name: 'agent_team.update',
    projectId: 'workspace',
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'agent_team', id: input.team.id },
    idempotencyKey: input.idempotencyKey,
    expectedRevision: input.expectedRevision,
    correlationId: input.idempotencyKey,
    input: input.team,
  };
}

export function asAgentTeamDeleteCommand(input: {
  commandId: string;
  idempotencyKey: string;
  expectedRevision: number;
  teamId: string;
  actorId?: string;
}): AgentTeamDeleteCommand {
  return {
    commandId: input.commandId,
    name: 'agent_team.delete',
    projectId: 'workspace',
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'agent_team', id: input.teamId },
    idempotencyKey: input.idempotencyKey,
    expectedRevision: input.expectedRevision,
    correlationId: input.idempotencyKey,
    input: { teamId: input.teamId },
  };
}

export function asAgentCreateCommand(input: {
  commandId: string;
  idempotencyKey: string;
  agent: SaveAgentDefinitionInput;
  actorId?: string;
}): AgentCreateCommand {
  return {
    commandId: input.commandId,
    name: 'agent.create',
    projectId: 'workspace',
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: input.agent,
  };
}

export function asAgentUpdateCommand(input: {
  commandId: string;
  idempotencyKey: string;
  expectedRevision: number;
  agent: SaveAgentDefinitionInput & { id: string };
  actorId?: string;
}): AgentUpdateCommand {
  return {
    commandId: input.commandId,
    name: 'agent.update',
    projectId: 'workspace',
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'agent', id: input.agent.id },
    idempotencyKey: input.idempotencyKey,
    expectedRevision: input.expectedRevision,
    correlationId: input.idempotencyKey,
    input: input.agent,
  };
}

export function asAutomationCreateCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  definition: AutomationDefinitionInput;
  actorId?: string;
}): AutomationCreateCommand {
  return {
    commandId: input.commandId,
    name: 'automation.create',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: input.definition,
  };
}

export function asAutomationUpdateCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  expectedRevision: number;
  definition: AutomationDefinitionInput & { id: string };
  actorId?: string;
}): AutomationUpdateCommand {
  return {
    commandId: input.commandId,
    name: 'automation.update',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'automation', id: input.definition.id },
    idempotencyKey: input.idempotencyKey,
    expectedRevision: input.expectedRevision,
    correlationId: input.idempotencyKey,
    input: input.definition,
  };
}

export function asAutomationSetEnabledCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  automationId: string;
  expectedRevision: number;
  enabled: boolean;
  actorId?: string;
}): AutomationSetEnabledCommand {
  return {
    commandId: input.commandId,
    name: 'automation.set_enabled',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'automation', id: input.automationId },
    idempotencyKey: input.idempotencyKey,
    expectedRevision: input.expectedRevision,
    correlationId: input.idempotencyKey,
    input: { automationId: input.automationId, enabled: input.enabled },
  };
}

export function asAutomationTriggerCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  automationId: string;
  actorId?: string;
}): AutomationTriggerCommand {
  return {
    commandId: input.commandId,
    name: 'automation.trigger',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'automation', id: input.automationId },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: { automationId: input.automationId },
  };
}

export function asAutomationRetryCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  runId: string;
  actorId?: string;
}): AutomationRetryCommand {
  return {
    commandId: input.commandId,
    name: 'automation.retry',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'automation_run', id: input.runId },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: { runId: input.runId },
  };
}

export function asAutomationDecideCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  decisionId: string;
  decision: 'approved' | 'denied';
  note?: string;
  actorId?: string;
}): AutomationDecideCommand {
  return {
    commandId: input.commandId,
    name: 'automation.decide',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'automation_decision', id: input.decisionId },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: {
      decisionId: input.decisionId,
      decision: input.decision,
      note: input.note,
    },
  };
}

export function asReleaseCreateCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  name: string;
  description?: string;
  targets: ProjectReleaseTarget[];
  actorId?: string;
}): ReleaseCreateCommand {
  return {
    commandId: input.commandId,
    name: 'release.create',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.idempotencyKey,
    input: { name: input.name, description: input.description, targets: input.targets },
  };
}

export function asReleasePublishCommand(input: {
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  releaseId: string;
  expectedRevision: number;
  actorId?: string;
}): ReleasePublishCommand {
  return {
    commandId: input.commandId,
    name: 'release.publish',
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorId ?? 'local-user' },
    subject: { type: 'release', id: input.releaseId },
    idempotencyKey: input.idempotencyKey,
    expectedRevision: input.expectedRevision,
    correlationId: input.idempotencyKey,
    input: { releaseId: input.releaseId },
  };
}
