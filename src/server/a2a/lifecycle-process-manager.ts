import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import { A2ACollaborationRepository } from './collaboration';

interface RuntimeCompletionPassRow {
  pass_id: string | null;
}

export interface A2ALifecycleProcessManagerOptions {
  db?: Database.Database;
  collaboration?: A2ACollaborationRepository;
}

export class A2ALifecycleProcessManager {
  private readonly database?: Database.Database;
  private readonly collaboration: A2ACollaborationRepository;

  constructor(options: A2ALifecycleProcessManagerOptions = {}) {
    this.database = options.db;
    this.collaboration = options.collaboration
      ?? new A2ACollaborationRepository({ db: options.db });
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (signal.aborted) throw signal.reason ?? new Error('a2a_lifecycle_processing_aborted');
    const db = this.database ?? getDb();
    if (event.type.startsWith('agent.work.')) {
      const payload = event.payload as { passId?: string; reasonCode?: string };
      if (!payload.passId) return;
      if (event.type === 'agent.work.admitted') {
        this.advanceToStarting(payload.passId);
      } else if (
        event.type === 'agent.work.expired'
        || event.type === 'agent.work.cancelled'
      ) {
        this.failBeforeStart(
          payload.passId,
          payload.reasonCode ?? (
            event.type === 'agent.work.cancelled'
              ? 'agent_work_cancelled'
              : 'agent_work_expired'
          ),
        );
      }
      return;
    }
    if (
      event.type !== 'runtime.invocation.started'
      && event.type !== 'runtime.invocation.terminated'
    ) {
      return;
    }
    if (!event.invocationId) return;
    const context = db.prepare(`
      SELECT pass_id FROM runtime_completion_context WHERE invocation_id=?
    `).get(event.invocationId) as RuntimeCompletionPassRow | undefined;
    if (!context?.pass_id) return;
    if (event.type === 'runtime.invocation.started') {
      this.advanceToStarted(context.pass_id);
      return;
    }
    const pass = this.collaboration.getPass(context.pass_id);
    if (!pass || !['offered', 'accepted', 'starting', 'started'].includes(pass.status)) return;
    const payload = event.payload as { outcome?: string; reasonCode?: string };
    const afterStart = pass.status === 'started';
    this.collaboration.failPass({
      passId: pass.id,
      expectedRevision: pass.revision,
      status: payload.outcome === 'timed_out' ? 'timeout' : 'error',
      reasonCode: payload.reasonCode
        ?? `runtime_${payload.outcome ?? 'terminated'}_${afterStart ? 'during_run' : 'before_start'}`,
      phase: afterStart ? 'run' : 'start',
    });
  };

  private advanceToStarting(passId: string): void {
    let pass = this.collaboration.getPass(passId);
    if (!pass) return;
    if (pass.status === 'offered') {
      pass = this.collaboration.markPassAdmitted(pass.id, pass.revision);
    }
    if (pass.status === 'accepted') {
      this.collaboration.markPassStarting(pass.id, pass.revision);
    }
  }

  private advanceToStarted(passId: string): void {
    this.advanceToStarting(passId);
    const pass = this.collaboration.getPass(passId);
    if (pass?.status === 'starting') {
      this.collaboration.markPassStarted(pass.id, pass.revision);
    }
  }

  private failBeforeStart(passId: string, reasonCode: string): void {
    const pass = this.collaboration.getPass(passId);
    if (!pass || !['offered', 'accepted', 'starting'].includes(pass.status)) return;
    this.collaboration.failPass({
      passId: pass.id,
      expectedRevision: pass.revision,
      status: 'rejected',
      reasonCode,
      phase: 'start',
    });
  }
}
