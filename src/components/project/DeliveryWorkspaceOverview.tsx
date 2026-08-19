import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileCheck2,
  Flag,
  FolderOpen,
} from 'lucide-react';
import type { DeliveryWorkspaceView } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

const VERIFICATION_METHOD_LABEL: Record<
  NonNullable<DeliveryWorkspaceView['acceptance']['verification']>['method'],
  string
> = {
  web_ui_e2e: '浏览器端到端验证',
  automated_test: '自动化测试',
  manual_review: '人工评审',
};

const EVIDENCE_STATUS = {
  passed: { label: '已验证', className: 'text-[hsl(var(--status-done))]' },
  failed: { label: '未通过', className: 'text-[hsl(var(--status-rejected))]' },
  pending: { label: '待验证', className: 'text-[hsl(var(--text-tertiary))]' },
} as const;

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
      {view.acceptance.total > 0 && (
        <details className="group mt-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs text-[hsl(var(--text-secondary))] marker:content-none">
            <span className="flex items-center gap-1.5 font-medium text-[hsl(var(--text-primary))]">
              <FileCheck2 className="size-3.5 text-[hsl(var(--accent))]" />
              验收证据
            </span>
            <span className="text-[10px] tabular-nums text-[hsl(var(--text-tertiary))]">
              {view.acceptance.passed}/{view.acceptance.total} 条已验证 · 展开查看
            </span>
          </summary>

          <div className="border-t border-[hsl(var(--border))] px-3 py-3">
            <p className="text-[10px] leading-4 text-[hsl(var(--text-tertiary))]">
              这里只计算正式验收记录；Agent 在聊天中的口头说明不计入结果。
            </p>
            <ol className="mt-2 space-y-2">
              {view.acceptance.evidence.map((item, index) => {
                const status = EVIDENCE_STATUS[item.status];
                return (
                  <li key={`${index}:${item.criterion}`} className="rounded-md bg-[hsl(var(--bg-card))] px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs leading-5 text-[hsl(var(--text-primary))]">{item.criterion}</span>
                      <span className={`shrink-0 text-[10px] font-medium ${status.className}`}>{status.label}</span>
                    </div>
                    {item.evidenceRefs.length > 0 ? (
                      <ul className="mt-1.5 space-y-1">
                        {item.evidenceRefs.map((evidenceRef, evidenceIndex) => (
                          <li key={`${evidenceIndex}:${evidenceRef}`} className="break-all font-mono text-[10px] leading-4 text-[hsl(var(--text-secondary))]">
                            {evidenceRef}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[10px] text-[hsl(var(--text-tertiary))]">尚未形成正式证据。</p>
                    )}
                  </li>
                );
              })}
            </ol>

            {view.acceptance.verification && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[hsl(var(--border))] pt-3 text-[10px]">
                <div>
                  <dt className="text-[hsl(var(--text-tertiary))]">验证方式</dt>
                  <dd className="mt-0.5 text-[hsl(var(--text-secondary))]">
                    {VERIFICATION_METHOD_LABEL[view.acceptance.verification.method]}
                  </dd>
                </div>
                <div>
                  <dt className="text-[hsl(var(--text-tertiary))]">验证人</dt>
                  <dd className="mt-0.5 break-all text-[hsl(var(--text-secondary))]">
                    {view.acceptance.verification.verifierAgentId}
                  </dd>
                </div>
                <div>
                  <dt className="text-[hsl(var(--text-tertiary))]">验证工具</dt>
                  <dd className="mt-0.5 break-all text-[hsl(var(--text-secondary))]">
                    {view.acceptance.verification.tool}
                  </dd>
                </div>
                <div>
                  <dt className="text-[hsl(var(--text-tertiary))]">完成时间</dt>
                  <dd className="mt-0.5 text-[hsl(var(--text-secondary))]">
                    {new Date(view.acceptance.verification.completedAt).toLocaleString('zh-CN')}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[hsl(var(--text-tertiary))]">验证报告</dt>
                  <dd className="mt-0.5 break-all font-mono text-[hsl(var(--text-secondary))]">
                    {view.acceptance.verification.reportRef}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[hsl(var(--text-tertiary))]">验收依据</dt>
                  <dd className="mt-0.5 space-y-0.5 break-all font-mono text-[hsl(var(--text-secondary))]">
                    {view.acceptance.verification.specRefs.length > 0
                      ? view.acceptance.verification.specRefs.map((specRef, specIndex) => (
                        <div key={`${specIndex}:${specRef}`}>{specRef}</div>
                      ))
                      : '未记录'}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[hsl(var(--text-tertiary))]">代码版本</dt>
                  <dd className="mt-0.5 break-all font-mono text-[hsl(var(--text-secondary))]">
                    {view.acceptance.verification.codeRevision ?? '未记录'}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </details>
      )}
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
