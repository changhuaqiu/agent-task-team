import type Database from 'better-sqlite3';
import type {
  AutomationAction,
  AutomationDecision,
  AutomationDecisionStatus,
  AutomationRun,
  AutomationRunStatus,
  AutomationStepTrace,
  AutomationTrigger,
  ProjectAutomation,
} from '@/shared/automation';
import { getDb } from '../db';

interface AutomationRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  enabled: number;
  trigger_json: string;
  actions_json: string;
  revision: number;
  activation_watermark_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RevisionRow {
  automation_id: string;
  revision: number;
  project_id: string;
  name: string;
  description: string;
  enabled: number;
  trigger_json: string;
  actions_json: string;
  activation_watermark_at: string | null;
  effective_at: string;
  created_at?: string;
}

interface RunRow {
  id: string;
  automation_id: string;
  project_id: string;
  source_event_id: string | null;
  schedule_claim: string | null;
  status: AutomationRunStatus;
  current_step: number | null;
  trigger_context_json: string;
  definition_revision: number;
  trigger_snapshot_json: string;
  actions_snapshot_json: string;
  retry_count: number;
  trace_json: string;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DecisionRow {
  id: string;
  automation_id: string;
  run_id: string;
  project_id: string;
  step_id: string;
  prompt: string;
  status: AutomationDecisionStatus;
  requested_by: string;
  decided_by: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
}

function decision(row: DecisionRow): AutomationDecision {
  return {
    id: row.id,
    automationId: row.automation_id,
    runId: row.run_id,
    projectId: row.project_id,
    stepId: row.step_id,
    prompt: row.prompt,
    status: row.status,
    requestedBy: row.requested_by,
    ...(row.decided_by ? { decidedBy: row.decided_by } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at,
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
  };
}

function automation(row: AutomationRow): ProjectAutomation {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    trigger: JSON.parse(row.trigger_json) as AutomationTrigger,
    actions: JSON.parse(row.actions_json) as AutomationAction[],
    revision: row.revision,
    ...(row.activation_watermark_at ? { activationWatermarkAt: row.activation_watermark_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function revision(row: RevisionRow): ProjectAutomation {
  return {
    id: row.automation_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    trigger: JSON.parse(row.trigger_json) as AutomationTrigger,
    actions: JSON.parse(row.actions_json) as AutomationAction[],
    revision: row.revision,
    ...(row.activation_watermark_at ? { activationWatermarkAt: row.activation_watermark_at } : {}),
    createdAt: row.created_at ?? row.effective_at,
    updatedAt: row.effective_at,
  };
}

function run(row: RunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    projectId: row.project_id,
    ...(row.source_event_id ? { sourceEventId: row.source_event_id } : {}),
    ...(row.schedule_claim ? { scheduleClaim: row.schedule_claim } : {}),
    status: row.status,
    ...(row.current_step === null ? {} : { currentStep: row.current_step }),
    triggerContext: JSON.parse(row.trigger_context_json) as Record<string, unknown>,
    definitionRevision: row.definition_revision,
    triggerSnapshot: JSON.parse(row.trigger_snapshot_json) as AutomationTrigger,
    actionsSnapshot: JSON.parse(row.actions_snapshot_json) as AutomationAction[],
    retryCount: row.retry_count,
    trace: JSON.parse(row.trace_json) as AutomationStepTrace[],
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AutomationRepository {
  constructor(private readonly database?: Database.Database) {}

  private db(): Database.Database {
    return this.database ?? getDb();
  }

  create(
    input: {
      id: string;
      projectId: string;
      name: string;
      description?: string;
      trigger: AutomationTrigger;
      actions: AutomationAction[];
      enabled?: boolean;
    },
    now = new Date().toISOString(),
  ): ProjectAutomation {
    return this.db().transaction(() => {
      const activationWatermarkAt = input.enabled ? now : null;
      this.db().prepare(`
        INSERT INTO project_automation (
          id,project_id,name,description,enabled,trigger_json,actions_json,revision,
          activation_watermark_at,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,1,?,?,?)
      `).run(
        input.id,
        input.projectId,
        input.name.trim(),
        input.description?.trim() ?? '',
        input.enabled ? 1 : 0,
        JSON.stringify(input.trigger),
        JSON.stringify(input.actions),
        activationWatermarkAt,
        now,
        now,
      );
      const created = this.get(input.id)!;
      this.insertRevision(created, now);
      return created;
    })();
  }

  get(id: string): ProjectAutomation | undefined {
    const row = this.db().prepare('SELECT * FROM project_automation WHERE id=?').get(id) as AutomationRow | undefined;
    return row ? automation(row) : undefined;
  }

  list(projectId: string): ProjectAutomation[] {
    return (this.db().prepare(`
      SELECT * FROM project_automation WHERE project_id=? ORDER BY updated_at DESC,id
    `).all(projectId) as AutomationRow[]).map(automation);
  }

  listEnabledSchedules(): ProjectAutomation[] {
    return (this.db().prepare(`
      SELECT * FROM project_automation WHERE enabled=1 ORDER BY updated_at,id
    `).all() as AutomationRow[]).map(automation).filter((item) => item.trigger.type === 'schedule');
  }

  listEventRevisionsAt(projectId: string, eventType: string, recordedAt: string): ProjectAutomation[] {
    const rows = this.db().prepare(`
      SELECT revision.*, current.created_at
      FROM automation_definition_revision revision
      JOIN project_automation current ON current.id=revision.automation_id
      WHERE revision.project_id=?
        AND revision.effective_at<=?
        AND NOT EXISTS (
          SELECT 1 FROM automation_definition_revision candidate
          WHERE candidate.automation_id=revision.automation_id
            AND candidate.effective_at<=?
            AND (
              candidate.effective_at>revision.effective_at
              OR (candidate.effective_at=revision.effective_at AND candidate.revision>revision.revision)
            )
        )
      ORDER BY revision.automation_id
    `).all(projectId, recordedAt, recordedAt) as RevisionRow[];
    return rows
      .map(revision)
      .filter((item) => item.enabled)
      .filter((item) => !item.activationWatermarkAt || item.activationWatermarkAt <= recordedAt)
      .filter((item) => item.trigger.type === 'event' && item.trigger.eventType === eventType);
  }

  update(
    id: string,
    expectedRevision: number,
    input: { name: string; description?: string; trigger: AutomationTrigger; actions: AutomationAction[] },
    now = new Date().toISOString(),
  ): ProjectAutomation | undefined {
    return this.db().transaction(() => {
      const result = this.db().prepare(`
        UPDATE project_automation
        SET name=?,description=?,trigger_json=?,actions_json=?,revision=revision+1,updated_at=?
        WHERE id=? AND revision=?
      `).run(
        input.name.trim(),
        input.description?.trim() ?? '',
        JSON.stringify(input.trigger),
        JSON.stringify(input.actions),
        now,
        id,
        expectedRevision,
      );
      if (result.changes !== 1) return undefined;
      const updated = this.get(id)!;
      this.insertRevision(updated, now);
      return updated;
    })();
  }

  setEnabled(
    id: string,
    expectedRevision: number,
    enabled: boolean,
    now = new Date().toISOString(),
  ): ProjectAutomation | undefined {
    return this.db().transaction(() => {
      const result = this.db().prepare(`
        UPDATE project_automation
        SET enabled=?,activation_watermark_at=?,revision=revision+1,updated_at=?
        WHERE id=? AND revision=?
      `).run(enabled ? 1 : 0, enabled ? now : null, now, id, expectedRevision);
      if (result.changes !== 1) return undefined;
      const updated = this.get(id)!;
      this.insertRevision(updated, now);
      return updated;
    })();
  }

  createRun(
    input: {
      id: string;
      automationId: string;
      projectId: string;
      sourceEventId?: string;
      scheduleClaim?: string;
      triggerContext: Record<string, unknown>;
      definitionRevision?: number;
      triggerSnapshot?: AutomationTrigger;
      actionsSnapshot?: AutomationAction[];
    },
    now = new Date().toISOString(),
  ): AutomationRun {
    const definition = this.get(input.automationId);
    const definitionRevision = input.definitionRevision ?? definition?.revision ?? 1;
    const triggerSnapshot = input.triggerSnapshot ?? definition?.trigger ?? { type: 'manual' };
    const actionsSnapshot = input.actionsSnapshot ?? definition?.actions ?? [];
    this.db().prepare(`
      INSERT INTO automation_run (
        id,automation_id,project_id,source_event_id,schedule_claim,status,
        trigger_context_json,definition_revision,trigger_snapshot_json,
        actions_snapshot_json,retry_count,trace_json,created_at,updated_at
      ) VALUES (?,?,?,?,?,'pending',?,?,?,?,0,'[]',?,?)
    `).run(
      input.id,
      input.automationId,
      input.projectId,
      input.sourceEventId ?? null,
      input.scheduleClaim ?? null,
      JSON.stringify(input.triggerContext),
      definitionRevision,
      JSON.stringify(triggerSnapshot),
      JSON.stringify(actionsSnapshot),
      now,
      now,
    );
    return this.getRun(input.id)!;
  }

  getRun(id: string): AutomationRun | undefined {
    const row = this.db().prepare('SELECT * FROM automation_run WHERE id=?').get(id) as RunRow | undefined;
    return row ? run(row) : undefined;
  }

  getRunBySourceEvent(automationId: string, sourceEventId: string): AutomationRun | undefined {
    const row = this.db().prepare(`
      SELECT * FROM automation_run WHERE automation_id=? AND source_event_id=?
    `).get(automationId, sourceEventId) as RunRow | undefined;
    return row ? run(row) : undefined;
  }

  getRunByScheduleClaim(automationId: string, scheduleClaim: string): AutomationRun | undefined {
    const row = this.db().prepare(`
      SELECT * FROM automation_run WHERE automation_id=? AND schedule_claim=?
    `).get(automationId, scheduleClaim) as RunRow | undefined;
    return row ? run(row) : undefined;
  }

  listRuns(automationId: string, limit = 50): AutomationRun[] {
    return (this.db().prepare(`
      SELECT * FROM automation_run WHERE automation_id=? ORDER BY created_at DESC,id DESC LIMIT ?
    `).all(automationId, Math.max(1, Math.min(200, limit))) as RunRow[]).map(run);
  }

  getDecision(id: string): AutomationDecision | undefined {
    const row = this.db().prepare('SELECT * FROM automation_decision WHERE id=?')
      .get(id) as DecisionRow | undefined;
    return row ? decision(row) : undefined;
  }

  getDecisionForStep(runId: string, stepId: string): AutomationDecision | undefined {
    const row = this.db().prepare(`
      SELECT * FROM automation_decision WHERE run_id=? AND step_id=?
    `).get(runId, stepId) as DecisionRow | undefined;
    return row ? decision(row) : undefined;
  }

  listDecisionsForRun(runId: string): AutomationDecision[] {
    return (this.db().prepare(`
      SELECT * FROM automation_decision WHERE run_id=? ORDER BY created_at,id
    `).all(runId) as DecisionRow[]).map(decision);
  }

  requestDecision(input: {
    id: string;
    automationId: string;
    runId: string;
    projectId: string;
    stepId: string;
    prompt: string;
    requestedBy: string;
  }, now = new Date().toISOString()): AutomationDecision {
    const existing = this.getDecisionForStep(input.runId, input.stepId);
    if (existing) {
      if (
        existing.automationId !== input.automationId
        || existing.projectId !== input.projectId
        || existing.prompt !== input.prompt.trim()
      ) throw new Error('automation_decision_conflict');
      return existing;
    }
    this.db().prepare(`
      INSERT INTO automation_decision (
        id,automation_id,run_id,project_id,step_id,prompt,status,requested_by,created_at
      ) VALUES (?,?,?,?,?,?,'pending',?,?)
    `).run(
      input.id,
      input.automationId,
      input.runId,
      input.projectId,
      input.stepId,
      input.prompt.trim(),
      input.requestedBy,
      now,
    );
    return this.getDecision(input.id)!;
  }

  resolveDecision(input: {
    id: string;
    status: Exclude<AutomationDecisionStatus, 'pending'>;
    decidedBy: string;
    note?: string;
  }, now = new Date().toISOString()): { decision: AutomationDecision; duplicate: boolean } {
    const current = this.getDecision(input.id);
    if (!current) throw new Error('automation_decision_not_found');
    if (current.status !== 'pending') {
      if (current.status !== input.status) throw new Error('automation_decision_conflict');
      return { decision: current, duplicate: true };
    }
    const result = this.db().prepare(`
      UPDATE automation_decision
      SET status=?,decided_by=?,note=?,decided_at=?
      WHERE id=? AND status='pending'
    `).run(input.status, input.decidedBy, input.note?.trim() || null, now, input.id);
    if (result.changes !== 1) {
      const raced = this.getDecision(input.id)!;
      if (raced.status !== input.status) throw new Error('automation_decision_conflict');
      return { decision: raced, duplicate: true };
    }
    return { decision: this.getDecision(input.id)!, duplicate: false };
  }

  updateRun(
    id: string,
    input: {
      status: AutomationRunStatus;
      currentStep?: number;
      trace: AutomationStepTrace[];
      errorCode?: string;
      errorMessage?: string;
      startedAt?: string;
      completedAt?: string;
    },
    now = new Date().toISOString(),
  ): AutomationRun {
    this.db().prepare(`
      UPDATE automation_run
      SET status=?,current_step=?,trace_json=?,error_code=?,error_message=?,
        started_at=COALESCE(?,started_at),completed_at=?,updated_at=?
      WHERE id=?
    `).run(
      input.status,
      input.currentStep ?? null,
      JSON.stringify(input.trace),
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.startedAt ?? null,
      input.completedAt ?? null,
      now,
      id,
    );
    return this.getRun(id)!;
  }

  retryRun(id: string, now = new Date().toISOString()): AutomationRun | undefined {
    const result = this.db().prepare(`
      UPDATE automation_run
      SET status='pending',retry_count=retry_count+1,error_code=NULL,error_message=NULL,
        completed_at=NULL,updated_at=?
      WHERE id=? AND status='failed' AND COALESCE(error_code,'')<>'automation_command_delivery_unknown'
    `).run(now, id);
    return result.changes === 1 ? this.getRun(id) : undefined;
  }

  private insertRevision(definition: ProjectAutomation, effectiveAt: string): void {
    this.db().prepare(`
      INSERT INTO automation_definition_revision (
        automation_id,revision,project_id,name,description,enabled,trigger_json,
        actions_json,activation_watermark_at,effective_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      definition.id,
      definition.revision,
      definition.projectId,
      definition.name,
      definition.description,
      definition.enabled ? 1 : 0,
      JSON.stringify(definition.trigger),
      JSON.stringify(definition.actions),
      definition.activationWatermarkAt ?? null,
      effectiveAt,
    );
  }
}

export const automationRepo = new AutomationRepository();
