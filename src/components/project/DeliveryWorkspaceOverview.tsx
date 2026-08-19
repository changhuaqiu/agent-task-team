import { AlertTriangle, CheckCircle2, CircleDot, Flag, FolderOpen } from 'lucide-react';
import type { DeliveryWorkspaceView } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

export function DeliveryWorkspaceOverview({ view }: { view: DeliveryWorkspaceView | null }) {
  if (!view) {
    return (
      <section className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-5 py-4">
        <div className="text-sm font-semibold text-[hsl(var(--text-primary))]">选择或新建一个交付</div>
        <p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">交付会把目标、验收、工作进展和需要处理集中在一起。</p>
      </section>
    );
  }

  const acceptanceProgress = view.acceptance.total > 0
    ? Math.round((view.acceptance.passed / view.acceptance.total) * 100)
    : 0;
  const stageLabel = {
    planning: '规划中',
    executing: '执行中',
    reviewing: '评审中',
    verifying: '验收中',
    integrating: '集成中',
    delivering: '交付中',
    active: '进行中',
    paused: '已暂停',
    completed: '已完成',
    archived: '已归档',
  }[view.stage];
  const currentWork = view.work.current[0];

  return (
    <section className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-5 py-4">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-[hsl(var(--text-tertiary))]">
            <FolderOpen className="size-3" />
            <span className="truncate">{view.project.name}</span>
          </div>
          <h2 className="mt-1 truncate text-base font-semibold text-[hsl(var(--text-primary))]">{view.delivery.title}</h2>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[hsl(var(--text-secondary))]">{view.delivery.goal}</p>
        </div>

        <div className="grid shrink-0 grid-cols-4 gap-2">
          <div className="min-w-[72px] rounded-md bg-[hsl(var(--bg-muted))] px-2.5 py-2">
            <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-tertiary))]"><Flag className="size-3" />阶段</div>
            <div className="mt-1 text-xs font-semibold text-[hsl(var(--text-primary))]">{stageLabel}</div>
          </div>
          <div className="min-w-[72px] rounded-md bg-[hsl(var(--bg-muted))] px-2.5 py-2">
            <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-tertiary))]"><CheckCircle2 className="size-3" />验收</div>
            <div className="mt-1 text-sm font-semibold tabular-nums text-[hsl(var(--text-primary))]">
              {view.acceptance.total > 0 ? `${view.acceptance.passed}/${view.acceptance.total}` : '未设置'}
            </div>
          </div>
          <div className="min-w-[72px] rounded-md bg-[hsl(var(--bg-muted))] px-2.5 py-2">
            <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-tertiary))]"><CircleDot className="size-3" />任务</div>
            <div className="mt-1 flex items-baseline gap-1 text-[hsl(var(--text-primary))]">
              <span className="text-sm font-semibold tabular-nums">{view.work.completed}/{view.work.total}</span>
              {view.work.terminalProjectionConflict && (
                <span className="text-[9px] font-medium text-[hsl(var(--status-pending))]">需核对</span>
              )}
            </div>
          </div>
          <div className="min-w-[72px] rounded-md bg-[hsl(var(--bg-muted))] px-2.5 py-2">
            <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-tertiary))]"><AlertTriangle className="size-3" />需关注</div>
            <div className="mt-1 text-sm font-semibold tabular-nums text-[hsl(var(--text-primary))]">{view.attention.length}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] text-[hsl(var(--text-tertiary))]">验收进度</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--bg-muted))]">
          <div className="h-full rounded-full bg-[hsl(var(--accent))] transition-[width]" style={{ width: `${acceptanceProgress}%` }} />
        </div>
        <span className="text-[10px] tabular-nums text-[hsl(var(--text-tertiary))]">{acceptanceProgress}%</span>
      </div>
      {view.work.terminalProjectionConflict ? (
        <div className="mt-2 text-[10px] text-[hsl(var(--status-pending))]">
          交付和验收已完成；任务明细仍有未完成项，需核对。
        </div>
      ) : (
        <div className="mt-2 truncate text-[10px] text-[hsl(var(--text-tertiary))]">
          当前工作：{currentWork ? currentWork.title : view.work.total > 0 ? '等待下一项工作开始' : '尚未拆分任务'}
        </div>
      )}
    </section>
  );
}
