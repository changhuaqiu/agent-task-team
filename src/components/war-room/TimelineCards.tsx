'use client';

import type { Blocker, InternalEvent, SupervisorOutputEnvelope } from '@/store/taskHubStore';
import { useTaskHubStore } from '@/store/taskHubStore';

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function SupervisorOutputCard({ output }: { output: SupervisorOutputEnvelope }) {
  const addSupervisorOutput = useTaskHubStore((s) => s.addSupervisorOutput);
  const addTask = useTaskHubStore((s) => s.addTask);
  const inviteAgent = useTaskHubStore((s) => s.inviteAgent);

  const applySamplePlan = () => {
    const stamp = new Date().toISOString();
    inviteAgent('nahida');
    inviteAgent('zhongli');

    addTask({
      title: 'UX: IA + acceptance criteria',
      description: 'Define IA for War Room/Board/Quality and write acceptance criteria for v0.',
      status: 'in_progress',
      agentId: 'keqing',
      dependencies: [],
      artifacts: [],
    });

    addTask({
      title: 'Dev: timeline components',
      description: 'Implement timeline cards and integrate into War Room view.',
      status: 'in_progress',
      agentId: 'jean',
      dependencies: [],
      artifacts: [],
    });

    addTask({
      title: 'QA: gate + blocker checks',
      description: 'Validate that failing runs immediately block tasks and surface blockers in Quality view.',
      status: 'in_progress',
      agentId: 'nahida',
      dependencies: [],
      artifacts: [],
    });

    addTask({
      title: 'Arch: guardrails & quality contract',
      description: 'Confirm module boundaries and propose v0 quality gates + risk policy.',
      status: 'in_progress',
      agentId: 'zhongli',
      dependencies: [],
      artifacts: [],
    });

    addSupervisorOutput({
      kind: 'status_report',
      conversationId: output.conversationId,
      invocationId: `inv-${Date.now()}`,
      timestamp: stamp,
      summary: 'Batch 1 started. Awaiting outputs and quality gate evidence.',
      needsHuman: false,
      humanActions: [],
      body: {
        phase: 'build',
        progress: { done: [], inProgress: [], blocked: [] },
        risksTop3: [],
        nextStepsTop3: [],
        evidenceLinks: [],
      },
    });
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
            {output.kind.replace(/_/g, ' ')}
          </div>
          <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))]">
            {output.summary}
          </div>
          <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
            {formatTime(output.timestamp)}
          </div>
        </div>

        {output.kind === 'execution_plan' && (
          <button
            type="button"
            className="h-8 px-3 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[12px] font-semibold"
            onClick={applySamplePlan}
          >
            Start Batch 1
          </button>
        )}
      </div>

      {output.humanActions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {output.humanActions.map((a) => (
            <button
              key={a.actionId}
              type="button"
              className="h-8 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-semibold"
              onClick={() => {
                if (output.kind === 'execution_plan' && a.actionId === 'confirm_plan') {
                  applySamplePlan();
                  return;
                }
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function BlockerCard({ blocker }: { blocker: Blocker }) {
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  return (
    <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--danger))]">
            Blocker
          </div>
          <div className="text-[13px] font-semibold text-[hsl(var(--text-primary))]">
            {blocker.reasonSummary}
          </div>
          <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
            {formatTime(blocker.createdAt)}
          </div>
        </div>
        <button
          type="button"
          className="h-8 px-3 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[12px] font-semibold"
          onClick={() => setSelectedTaskId(blocker.taskId)}
        >
          Open Task
        </button>
      </div>
    </div>
  );
}

export function EventCard({ event }: { event: InternalEvent }) {
  if (event.type === 'supervisor.output') {
    return <SupervisorOutputCard output={event.payload as SupervisorOutputEnvelope} />;
  }
  if (event.type === 'blocker.opened') {
    return <BlockerCard blocker={event.payload as Blocker} />;
  }

  if (event.type === 'task.status_changed') {
    const payload = event.payload as { taskId?: string; status?: string };
    return (
      <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
        <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
          Task Status
        </div>
        <div className="text-[13px] font-semibold text-[hsl(var(--text-primary))]">
          {payload.taskId} → {payload.status}
        </div>
        <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
          {formatTime(event.timestamp)}
        </div>
      </div>
    );
  }

  if (event.type === 'run.started' || event.type === 'run.finished') {
    const payload = event.payload as { runId?: string; agentId?: string; taskId?: string; code?: number };
    return (
      <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
        <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
          Run
        </div>
        <div className="text-[13px] font-semibold text-[hsl(var(--text-primary))]">
          {event.type} {payload.taskId ? `· ${payload.taskId}` : ''} {payload.agentId ? `· ${payload.agentId}` : ''}
          {typeof payload.code === 'number' ? ` · exit ${payload.code}` : ''}
        </div>
        <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
          {formatTime(event.timestamp)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
      <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
        {event.type}
      </div>
      <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
        {formatTime(event.timestamp)}
      </div>
    </div>
  );
}
