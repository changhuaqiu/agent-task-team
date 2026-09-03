import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { WorkContractRepository } from '../work-contract/repository';
import type { AgentOutcome } from '../work-contract/types';
import {
  asAgentCreateCommand,
  asAgentTeamCreateCommand,
  asAgentTeamDeleteCommand,
  asAgentTeamDeployCommand,
  asAgentTeamUpdateCommand,
  asAgentUpdateCommand,
  asProjectCreateCommand,
  asProjectAgentAddCommand,
  asProjectAgentRemoveCommand,
  asReviewCreateCommand,
  asReviewRecordDecisionCommand,
  asWorkCreateCommand,
  asWorkSubmitOutcomeCommand,
  CommandService,
} from './service';
import { teamPackRepo } from '../repositories/team-pack-repo';
import { agentDefinitionRepo } from '../agents/agent-definition-repo';
import { PlatformEventLog } from '../platform-events';
import { resolveConversationRuntime } from '../invocation-pipeline/conversation-runtime';

function saveRunnableAgent(id: string) {
  return agentDefinitionRepo.save({
    id, name: id, roleCardId: 'preset-planner', runtimeId: 'codex',
    accountIds: [], skillIds: [], instructions: `Run as ${id}.`,
  });
}

describe('CommandService work outcome receipt', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    const now = '2026-08-23T12:00:00.000Z';
    db.prepare('INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run('project-command', 'Command project', 'active', now, now);
  });

  afterEach(() => resetDb());

  function outcome(): AgentOutcome {
    const contract = new WorkContractRepository().issue({
      workId: 'work-command',
      attemptId: 'attempt-command',
      projectId: 'project-command',
      agentId: 'builder',
      goal: 'Build',
      acceptanceCriteria: ['verified'],
      role: {},
      permissions: {},
      authoritativeRefs: ['context:command'],
      authoritativeRevisions: { context: 'command' },
      contextSnapshotRef: 'context:command',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'trace-command',
      causationId: 'trigger-command',
    });
    return {
      outcomeId: 'outcome-command',
      idempotencyKey: 'outcome-command-key',
      contractId: contract.contractId,
      outcomeType: 'submit_task_result',
      payload: { summary: 'done' },
      evidenceRefs: ['artifact:sha'],
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
  }

  it('returns the same fact receipt semantics for apply and replay', () => {
    const input = outcome();
    const service = new CommandService();
    const applied = service.execute(asWorkSubmitOutcomeCommand(input));
    expect(applied).toMatchObject({
      commandId: input.outcomeId,
      status: 'applied',
      subject: { type: 'agent_work', id: input.workId },
      evidenceRefs: ['artifact:sha'],
      result: { outcomeId: input.outcomeId, exitAccepted: true },
    });
    expect(applied.eventIds).toHaveLength(1);

    expect(service.execute(asWorkSubmitOutcomeCommand(input))).toMatchObject({
      commandId: input.outcomeId,
      status: 'duplicate',
      eventIds: applied.eventIds,
      result: { exitAccepted: true },
    });
  });

  it('rejects envelope drift before changing facts', () => {
    const input = outcome();
    const command = asWorkSubmitOutcomeCommand(input);
    command.projectId = 'other-project';
    expect(new CommandService().execute(command)).toMatchObject({
      status: 'rejected',
      reasonCode: 'command_envelope_mismatch',
      eventIds: [],
    });
  });

  it('preserves a rejected outcome decision on idempotent replay', () => {
    const input = outcome();
    new WorkContractRepository().issue({
      workId: input.workId,
      attemptId: 'attempt-command-new',
      projectId: input.projectId,
      agentId: 'builder',
      goal: 'Build again',
      acceptanceCriteria: ['verified'],
      role: {},
      permissions: {},
      authoritativeRefs: ['context:command-new'],
      authoritativeRevisions: { context: 'command-new' },
      contextSnapshotRef: 'context:command-new',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: input.correlationId,
      causationId: 'trigger-command-new',
      expectedCurrentEpoch: input.workEpoch,
    });
    const service = new CommandService();
    const first = service.execute(asWorkSubmitOutcomeCommand(input));
    expect(first).toMatchObject({
      status: 'rejected',
      reasonCode: 'work_authority_stale',
      result: { exitAccepted: false },
    });
    expect(service.execute(asWorkSubmitOutcomeCommand(input))).toMatchObject({
      status: 'rejected',
      reasonCode: 'work_authority_stale',
      eventIds: first.eventIds,
      result: { exitAccepted: false },
    });
  });

  it('creates a project through the same command receipt and safely replays it', () => {
    const service = new CommandService();
    const command = asProjectCreateCommand({
      commandId: 'project-command-create',
      idempotencyKey: 'project-command-create',
      name: 'Alpha',
      rootPath: 'C:/projects/alpha',
    });
    const applied = service.execute(command);
    expect(applied).toMatchObject({
      status: 'applied',
      subject: { type: 'project' },
      result: {
        project: { name: 'Alpha', root_path: 'C:/projects/alpha' },
        workspace: { title: 'Alpha', project_path: 'C:/projects/alpha', workspace_kind: 'project_workspace' },
      },
    });
    expect(applied.eventIds).toHaveLength(1);
    expect(service.execute(command)).toMatchObject({
      status: 'duplicate',
      eventIds: applied.eventIds,
    });
    expect(service.execute(asProjectCreateCommand({
      ...command.input,
      commandId: 'project-command-create-retry',
      idempotencyKey: command.idempotencyKey,
    }))).toMatchObject({ status: 'duplicate', eventIds: applied.eventIds });
  });

  it('creates an Agent definition with reusable policy and safely replays it', () => {
    const service = new CommandService();
    const command = asAgentCreateCommand({
      commandId: 'agent-create',
      idempotencyKey: 'agent-create',
      agent: {
        name: 'Reviewer',
        roleCardId: 'preset-reviewer',
        runtimeId: 'codex',
        runtimeMode: 'custom',
        accountIds: ['account-review'],
        skillIds: [],
        instructions: 'Review changes independently and submit structured decisions.',
        model: 'gpt-5.6',
        audience: { mode: 'selected', ids: ['agent-planner'] },
        parallelism: 3,
        instanceNamePool: ['Birch', 'Compass', 'Ridge'],
        permissions: { canModifyCode: false, canReview: true },
      },
    });

    const applied = service.execute(command);
    expect(applied).toMatchObject({
      status: 'applied',
      subject: { type: 'agent' },
      revision: 1,
      result: {
        runtimeConfiguration: 'applies_on_next_trigger',
        agent: {
          name: 'Reviewer',
          use_runtime_defaults: 0,
          audience_mode: 'selected',
          audience_ids: ['agent-planner'],
          parallelism: 3,
          instance_name_pool: ['Birch', 'Compass', 'Ridge'],
          can_review: 1,
        },
      },
    });
    expect(service.execute(command)).toMatchObject({
      status: 'duplicate', eventIds: applied.eventIds, revision: 1,
    });
    expect(agentDefinitionRepo.list().filter((agent) => agent.name === 'Reviewer')).toHaveLength(1);

    const agentId = applied.subject!.id;
    service.execute(asAgentUpdateCommand({
      commandId: 'agent-create-later-update',
      idempotencyKey: 'agent-create-later-update',
      expectedRevision: 1,
      agent: {
        ...command.input,
        id: agentId,
        name: 'Senior Reviewer',
      },
    }));
    expect(service.execute(command)).toMatchObject({
      status: 'duplicate', eventIds: applied.eventIds, revision: 1,
      result: { agent: { id: agentId, name: 'Reviewer', revision: 1 } },
    });
  });

  it('rejects Agent create idempotency drift and fences stale updates by revision', () => {
    const service = new CommandService();
    const input = {
      name: 'Builder', roleCardId: 'preset-builder', runtimeId: 'codex' as const,
      runtimeMode: 'defaults' as const, accountIds: [], skillIds: [],
      instructions: 'Build verified changes.',
      audience: { mode: 'owner' as const, ids: [] },
      parallelism: null, instanceNamePool: [],
      permissions: { canModifyCode: true, canReview: false },
    };
    const created = service.execute(asAgentCreateCommand({
      commandId: 'agent-fenced-create', idempotencyKey: 'agent-fenced-create', agent: input,
    }));
    const agentId = created.subject!.id;

    expect(service.execute(asAgentCreateCommand({
      commandId: 'agent-fenced-create-retry', idempotencyKey: 'agent-fenced-create',
      agent: { ...input, name: 'Changed Builder' },
    }))).toMatchObject({ status: 'conflict', reasonCode: 'platform_event_dedupe_conflict' });

    const updated = service.execute(asAgentUpdateCommand({
      commandId: 'agent-fenced-update', idempotencyKey: 'agent-fenced-update', expectedRevision: 1,
      agent: { ...input, id: agentId, name: 'Principal Builder', parallelism: 2 },
    }));
    expect(updated).toMatchObject({
      status: 'applied', revision: 2,
      result: { agent: { id: agentId, name: 'Principal Builder', parallelism: 2 } },
    });
    const updatedAgain = service.execute(asAgentUpdateCommand({
      commandId: 'agent-fenced-update-again', idempotencyKey: 'agent-fenced-update-again', expectedRevision: 2,
      agent: { ...input, id: agentId, name: 'Staff Builder', parallelism: 4 },
    }));
    expect(updatedAgain).toMatchObject({ status: 'applied', revision: 3 });
    expect(service.execute(asAgentUpdateCommand({
      commandId: 'agent-fenced-update-retry', idempotencyKey: 'agent-fenced-update', expectedRevision: 1,
      agent: { ...input, id: agentId, name: 'Principal Builder', parallelism: 2 },
    }))).toMatchObject({
      status: 'duplicate', eventIds: updated.eventIds, revision: 2,
      result: { agent: { id: agentId, name: 'Principal Builder', parallelism: 2, revision: 2 } },
    });
    expect(service.execute(asAgentUpdateCommand({
      commandId: 'agent-fenced-update-revision-drift', idempotencyKey: 'agent-fenced-update', expectedRevision: 2,
      agent: { ...input, id: agentId, name: 'Principal Builder', parallelism: 2 },
    }))).toMatchObject({ status: 'conflict', reasonCode: 'platform_event_dedupe_conflict' });
    expect(service.execute(asAgentUpdateCommand({
      commandId: 'agent-fenced-stale', idempotencyKey: 'agent-fenced-stale', expectedRevision: 1,
      agent: { ...input, id: agentId, name: 'Stale Builder' },
    }))).toMatchObject({ status: 'conflict', reasonCode: 'agent_revision_conflict' });
    expect(agentDefinitionRepo.get(agentId)).toMatchObject({ name: 'Staff Builder', revision: 3 });
  });

  it('rolls back a different project bound to the same command id', () => {
    const service = new CommandService();
    service.execute(asProjectCreateCommand({
      commandId: 'project-command-conflict',
      idempotencyKey: 'project-command-conflict',
      name: 'Alpha',
      rootPath: 'C:/projects/alpha',
    }));
    const conflict = service.execute(asProjectCreateCommand({
      commandId: 'project-command-conflict',
      idempotencyKey: 'project-command-conflict',
      name: 'Bravo',
      rootPath: 'C:/projects/bravo',
    }));
    expect(conflict).toMatchObject({ status: 'conflict' });
    expect(getDb().prepare('SELECT name FROM project ORDER BY name').all())
      .toEqual([{ name: 'Alpha' }]);
  });

  it('rejects the same project path with changed input under one idempotency key', () => {
    const service = new CommandService();
    service.execute(asProjectCreateCommand({
      commandId: 'project-same-path',
      idempotencyKey: 'project-same-path',
      name: 'Alpha',
      rootPath: 'C:/projects/same',
    }));
    expect(service.execute(asProjectCreateCommand({
      commandId: 'project-same-path-retry',
      idempotencyKey: 'project-same-path',
      name: 'Bravo',
      rootPath: 'C:/projects/same/',
    }))).toMatchObject({ status: 'conflict' });
    expect(getDb().prepare('SELECT name FROM project WHERE root_path=?').get('C:/projects/same'))
      .toEqual({ name: 'Alpha' });
  });

  it('treats path case and separator variants as the same canonical project identity', () => {
    const service = new CommandService();
    const first = service.execute(asProjectCreateCommand({
      commandId: 'project-canonical', idempotencyKey: 'project-canonical',
      name: 'Alpha', rootPath: 'C:\\Projects\\Alpha\\',
    }));
    expect(service.execute(asProjectCreateCommand({
      commandId: 'project-canonical-retry', idempotencyKey: 'project-canonical',
      name: 'Alpha', rootPath: 'c:/projects/alpha/',
    }))).toMatchObject({ status: 'duplicate', eventIds: first.eventIds });
  });

  it('keeps an existing Project and its event payload authoritative under a new key', () => {
    const service = new CommandService();
    service.execute(asProjectCreateCommand({
      commandId: 'project-authoritative-a', idempotencyKey: 'project-authoritative-a',
      name: 'Alpha', rootPath: 'C:/projects/authoritative',
    }));
    const duplicate = service.execute(asProjectCreateCommand({
      commandId: 'project-authoritative-b', idempotencyKey: 'project-authoritative-b',
      name: 'Bravo', rootPath: 'c:/projects/authoritative/',
    }));
    expect(duplicate).toMatchObject({ status: 'duplicate', result: { project: { name: 'Alpha' } } });
    const event = new PlatformEventLog().getById(duplicate.eventIds[0]);
    expect(event?.payload).toMatchObject({ name: 'Alpha', rootPath: 'c:/projects/authoritative' });
  });

  it('creates an independent review and replays the same receipt', () => {
    const service = new CommandService();
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'review-project', idempotencyKey: 'review-project', name: 'Review Project', rootPath: 'C:/projects/review',
    }));
    const projectId = (projectReceipt.result as { project: { id: string } }).project.id;
    const command = asReviewCreateCommand({
      commandId: 'review-create', idempotencyKey: 'review-create', projectId,
      repositoryRoot: 'C:/projects/review', baseRef: 'main', compareRef: 'feature/review',
      title: 'Review command kernel', description: 'Check receipts',
    });
    const applied = service.execute(command);
    expect(applied).toMatchObject({
      status: 'applied', subject: { type: 'review' }, revision: 1,
      result: { review: { projectId, baseRef: 'main', compareRef: 'feature/review', status: 'open' } },
    });
    expect((applied.result as { review: { reference: string } }).review.reference).toContain('ath://review?');
    expect(service.execute(command)).toMatchObject({
      status: 'duplicate', eventIds: applied.eventIds,
      result: { review: { status: 'open' } },
    });
  });

  it('replays the original Review creation projection after later decisions', () => {
    const service = new CommandService();
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'review-replay-project', idempotencyKey: 'review-replay-project',
      name: 'Review Replay Project', rootPath: 'C:/projects/review-replay',
    }));
    const projectId = (projectReceipt.result as { project: { id: string } }).project.id;
    const create = asReviewCreateCommand({
      commandId: 'review-replay-create', idempotencyKey: 'review-replay-create', projectId,
      repositoryRoot: 'C:/projects/review-replay', baseRef: 'main', compareRef: 'feature/replay',
      title: 'Replay the original Review',
    });
    const created = service.execute(create);
    const reviewId = (created.result as { review: { id: string } }).review.id;
    service.execute(asReviewRecordDecisionCommand({
      commandId: 'review-replay-approve', idempotencyKey: 'review-replay-approve',
      projectId, reviewId, expectedRevision: 1, status: 'approved', summary: 'Approved later.',
    }));

    expect(service.execute(create)).toMatchObject({
      status: 'duplicate', revision: 1, eventIds: created.eventIds,
      result: { review: { status: 'open', revision: 1 } },
    });
  });

  it('creates Work through the same command receipt and rejects idempotency drift', () => {
    const service = new CommandService();
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'work-project', idempotencyKey: 'work-project', name: 'Work Project', rootPath: 'C:/projects/work',
    }));
    const projectId = (projectReceipt.result as { project: { id: string } }).project.id;
    const command = asWorkCreateCommand({
      commandId: 'work-create', idempotencyKey: 'work-create', projectId,
      title: 'Unify creation', category: 'improvement', description: 'One kernel.',
    });
    const applied = service.execute(command);
    expect(applied).toMatchObject({
      status: 'applied', subject: { type: 'work' },
      result: {
        projectId,
        conversation: {
          project_id: projectId,
          workspace_kind: 'workstream',
          title: 'Unify creation',
          use_worktree: 0,
          git_repo_root: null,
        },
        task: { title: 'Unify creation', category: 'improvement', artifacts: '[]' },
      },
    });
    const result = applied.result as { conversation: { id: string }; task: { conversation_id: string } };
    expect(result.task.conversation_id).toBe(result.conversation.id);
    expect(result.conversation.id).not.toBe(
      (projectReceipt.result as { project: { workspace_conversation_id: string } }).project.workspace_conversation_id,
    );
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM conversation WHERE project_id=?').get(projectId))
      .toEqual({ count: 2 });
    expect(applied.eventIds).toHaveLength(1);
    expect(service.execute(command)).toMatchObject({ status: 'duplicate', eventIds: applied.eventIds });
    expect(service.execute(asWorkCreateCommand({
      ...command.input, commandId: 'work-create-retry', idempotencyKey: command.idempotencyKey,
      projectId, title: 'Changed title',
    }))).toMatchObject({ status: 'conflict', reasonCode: 'command_idempotency_conflict' });
  });

  it('isolates two WorkItems in the same Project into different execution scopes', () => {
    const service = new CommandService();
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'isolated-work-project', idempotencyKey: 'isolated-work-project',
      name: 'Isolated Work Project', rootPath: 'C:/projects/isolated-work',
    }));
    const project = (projectReceipt.result as {
      project: { id: string; workspace_conversation_id: string };
    }).project;
    const first = service.execute(asWorkCreateCommand({
      commandId: 'isolated-work-a', idempotencyKey: 'isolated-work-a', projectId: project.id,
      title: 'Fix search', category: 'issue', description: 'Repair search.',
    }));
    const second = service.execute(asWorkCreateCommand({
      commandId: 'isolated-work-b', idempotencyKey: 'isolated-work-b', projectId: project.id,
      title: 'Improve export', category: 'improvement', description: 'Improve export.',
    }));
    const firstResult = first.result as { conversation: { id: string }; task: { conversation_id: string } };
    const secondResult = second.result as { conversation: { id: string }; task: { conversation_id: string } };

    expect(firstResult.conversation.id).not.toBe(secondResult.conversation.id);
    expect(firstResult.task.conversation_id).toBe(firstResult.conversation.id);
    expect(secondResult.task.conversation_id).toBe(secondResult.conversation.id);
    expect(getDb().prepare('SELECT conversation_id, COUNT(*) AS count FROM task GROUP BY conversation_id ORDER BY conversation_id').all())
      .toEqual(expect.arrayContaining([
        { conversation_id: firstResult.conversation.id, count: 1 },
        { conversation_id: secondResult.conversation.id, count: 1 },
      ]));
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM task WHERE conversation_id=?').get(project.workspace_conversation_id))
      .toEqual({ count: 0 });
  });

  it('inherits Git worktree settings from the Project workspace', () => {
    const service = new CommandService();
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'git-work-project', idempotencyKey: 'git-work-project',
      name: 'Git Work Project', rootPath: 'C:/projects/git-work',
    }));
    const project = (projectReceipt.result as {
      project: { id: string; workspace_conversation_id: string };
    }).project;
    getDb().prepare('UPDATE conversation SET use_worktree=1,git_repo_root=? WHERE id=?')
      .run('C:/projects/git-work', project.workspace_conversation_id);

    const receipt = service.execute(asWorkCreateCommand({
      commandId: 'git-work-create', idempotencyKey: 'git-work-create', projectId: project.id,
      title: 'Use isolated worktree', category: 'improvement',
    }));

    expect(receipt).toMatchObject({
      status: 'applied',
      result: {
        conversation: {
          use_worktree: 1,
          git_repo_root: 'C:/projects/git-work',
        },
      },
    });
  });

  it('records a review decision with revision fencing and idempotent replay', () => {
    const service = new CommandService();
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'decision-project', idempotencyKey: 'decision-project', name: 'Decision Project', rootPath: 'C:/projects/decision',
    }));
    const projectId = (projectReceipt.result as { project: { id: string } }).project.id;
    const created = service.execute(asReviewCreateCommand({
      commandId: 'decision-review', idempotencyKey: 'decision-review', projectId,
      repositoryRoot: 'C:/projects/decision', baseRef: 'main', compareRef: 'feature/decision', title: 'Decide',
    }));
    const reviewId = (created.result as { review: { id: string } }).review.id;
    const command = asReviewRecordDecisionCommand({
      commandId: 'decision-changes', idempotencyKey: 'decision-changes', projectId, reviewId,
      expectedRevision: 1, status: 'changes_requested', summary: 'Add evidence.',
    });
    const changes = service.execute(command);
    expect(changes).toMatchObject({
      status: 'applied', revision: 2,
      result: { review: { id: reviewId, status: 'changes_requested', decisionSummary: 'Add evidence.' } },
    });
    expect(service.execute(asReviewRecordDecisionCommand({
      commandId: 'decision-approve', idempotencyKey: 'decision-approve', projectId, reviewId,
      expectedRevision: 2, status: 'approved', summary: 'Evidence is complete.',
    }))).toMatchObject({ status: 'applied', revision: 3, result: { review: { status: 'approved' } } });
    expect(service.execute(command)).toMatchObject({
      status: 'duplicate', eventIds: changes.eventIds, revision: 2,
      result: { review: { status: 'changes_requested', decisionSummary: 'Add evidence.', revision: 2 } },
    });
    expect(service.execute(asReviewRecordDecisionCommand({
      commandId: 'decision-stale', idempotencyKey: 'decision-stale', projectId, reviewId,
      expectedRevision: 1, status: 'changes_requested', summary: 'Stale decision',
    }))).toMatchObject({ status: 'conflict', reasonCode: 'review_revision_conflict' });
  });

  it('rejects a second open review for the same branch pair', () => {
    const service = new CommandService();
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'pair-project', idempotencyKey: 'pair-project', name: 'Pair Project', rootPath: 'C:/projects/pair',
    }));
    const projectId = (projectReceipt.result as { project: { id: string } }).project.id;
    const input = { projectId, repositoryRoot: 'C:/projects/pair', baseRef: 'main', compareRef: 'feature/pair', title: 'Pair' };
    expect(service.execute(asReviewCreateCommand({ commandId: 'pair-one', idempotencyKey: 'pair-one', ...input }))).toMatchObject({ status: 'applied' });
    expect(service.execute(asReviewCreateCommand({ commandId: 'pair-two', idempotencyKey: 'pair-two', ...input }))).toMatchObject({ status: 'rejected', reasonCode: 'review_already_open' });
  });

  it('deploys an Agent team to a project channel through an idempotent command', () => {
    const service = new CommandService();
    saveRunnableAgent('team-builder');
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'team-project', idempotencyKey: 'team-project', name: 'Team Project', rootPath: 'C:/projects/team',
    }));
    const project = (projectReceipt.result as { project: { id: string; workspace_conversation_id: string } }).project;
    const team = teamPackRepo.seedLegacy({
      name: 'delivery-team', displayName: 'Delivery team', description: 'Reusable team', teamMode: 'hub_spoke',
      roles: [{ id: 'team-builder', displayName: 'Builder', soul: 'Build verified changes.', required: true }],
      workflow: { type: 'linear', steps: [{ role: 'team-builder', action: 'build', output: 'result' }] },
      communicationMatrix: { 'team-builder': { canSendTo: [], canReceiveFrom: [] } },
    });
    const command = asAgentTeamDeployCommand({
      commandId: 'team-deploy', idempotencyKey: 'team-deploy', projectId: project.id,
      teamId: team.id, channelId: project.workspace_conversation_id,
    });
    const applied = service.execute(command);
    expect(applied).toMatchObject({
      status: 'applied', subject: { type: 'agent_team', id: team.id },
      result: {
        teamId: team.id,
        channelId: project.workspace_conversation_id,
        assignedAgentIds: ['team-builder'],
        runtimeReadiness: 'pending_first_trigger',
      },
    });
    expect(getDb().prepare('SELECT team_pack_id FROM conversation WHERE id=?').get(project.workspace_conversation_id))
      .toEqual({ team_pack_id: team.id });
    expect(getDb().prepare('SELECT agent_id,source FROM project_agent_membership WHERE project_id=?').all(project.id))
      .toEqual([{ agent_id: 'team-builder', source: 'team' }]);
    expect(service.execute(command)).toMatchObject({ status: 'duplicate', eventIds: applied.eventIds });
  });

  it('adds and removes a Project Agent through idempotent membership commands', () => {
    const service = new CommandService();
    saveRunnableAgent('project-specialist');
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'membership-project', idempotencyKey: 'membership-project',
      name: 'Membership Project', rootPath: 'C:/projects/membership',
    }));
    const project = (projectReceipt.result as { project: { id: string; workspace_conversation_id: string } }).project;
    const add = asProjectAgentAddCommand({
      commandId: 'membership-add', idempotencyKey: 'membership-add',
      projectId: project.id, agentId: 'project-specialist',
    });
    const applied = service.execute(add);
    expect(applied).toMatchObject({
      status: 'applied', subject: { type: 'agent', id: 'project-specialist' },
      result: { projectId: project.id, agentId: 'project-specialist' },
    });
    expect((applied.result as { agentIds: string[] }).agentIds).toContain('project-specialist');
    expect(resolveConversationRuntime(project.workspace_conversation_id)?.roster.map((agent) => agent.id))
      .toContain('project-specialist');
    expect(service.execute({ ...add, commandId: 'membership-add-replay' }))
      .toMatchObject({ status: 'duplicate', eventIds: applied.eventIds, result: applied.result });

    expect(service.execute(asProjectAgentRemoveCommand({
      commandId: 'membership-remove', idempotencyKey: 'membership-remove',
      projectId: project.id, agentId: 'project-specialist',
    }))).toMatchObject({ status: 'applied', result: { agentId: 'project-specialist' } });
    expect(getDb().prepare('SELECT 1 FROM project_agent_membership WHERE project_id=? AND agent_id=?')
      .get(project.id, 'project-specialist')).toBeUndefined();
  });

  it('replays a frozen Team deployment without overwriting a newer deployment', () => {
    const service = new CommandService();
    saveRunnableAgent('team-first');
    saveRunnableAgent('team-second');
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'team-replay-project', idempotencyKey: 'team-replay-project',
      name: 'Team Replay Project', rootPath: 'C:/projects/team-replay',
    }));
    const project = (projectReceipt.result as { project: { id: string; workspace_conversation_id: string } }).project;
    const makeTeam = (agentId: string) => teamPackRepo.seedLegacy({
      name: `${agentId}-team`, displayName: `${agentId} team`, description: '', teamMode: 'hub_spoke',
      roles: [{ id: agentId, displayName: agentId, soul: '', required: true }],
      workflow: { type: 'linear', steps: [{ role: agentId, action: 'work', output: 'result' }] },
      communicationMatrix: { [agentId]: { canSendTo: [], canReceiveFrom: [] } },
    });
    const first = makeTeam('team-first');
    const second = makeTeam('team-second');
    const firstCommand = asAgentTeamDeployCommand({
      commandId: 'team-replay-first', idempotencyKey: 'team-replay-first', projectId: project.id,
      teamId: first.id, channelId: project.workspace_conversation_id,
    });
    expect(service.execute(firstCommand)).toMatchObject({ status: 'applied', result: { teamId: first.id } });
    expect(service.execute(asAgentTeamDeployCommand({
      commandId: 'team-replay-second', idempotencyKey: 'team-replay-second', projectId: project.id,
      teamId: second.id, channelId: project.workspace_conversation_id,
    }))).toMatchObject({ status: 'applied', result: { teamId: second.id } });

    expect(service.execute({ ...firstCommand, commandId: 'team-replay-first-late' }))
      .toMatchObject({ status: 'duplicate', result: { teamId: first.id, assignedAgentIds: ['team-first'] } });
    expect(getDb().prepare('SELECT team_pack_id FROM conversation WHERE id=?').get(project.workspace_conversation_id))
      .toEqual({ team_pack_id: second.id });
  });

  it('recovers a legacy deployment Project from its frozen channel and rejects Project drift', () => {
    const service = new CommandService();
    saveRunnableAgent('legacy-team-agent');
    const projectReceipt = service.execute(asProjectCreateCommand({
      commandId: 'legacy-team-project', idempotencyKey: 'legacy-team-project',
      name: 'Legacy Team Project', rootPath: 'C:/projects/legacy-team',
    }));
    const project = (projectReceipt.result as { project: { id: string; workspace_conversation_id: string } }).project;
    const team = teamPackRepo.seedLegacy({
      name: 'legacy-team', displayName: 'Legacy Team', description: '', teamMode: 'hub_spoke',
      roles: [{ id: 'legacy-team-agent', displayName: 'Legacy Agent', soul: '', required: true }],
      workflow: { type: 'linear', steps: [] },
      communicationMatrix: { 'legacy-team-agent': { canSendTo: [], canReceiveFrom: [] } },
    });
    const dedupeKey = 'command:legacy-team-deploy:agent_team.deployed';
    new PlatformEventLog().append({
      type: 'agent_team.deployed', category: 'domain', projectId: project.workspace_conversation_id,
      streamKey: `channel:${project.workspace_conversation_id}:agent_team`,
      aggregate: { type: 'agent_team', id: team.id, version: 1 },
      actor: { type: 'user', id: 'local-user' }, subject: { type: 'agent_team', id: team.id },
      correlationId: 'legacy-team-deploy', dedupeKey,
      payload: {
        teamId: team.id,
        channelId: project.workspace_conversation_id,
        assignedAgentIds: ['legacy-team-agent'],
        runtimeReadiness: 'pending_first_trigger',
      },
    });
    const command = asAgentTeamDeployCommand({
      commandId: 'legacy-team-deploy-replay', idempotencyKey: 'legacy-team-deploy',
      projectId: project.id, teamId: team.id, channelId: project.workspace_conversation_id,
    });
    expect(service.execute(command)).toMatchObject({
      status: 'duplicate', result: { teamId: team.id, channelId: project.workspace_conversation_id },
    });
    expect(service.execute({ ...command, commandId: 'legacy-team-deploy-drift', projectId: 'other-project' }))
      .toMatchObject({ status: 'conflict' });
  });

  it('creates an Agent team once and replays the same canonical object', () => {
    const service = new CommandService();
    saveRunnableAgent('runtime-builder');
    const command = asAgentTeamCreateCommand({
      commandId: 'team-create', idempotencyKey: 'team-create',
      team: {
        name: 'runtime-team', displayName: 'Runtime team', description: 'Reusable identities', teamMode: 'hub_spoke',
        members: [{ agentId: 'runtime-builder', required: true }],
        workflow: { type: 'linear', steps: [] },
        communicationMatrix: { 'runtime-builder': { canSendTo: [], canReceiveFrom: [] } },
      },
    });
    const applied = service.execute(command);
    expect(applied).toMatchObject({
      status: 'applied', subject: { type: 'agent_team' },
      result: { team: { displayName: 'Runtime team', roles: [{ id: 'runtime-builder' }] } },
    });
    getDb().prepare('DELETE FROM agents WHERE id=?').run('runtime-builder');
    const replay = service.execute(command);
    expect(replay).toMatchObject({
      status: 'duplicate', subject: applied.subject, result: { team: { id: applied.subject?.id } },
    });
    expect(teamPackRepo.list().filter((team) => team.displayName === 'Runtime team')).toHaveLength(1);

    const changedWorkflow = service.execute(asAgentTeamCreateCommand({
      ...command,
      commandId: 'team-create-drift',
      team: { ...command.input, workflow: { type: 'linear', steps: [{ role: 'runtime-builder', action: 'review', output: 'receipt' }] } },
    }));
    expect(changedWorkflow).toMatchObject({ status: 'conflict' });
  });

  it('updates and deletes an Agent Team through revision-fenced commands', () => {
    const service = new CommandService();
    saveRunnableAgent('team-a');
    saveRunnableAgent('team-b');
    const created = service.execute(asAgentTeamCreateCommand({
      commandId: 'team-lifecycle-create', idempotencyKey: 'team-lifecycle-create',
      team: {
        name: 'team-lifecycle', displayName: 'Team lifecycle', description: '',
        members: [{ agentId: 'team-a' }], teamMode: 'hub_spoke',
        workflow: { type: 'linear', steps: [] },
        communicationMatrix: { 'team-a': { canSendTo: [], canReceiveFrom: [] } },
      },
    }));
    const team = (created.result as { team: { id: string; revision?: number } }).team;
    const update = asAgentTeamUpdateCommand({
      commandId: 'team-lifecycle-update', idempotencyKey: 'team-lifecycle-update',
      expectedRevision: team.revision ?? 1,
      team: {
        id: team.id, name: 'team-lifecycle', displayName: 'Updated team', description: '',
        members: [{ agentId: 'team-b' }], teamMode: 'parallel',
        workflow: { type: 'linear', steps: [] },
        communicationMatrix: { 'team-b': { canSendTo: [], canReceiveFrom: [] } },
      },
    });
    const updated = service.execute(update);
    expect(updated).toMatchObject({ status: 'applied', revision: 2, result: { team: { displayName: 'Updated team', roles: [{ id: 'team-b' }] } } });
    expect(service.execute({ ...update, commandId: 'team-lifecycle-update-replay' })).toMatchObject({ status: 'duplicate', revision: 2 });
    expect(service.execute({ ...update, commandId: 'team-lifecycle-update-drift', expectedRevision: 2 })).toMatchObject({ status: 'conflict' });

    const deleted = service.execute(asAgentTeamDeleteCommand({
      commandId: 'team-lifecycle-delete', idempotencyKey: 'team-lifecycle-delete',
      expectedRevision: 2, teamId: team.id,
    }));
    expect(deleted).toMatchObject({ status: 'applied', revision: 3, result: { teamId: team.id } });
    expect(teamPackRepo.getById(team.id)).toBeUndefined();
  });

  it('rejects a Team whose member is not an existing Agent object', () => {
    const service = new CommandService();
    const receipt = service.execute(asAgentTeamCreateCommand({
      commandId: 'team-missing', idempotencyKey: 'team-missing',
      team: {
        name: 'missing-team', displayName: 'Missing team', description: '', teamMode: 'hub_spoke',
        members: [{ agentId: 'missing-agent', required: true }],
        workflow: { type: 'linear', steps: [] },
        communicationMatrix: { 'missing-agent': { canSendTo: [], canReceiveFrom: [] } },
      },
    }));
    expect(receipt).toMatchObject({ status: 'rejected', reasonCode: 'agent_team_member_not_found:missing-agent' });
    expect(teamPackRepo.getByName('missing-team')).toBeUndefined();
  });

  it('rejects empty command identity for mutating Team commands', () => {
    const service = new CommandService();
    const update = asAgentTeamUpdateCommand({
      commandId: '', idempotencyKey: '', expectedRevision: 1,
      team: {
        id: 'team-empty', name: 'team-empty', displayName: 'Team', description: '',
        members: [{ agentId: 'member' }], teamMode: 'hub_spoke',
        workflow: { type: 'linear', steps: [] }, communicationMatrix: {},
      },
    });
    const remove = asAgentTeamDeleteCommand({
      commandId: '', idempotencyKey: '', expectedRevision: 1, teamId: 'team-empty',
    });
    const deploy = asAgentTeamDeployCommand({
      commandId: '', idempotencyKey: '', projectId: 'project-empty',
      teamId: 'team-empty', channelId: 'channel-empty',
    });
    for (const command of [update, remove, deploy]) {
      expect(service.execute(command)).toMatchObject({ status: 'rejected', reasonCode: 'command_envelope_mismatch' });
    }
  });

  it('rejects workflow and communication references outside the Team member set', () => {
    const service = new CommandService();
    saveRunnableAgent('member-agent');
    saveRunnableAgent('outside-agent');
    const base = {
      name: 'closed-team', displayName: 'Closed Team', description: '',
      members: [{ agentId: 'member-agent' }], teamMode: 'hub_spoke' as const,
    };
    const cases = [
      {
        workflow: { type: 'linear' as const, steps: [{ role: 'outside-agent', action: 'work', output: 'result' }] },
        communicationMatrix: { 'member-agent': { canSendTo: [], canReceiveFrom: [] } },
      },
      {
        workflow: { type: 'state_machine' as const, states: [{ name: 'work', role: 'outside-agent', description: '', transitions: [] }] },
        communicationMatrix: { 'member-agent': { canSendTo: [], canReceiveFrom: [] } },
      },
      {
        workflow: { type: 'linear' as const, steps: [] },
        communicationMatrix: { 'member-agent': { canSendTo: ['outside-agent'], canReceiveFrom: [] } },
      },
    ];
    for (const [index, topology] of cases.entries()) {
      const receipt = service.execute(asAgentTeamCreateCommand({
        commandId: `team-topology-${index}`, idempotencyKey: `team-topology-${index}`,
        team: { ...base, ...topology },
      }));
      expect(receipt).toMatchObject({ status: 'rejected' });
      expect(receipt.reasonCode).toMatch(/^agent_team_topology_member_not_found:/);
    }
  });
});
