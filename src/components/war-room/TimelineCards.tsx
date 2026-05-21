'use client';

import type { Blocker, InternalEvent, SupervisorOutputEnvelope } from '@/store/taskHubStore';
import { useTaskHubStore } from '@/store/taskHubStore';

const OUTPUT_KIND_LABELS: Record<string, string> = {
  decision_brief: '决策简报',
  execution_plan: '执行计划',
  status_report: '状态报告',
  quality_review_pack: '质量评审包',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  'run.started': '开始执行',
  'run.finished': '执行结束',
  'run.background_waiting': '后台等待',
  'task.status_changed': '任务状态变更',
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toISOString().replace('T', ' ').replace('.000Z', 'Z');
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
    inviteAgent('peach');
    inviteAgent('toad');

    addTask({
      title: 'UX：信息架构与验收标准',
      description: '梳理作战室/看板/质量页面的信息架构，并输出 v0 验收标准。',
      status: 'in_progress',
      agentId: 'luigi',
      dependencies: [],
      artifacts: [],
    });

    addTask({
      title: '研发：时间线卡片组件',
      description: '实现时间线卡片并集成到作战室页面。',
      status: 'in_progress',
      agentId: 'mario',
      dependencies: [],
      artifacts: [],
    });

    addTask({
      title: 'QA：质量门与阻塞检查',
      description: '验证：执行失败后任务会被立即阻塞，并在质量页面可见。',
      status: 'in_progress',
      agentId: 'peach',
      dependencies: [],
      artifacts: [],
    });

    addTask({
      title: '架构：边界与质量契约',
      description: '确认模块边界，提出 v0 质量门与风险策略。',
      status: 'in_progress',
      agentId: 'toad',
      dependencies: [],
      artifacts: [],
    });

    addSupervisorOutput({
      kind: 'status_report',
      conversationId: output.conversationId,
      invocationId: `inv-${Date.now()}`,
      timestamp: stamp,
      summary: '第 1 批次已启动，等待输出与质量门证据。',
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
            {OUTPUT_KIND_LABELS[output.kind] ?? output.kind.replace(/_/g, ' ')}
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
            启动第 1 批次
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
            阻塞项
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
          打开任务
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
          {EVENT_TYPE_LABELS[event.type] ?? '任务状态'}
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
          {EVENT_TYPE_LABELS[event.type] ?? '执行'}
        </div>
        <div className="text-[13px] font-semibold text-[hsl(var(--text-primary))]">
          {(EVENT_TYPE_LABELS[event.type] ?? event.type)} {payload.taskId ? `· ${payload.taskId}` : ''} {payload.agentId ? `· ${payload.agentId}` : ''}
          {typeof payload.code === 'number' ? ` · 退出码 ${payload.code}` : ''}
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
