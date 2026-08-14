import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { RuntimeCliEngine } from '@/lib/team-runtime';
import { resolveRuntimeAgentProfile, resolveTeamRuntime } from '@/lib/team-runtime';
import type { RuntimeAgentProfile, RuntimeSkillSummary, TeamRuntime } from '@/lib/team-runtime';
import type { TeamPack } from '@/types/teamPack';
import { getDb } from '../db';
import { listAccounts } from '../accounts-file';
import { hasCredential } from '../credentials';
import { isAccountReadyForExecution } from '@/lib/account-auth';
import { conversationRepo } from '../repositories/conversation-repo';
import { skillRepo } from '../repositories/skill-repo';
import { teamPackRepo } from '../repositories/team-pack-repo';
import { digest, stableJson } from './defaults';
import { normalizePersistedRuntimeSelection } from '../runtime-selection';

type Row = Record<string, unknown>;

export type ApplicationSnapshotSource = 'published' | 'candidate';
export type EvaluationVariant = 'baseline' | 'candidate';
export type CaseExecutionStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'evaluating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface FrozenAgentManifest {
  agentId: string;
  engine: RuntimeCliEngine;
  runtimeId?: string;
  accountId?: string;
  accountConfigDigest?: string;
  roleCardDigest?: string;
  skillRevisions: Array<{ skillId: string; revisionId: string; contentHash: string }>;
}

export interface ApplicationManifest {
  schemaVersion: 1;
  projectPath: string;
  codeRevision: string;
  team: TeamPack;
  agents: FrozenAgentManifest[];
}

export interface FreezeApplicationSnapshotInput {
  conversationId: string;
  name: string;
  source: ApplicationSnapshotSource;
  codeRevision?: string;
  team?: TeamPack;
  skillRevisionOverrides?: Record<string, string>;
  createdBy?: string;
}

function resolveCommit(projectPath: string, requested?: string): string {
  const revision = requested?.trim() || 'HEAD';
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], {
      cwd: projectPath,
      encoding: 'utf8',
      timeout: 3_000,
      windowsHide: true,
    }).trim();
  } catch {
    throw new Error(`Application snapshot code revision is not available: ${revision}`);
  }
}

function frozenAgents(
  conversationId: string,
  team: TeamPack,
  revisionOverrides: Record<string, string>,
): FrozenAgentManifest[] {
  const allSkills = Object.fromEntries(skillRepo.list().map((skill) => [skill.id, {
    id: skill.id,
    name: skill.name,
    description: skill.description ?? undefined,
    version: skill.version,
    config: skill.config ?? undefined,
  }]));
  const agentSkillIds = skillRepo.getAllAgentSkillIds();
  const runtime = resolveTeamRuntime({
    conversationId,
    teamPack: team,
    presetAgents: [],
    activeAgentIds: team.roles.map((role) => role.id),
    roleCards: [],
    skillsMap: allSkills,
    agentSkillIds,
    agentAccountOverrides: {},
    agentRoleCardOverrides: {},
  });
  const accounts = listAccounts().map((account) => ({
    id: account.id,
    provider: account.provider,
    authMode: account.authMode,
    enabled: account.enabled,
    status: account.status,
    baseUrl: account.baseUrl,
    models: account.models,
    hasApiKey: hasCredential(account.id),
  }));
  const agents = team.roles.flatMap((role): FrozenAgentManifest[] => {
    const profile = resolveRuntimeAgentProfile(runtime, role.id, accounts);
    if (!profile) return [];
    const skillIds = Array.from(new Set([
      ...(role.skillIds ?? []),
      ...profile.prompt.skills.map((skill) => skill.id).filter((id): id is string => Boolean(id)),
    ])).sort();
    const skillRevisions = skillIds.map((skillId) => {
      const requestedRevisionId = revisionOverrides[skillId];
      const revision = requestedRevisionId
        ? skillRepo.getRevisionById(requestedRevisionId)
        : skillRepo.getActiveRevision(skillId);
      if (!revision || revision.skill_id !== skillId) {
        throw new Error(`Skill revision is unavailable for ${skillId}: ${requestedRevisionId ?? 'active'}`);
      }
      return { skillId, revisionId: revision.id, contentHash: revision.content_hash };
    });
    const selectedAccount = profile.execution.accountId
      ? listAccounts().find((account) => account.id === profile.execution.accountId)
      : undefined;
    return [{
      agentId: role.id,
      engine: profile.execution.engine,
      runtimeId: profile.execution.runtimeId,
      accountId: profile.execution.accountId,
      accountConfigDigest: selectedAccount ? digest({
        provider: selectedAccount.provider,
        authMode: selectedAccount.authMode,
        baseUrl: selectedAccount.baseUrl,
        models: selectedAccount.models,
      }) : undefined,
      roleCardDigest: role.roleCardSnapshot ? digest(role.roleCardSnapshot) : undefined,
      skillRevisions,
    }];
  }).sort((left, right) => left.agentId.localeCompare(right.agentId));
  if (!agents.length) throw new Error('Application snapshot requires at least one configured runtime agent');
  return agents;
}

function parseSnapshot(row: Row): Row & { manifest: ApplicationManifest } {
  const team = JSON.parse(String(row.team_manifest)) as TeamPack;
  const agents = JSON.parse(String(row.agent_manifest)) as FrozenAgentManifest[];
  return {
    ...row,
    manifest: {
      schemaVersion: 1,
      projectPath: String(row.project_path),
      codeRevision: String(row.code_revision),
      team,
      agents,
    },
  };
}

export function freezeApplicationSnapshot(input: FreezeApplicationSnapshotInput): Row & { manifest: ApplicationManifest } {
  const conversation = conversationRepo.getById(input.conversationId);
  if (!conversation?.project_path) throw new Error('Application snapshot requires a project path');
  const team = input.team ?? (conversation.team_pack_id ? teamPackRepo.getById(conversation.team_pack_id) : undefined);
  if (!team) throw new Error('Application snapshot requires a frozen team configuration');
  const manifest: ApplicationManifest = {
    schemaVersion: 1,
    projectPath: conversation.project_path,
    codeRevision: resolveCommit(conversation.project_path, input.codeRevision),
    team,
    agents: frozenAgents(input.conversationId, team, input.skillRevisionOverrides ?? {}),
  };
  const manifestDigest = digest(manifest);
  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM eval_application_snapshot WHERE conversation_id=? AND manifest_digest=?',
  ).get(input.conversationId, manifestDigest) as Row | undefined;
  if (existing) return parseSnapshot(existing);
  const id = `app-snapshot-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO eval_application_snapshot
    (id,conversation_id,name,source,project_path,code_revision,team_manifest,agent_manifest,
     manifest_digest,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    input.conversationId,
    input.name,
    input.source,
    manifest.projectPath,
    manifest.codeRevision,
    stableJson(manifest.team),
    stableJson(manifest.agents),
    manifestDigest,
    input.createdBy ?? 'platform-user',
    now,
  );
  return parseSnapshot(db.prepare('SELECT * FROM eval_application_snapshot WHERE id=?').get(id) as Row);
}

export function getApplicationSnapshot(id: string, conversationId: string): (Row & { manifest: ApplicationManifest }) | undefined {
  const row = getDb().prepare(
    'SELECT * FROM eval_application_snapshot WHERE id=? AND conversation_id=?',
  ).get(id, conversationId) as Row | undefined;
  return row ? parseSnapshot(row) : undefined;
}

export function resolveApplicationSnapshotRuntime(
  snapshotId: string,
  conversationId: string,
  agentId: string,
): { snapshot: Row & { manifest: ApplicationManifest }; runtime: TeamRuntime; profile: RuntimeAgentProfile } | undefined {
  const snapshot = getApplicationSnapshot(snapshotId, conversationId);
  if (!snapshot) return undefined;
  const frozenAgent = snapshot.manifest.agents.find((agent) => agent.agentId === agentId);
  if (!frozenAgent) return undefined;
  if (frozenAgent.accountId) {
    const account = listAccounts().find((item) => item.id === frozenAgent.accountId && item.enabled);
    if (account && !isAccountReadyForExecution({
      ...account,
      hasApiKey: hasCredential(account.id),
    })) {
      throw new Error(`Application snapshot account is not ready: ${frozenAgent.accountId}`);
    }
    const currentDigest = account ? digest({
      provider: account.provider,
      authMode: account.authMode,
      baseUrl: account.baseUrl,
      models: account.models,
    }) : undefined;
    if (!account || currentDigest !== frozenAgent.accountConfigDigest) {
      throw new Error(`Application snapshot account configuration changed: ${frozenAgent.accountId}`);
    }
  }
  const skillsMap: Record<string, RuntimeSkillSummary> = {};
  for (const item of frozenAgent.skillRevisions) {
    const skill = skillRepo.getById(item.skillId);
    const revision = skillRepo.getRevisionById(item.revisionId);
    if (!skill || !revision || revision.skill_id !== item.skillId || revision.content_hash !== item.contentHash) {
      throw new Error(`Application snapshot Skill revision is unavailable: ${item.skillId}/${item.revisionId}`);
    }
    skillsMap[item.skillId] = {
      id: item.skillId,
      name: skill.name,
      description: revision.description,
      content: revision.body,
      config: revision.config ?? undefined,
    };
  }
  const agentSkillIds = Object.fromEntries(snapshot.manifest.agents.map((agent) => [
    agent.agentId,
    agent.skillRevisions.map((skill) => skill.skillId),
  ]));
  const runtime = resolveTeamRuntime({
    conversationId,
    teamPack: snapshot.manifest.team,
    presetAgents: [],
    activeAgentIds: snapshot.manifest.agents.map((agent) => agent.agentId),
    roleCards: [],
    skillsMap,
    agentSkillIds,
    agentAccountOverrides: Object.fromEntries(snapshot.manifest.agents.map((agent) => [
      agent.agentId,
      agent.accountId ? [agent.accountId] : [],
    ])),
    agentRoleCardOverrides: {},
  });
  const agent = runtime.roster.find((item) => item.id === agentId);
  if (!agent) return undefined;
  const execution = normalizePersistedRuntimeSelection(
    frozenAgent.engine,
    frozenAgent.runtimeId,
  );
  return {
    snapshot,
    runtime,
    profile: {
      agent,
      execution: {
        engine: execution.engine,
        runtimeId: execution.runtimeId,
        accountId: frozenAgent.accountId,
      },
      prompt: {
        roleCard: agent.roleCard,
        skills: agent.skills,
        teamPack: runtime.teamPack,
        roster: runtime.roster,
      },
    },
  };
}

export function createCaseExecution(input: {
  conversationId: string;
  experimentId?: string;
  caseId: string;
  applicationSnapshotId: string;
  variant: EvaluationVariant;
  agentId?: string;
}): Row {
  const db = getDb();
  const snapshot = getApplicationSnapshot(input.applicationSnapshotId, input.conversationId);
  if (!snapshot) throw new Error('Application snapshot not found in project');
  const agentId = input.agentId ?? snapshot.manifest.agents[0]?.agentId;
  if (!agentId || !snapshot.manifest.agents.some((agent) => agent.agentId === agentId)) {
    throw new Error('Case execution Agent is not available in the application snapshot');
  }
  const caseRow = db.prepare(`SELECT c.id FROM eval_case c JOIN eval_dataset d ON d.id=c.dataset_id
    WHERE c.id=? AND c.split='held_out' AND (d.conversation_id=? OR d.conversation_id IS NULL)`)
    .get(input.caseId, input.conversationId);
  if (!caseRow) throw new Error('Held-out case not found in project');
  if (input.experimentId && !db.prepare(
    'SELECT id FROM eval_experiment WHERE id=? AND conversation_id=?',
  ).get(input.experimentId, input.conversationId)) throw new Error('Experiment not found in project');
  const existing = input.experimentId
    ? db.prepare('SELECT * FROM eval_case_execution WHERE experiment_id=? AND case_id=? AND variant=?')
      .get(input.experimentId, input.caseId, input.variant) as Row | undefined
    : undefined;
  if (existing) return existing;
  const id = `case-execution-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO eval_case_execution
    (id,conversation_id,experiment_id,case_id,application_snapshot_id,agent_id,variant,status,
     target_manifest_digest,execution_verified,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'queued',?,0,?,?)`).run(
    id,
    input.conversationId,
    input.experimentId ?? null,
    input.caseId,
    input.applicationSnapshotId,
    agentId,
    input.variant,
    snapshot.manifest_digest,
    now,
    now,
  );
  return db.prepare('SELECT * FROM eval_case_execution WHERE id=?').get(id) as Row;
}

const allowedTransitions: Record<CaseExecutionStatus, CaseExecutionStatus[]> = {
  queued: ['planning', 'cancelled', 'failed'],
  planning: ['queued', 'running', 'failed', 'cancelled'],
  running: ['evaluating', 'failed', 'cancelled'],
  evaluating: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function transitionCaseExecution(input: {
  id: string;
  conversationId: string;
  status: CaseExecutionStatus;
  taskId?: string;
  harnessTriggerId?: string;
  invocationId?: string;
  traceId?: string;
  evalRunId?: string;
  proofEventId?: string;
  observedManifestDigest?: string;
  errorCode?: string;
  errorMessage?: string;
}): Row {
  const db = getDb();
  const current = db.prepare(
    'SELECT * FROM eval_case_execution WHERE id=? AND conversation_id=?',
  ).get(input.id, input.conversationId) as Row | undefined;
  if (!current) throw new Error('Case execution not found');
  if (!allowedTransitions[String(current.status) as CaseExecutionStatus].includes(input.status)) {
    throw new Error(`Invalid case execution transition: ${String(current.status)} -> ${input.status}`);
  }
  const observed = input.observedManifestDigest ?? current.observed_manifest_digest;
  const verified = input.status === 'completed'
    && Boolean(input.invocationId ?? current.invocation_id)
    && Boolean(input.traceId ?? current.trace_id)
    && Boolean(input.evalRunId ?? current.eval_run_id)
    && observed === current.target_manifest_digest;
  if (input.status === 'completed' && !verified) {
    throw new Error('Completed case execution requires matching observed manifest and bound invocation, trace, and EvalRun');
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE eval_case_execution SET
    status=?,task_id=COALESCE(?,task_id),harness_trigger_id=COALESCE(?,harness_trigger_id),
    invocation_id=COALESCE(?,invocation_id),trace_id=COALESCE(?,trace_id),
    eval_run_id=COALESCE(?,eval_run_id),proof_event_id=COALESCE(?,proof_event_id),
    observed_manifest_digest=COALESCE(?,observed_manifest_digest),execution_verified=?,
    error_code=COALESCE(?,error_code),error_message=COALESCE(?,error_message),
    started_at=CASE WHEN ?='running' THEN COALESCE(started_at,?) ELSE started_at END,
    completed_at=CASE WHEN ? IN ('completed','failed','cancelled') THEN ? ELSE completed_at END,
    updated_at=? WHERE id=?`).run(
    input.status,
    input.taskId ?? null,
    input.harnessTriggerId ?? null,
    input.invocationId ?? null,
    input.traceId ?? null,
    input.evalRunId ?? null,
    input.proofEventId ?? null,
    input.observedManifestDigest ?? null,
    verified ? 1 : 0,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    input.status,
    now,
    input.status,
    now,
    now,
    input.id,
  );
  return db.prepare('SELECT * FROM eval_case_execution WHERE id=?').get(input.id) as Row;
}
