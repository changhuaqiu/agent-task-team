'use client';

import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  FolderKanban,
  PackageCheck,
  PlayCircle,
  Target,
} from 'lucide-react';
import type {
  DeliveryNavigationItem,
  ProjectNavigationGroup,
} from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

const DELIVERY_STATUS_LABEL: Record<DeliveryNavigationItem['status'], string> = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

function projectStats(project: ProjectNavigationGroup) {
  return project.deliveries.reduce((stats, delivery) => ({
    totalTasks: stats.totalTasks + delivery.work.total,
    doneTasks: stats.doneTasks + delivery.work.done,
    openBlockers: stats.openBlockers + delivery.openBlockerCount,
    resumableDeliveries: stats.resumableDeliveries + (
      delivery.status === 'active' || delivery.status === 'paused' ? 1 : 0
    ),
  }), { totalTasks: 0, doneTasks: 0, openBlockers: 0, resumableDeliveries: 0 });
}

function DeliveryRow({
  delivery,
  onOpenDelivery,
}: {
  delivery: DeliveryNavigationItem;
  onOpenDelivery: (deliveryId: string) => void;
}) {
  const completion = delivery.work.total > 0
    ? Math.round((delivery.work.done / delivery.work.total) * 100)
    : 0;

  return (
    <button
      type="button"
      onClick={() => onOpenDelivery(delivery.id)}
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--bg-card-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--accent))]"
      aria-label={`打开交付：${delivery.projectName} / ${delivery.title}`}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] group-hover:text-[hsl(var(--accent))]">
        {delivery.autonomous ? <Bot className="size-4" /> : <PlayCircle className="size-4" />}
      </div>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-[hsl(var(--text-primary))]">{delivery.title}</span>
          <span className="shrink-0 rounded-full bg-[hsl(var(--bg-muted))] px-2 py-0.5 text-[10px] text-[hsl(var(--text-tertiary))]">
            {DELIVERY_STATUS_LABEL[delivery.status]}
          </span>
        </span>
        <span className="mt-1 block truncate text-[11px] text-[hsl(var(--text-tertiary))]">
          {delivery.projectName} · {delivery.goal || '尚未填写交付目标'}
        </span>
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[hsl(var(--bg-muted))]">
          <span className="block h-full rounded-full bg-[hsl(var(--accent))]" style={{ width: `${completion}%` }} />
        </span>
      </span>
      <span className="shrink-0 text-right text-[10px] tabular-nums text-[hsl(var(--text-tertiary))]">
        <span className="block">任务 {delivery.work.done}/{delivery.work.total}</span>
        {delivery.openBlockerCount > 0 && (
          <span className="mt-1 block text-[hsl(var(--status-blocked))]">{delivery.openBlockerCount} 个阻塞</span>
        )}
      </span>
    </button>
  );
}

export function ProjectsOverview({
  navigation,
  onOpenDelivery,
}: {
  navigation: ProjectNavigationGroup[];
  onOpenDelivery: (deliveryId: string) => void;
}) {
  const deliveries = navigation.flatMap((project) => project.deliveries);
  const resumableDeliveries = deliveries
    .filter((delivery) => delivery.status === 'active' || delivery.status === 'paused')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const totalTasks = deliveries.reduce((count, delivery) => count + delivery.work.total, 0);
  const doneTasks = deliveries.reduce((count, delivery) => count + delivery.work.done, 0);
  const openBlockerCount = deliveries.reduce((count, delivery) => count + delivery.openBlockerCount, 0);

  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))]"
      data-testid="projects-overview"
      aria-labelledby="projects-overview-title"
    >
      <div className="mx-auto max-w-7xl px-6 py-6 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[hsl(var(--text-tertiary))]">
              <PackageCheck className="size-4" />
              <span className="text-xs font-medium">交付总览</span>
            </div>
            <h2 id="projects-overview-title" className="mt-2 text-xl font-semibold tracking-tight text-[hsl(var(--text-primary))]">所有项目的工作现场</h2>
            <p className="mt-1 text-sm text-[hsl(var(--text-secondary))]">项目保留长期上下文，交付把目标、Agent 工作和验收结果收口在一起。</p>
          </div>
          {deliveries.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-[hsl(var(--text-tertiary))]">
              <Clock3 className="size-3.5" />
              最近更新的交付排在前面
            </div>
          )}
        </header>

        {navigation.length > 0 ? (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: '项目', value: navigation.length, icon: FolderKanban },
                { label: '可继续交付', value: resumableDeliveries.length, icon: PlayCircle },
                { label: '任务完成', value: `${doneTasks}/${totalTasks}`, icon: CheckCircle2 },
                { label: '开放阻塞', value: openBlockerCount, icon: AlertCircle, warn: openBlockerCount > 0 },
              ].map(({ label, value, icon: Icon, warn }) => (
                <div key={label} aria-label={`${label}：${value}`} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-4 py-3.5">
                  <div className="flex items-center gap-2 text-xs text-[hsl(var(--text-tertiary))]">
                    <Icon className={warn ? 'size-3.5 text-[hsl(var(--status-blocked))]' : 'size-3.5'} />
                    {label}
                  </div>
                  <div className="mt-2 text-xl font-semibold tabular-nums text-[hsl(var(--text-primary))]">{value}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
              <section className="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]" aria-labelledby="continue-work-title">
                <div className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] px-4 py-3.5">
                  <div>
                    <h3 id="continue-work-title" className="text-sm font-medium text-[hsl(var(--text-primary))]">继续工作</h3>
                    <p className="mt-0.5 text-xs text-[hsl(var(--text-tertiary))]">最近更新的可继续交付</p>
                  </div>
                  <span className="text-xs tabular-nums text-[hsl(var(--text-tertiary))]">{resumableDeliveries.length}</span>
                </div>
                <div className="divide-y divide-[hsl(var(--border-subtle))]">
                  {resumableDeliveries.length > 0 ? resumableDeliveries.slice(0, 6).map((delivery) => (
                    <DeliveryRow key={delivery.id} delivery={delivery} onOpenDelivery={onOpenDelivery} />
                  )) : (
                    <div className="px-4 py-10 text-center text-sm text-[hsl(var(--text-tertiary))]">当前没有可继续的交付</div>
                  )}
                </div>
              </section>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <div>
                    <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">项目</h3>
                    <p className="mt-0.5 text-xs text-[hsl(var(--text-tertiary))]">按目录组织的长期工作上下文</p>
                  </div>
                  <span className="text-xs tabular-nums text-[hsl(var(--text-tertiary))]">{navigation.length}</span>
                </div>
                {navigation.map((project) => {
                  const stats = projectStats(project);
                  const completion = stats.totalTasks > 0
                    ? Math.round((stats.doneTasks / stats.totalTasks) * 100)
                    : 0;
                  return (
                    <section
                      key={project.key}
                      className="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"
                      aria-label={`项目：${project.name}`}
                    >
                      <div className="px-4 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <FolderKanban className="size-4 shrink-0 text-[hsl(var(--text-tertiary))]" />
                              <h4 className="truncate text-sm font-medium text-[hsl(var(--text-primary))]">{project.name}</h4>
                            </div>
                            <p className="mt-1 truncate pl-6 text-[11px] text-[hsl(var(--text-tertiary))]" title={project.fullPath ?? undefined}>
                              {project.fullPath ?? '未指定目录'}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-md bg-[hsl(var(--bg-muted))] px-2 py-1 text-[10px] text-[hsl(var(--text-secondary))]">
                            {stats.resumableDeliveries} 可继续 / {project.deliveries.length} 交付
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[11px] text-[hsl(var(--text-secondary))]">
                          <span>任务 {stats.doneTasks}/{stats.totalTasks}</span>
                          {stats.openBlockers > 0 ? (
                            <span className="text-[hsl(var(--status-blocked))]">{stats.openBlockers} 个开放阻塞</span>
                          ) : (
                            <span className="text-[hsl(var(--text-tertiary))]">进度 {completion}%</span>
                          )}
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[hsl(var(--bg-muted))]">
                          <div className="h-full rounded-full bg-[hsl(var(--accent))]" style={{ width: `${completion}%` }} />
                        </div>
                      </div>
                      <div className="border-t border-[hsl(var(--border-subtle))]">
                        {project.deliveries.slice(0, 3).map((delivery) => (
                          <button
                            key={delivery.id}
                            type="button"
                            onClick={() => onOpenDelivery(delivery.id)}
                            className="flex w-full items-center gap-2 border-b border-[hsl(var(--border-subtle))] px-4 py-2.5 text-left last:border-b-0 hover:bg-[hsl(var(--bg-card-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--accent))]"
                          >
                            <CircleDot className="size-3.5 shrink-0 text-[hsl(var(--text-tertiary))]" />
                            <span className="min-w-0 flex-1 truncate text-xs text-[hsl(var(--text-primary))]">{delivery.title}</span>
                            <span className="shrink-0 text-[10px] text-[hsl(var(--text-tertiary))]">{DELIVERY_STATUS_LABEL[delivery.status]}</span>
                          </button>
                        ))}
                        {project.deliveries.length > 3 && (
                          <div className="px-4 py-2 text-center text-[10px] text-[hsl(var(--text-tertiary))]">另有 {project.deliveries.length - 3} 个交付，可在左侧展开</div>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="mt-10 overflow-hidden rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]">
            <div className="px-6 py-10 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))]">
                <PackageCheck className="size-5" />
              </div>
              <h3 className="mt-4 text-base font-medium text-[hsl(var(--text-primary))]">从第一个交付开始建立项目工作区</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[hsl(var(--text-secondary))]">使用右上角“新建交付”选择项目目录。之后目标、Agent 工作、任务进度和验收证据会回到同一个项目上下文。</p>
            </div>
            <div className="grid border-t border-[hsl(var(--border-subtle))] md:grid-cols-3 md:divide-x md:divide-[hsl(var(--border-subtle))]">
              {[
                { icon: FolderKanban, title: 'Project', detail: '保存目录、代码与长期工作上下文' },
                { icon: Target, title: 'Delivery', detail: '明确一次目标、范围、授权与验收标准' },
                { icon: Bot, title: 'Agent 协作', detail: '把任务、活动、阻塞和证据统一留痕' },
              ].map(({ icon: Icon, title, detail }) => (
                <div key={title} className="flex items-start gap-3 px-5 py-4">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))]">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[hsl(var(--text-primary))]">{title}</div>
                    <div className="mt-1 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">{detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
