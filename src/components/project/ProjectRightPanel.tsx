'use client';

import { useMemo, useState } from 'react';
import { useTaskHubStore, type Task } from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { useTeamPackStore } from '@/store/teamPackStore';
import { MiniKanban } from './MiniKanban';
import { ProjectObservabilityPanel } from './ProjectObservabilityPanel';
import { TaskGraphMap, type TaskGraphMapView } from '@/components/task-hub/TaskGraphMap';
import { useTaskGraph } from '@/components/task-hub/useTaskGraph';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { cn } from '@/lib/utils';
import { AlertTriangle, Briefcase, Layout, PanelRightClose, PanelRightOpen, Sparkles, CheckCircle } from 'lucide-react';

type NextItem = {
  label: string;
  taskId?: string;
};

function buildNextItems(tasks: Task[]): NextItem[] {
  const items: NextItem[] = [];
  for (const task of tasks) {
    if (task.status === 'blocked') items.push({ label: `解除阻塞：${task.id} ${task.title}`, taskId: task.id });
    if (task.status === 'in_review') items.push({ label: `等待评审：${task.id} ${task.title}`, taskId: task.id });
    if (task.status === 'proposed') items.push({ label: `待确认：${task.id} ${task.title}`, taskId: task.id });
    if (task.status === 'ready') items.push({ label: `可开始：${task.id} ${task.title}`, taskId: task.id });
  }
  return items.slice(0, 6);
}

function SyncStatusBar() {
  const { syncError, lastSyncAt, selectedConvId, clearError } = useTaskHubStore(useShallow((s) => ({
    syncError: s.taskSyncError,
    lastSyncAt: s.lastTaskSyncAt,
    selectedConvId: s.selectedConversationId,
    clearError: s.clearTaskSyncError,
  })));

  if (syncError && syncError.conversationId === selectedConvId) {
    return (
      <div className="rounded-md border border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))] px-2 py-1.5 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--status-rejected))] shrink-0" />
        <span className="text-xs text-[hsl(var(--status-rejected))] flex-1 line-clamp-1">{syncError.message}</span>
        <button onClick={clearError} className="text-xs text-[hsl(var(--text-tertiary))] hover:underline shrink-0">关闭</button>
      </div>
    );
  }

  if (!lastSyncAt) return null;

  const seconds = Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 1000);
  const ago = seconds < 60 ? '刚刚同步' : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟前` : `${Math.floor(seconds / 3600)} 小时前`;
  return <div className="text-[10px] text-[hsl(var(--text-tertiary))]">{ago}</div>;
}

export function ProjectRightPanel({ teamPackId }: { teamPackId: string }) {
  const { selectedConversationId, currentTeamPack, tasks, blockers, setSelectedTaskId } = useTaskHubStore(useShallow((s) => ({
    selectedConversationId: s.selectedConversationId,
    currentTeamPack: s.currentTeamPack,
    tasks: s.tasks,
    blockers: s.getOpenBlockersForSelectedConversation(),
    setSelectedTaskId: s.setSelectedTaskId,
  })));
  const selectedConversation = useTaskHubStore((s) => s.conversations.find((c) => c.id === s.selectedConversationId));

  const teamPacks = useTeamPackStore((s) => s.teamPacks);
  const fallbackTeamPack = teamPacks.find((pack) => pack.id === teamPackId && teamPackId);
  const teamPack = currentTeamPack?.id === teamPackId ? currentTeamPack : fallbackTeamPack;

  const [open, setOpen] = useState(() => {
    const scopedTasks = tasks.filter((task) => task.conversationId === selectedConversationId);
    const scopedBlockers = blockers.filter((blocker) => blocker.conversationId === selectedConversationId);
    return scopedTasks.length > 0 || scopedBlockers.length > 0;
  });
  const [activeTab, setActiveTab] = useState<'board' | 'map' | 'tasks' | 'risks' | 'debug'>('board');
  const { graph: remoteGraph, isLoading: graphLoading, error: graphError } = useTaskGraph(selectedConversationId);

  const scopedTasks = useMemo(
    () => tasks.filter((task) => task.conversationId === selectedConversationId),
    [tasks, selectedConversationId],
  );
  const nextItems = useMemo(() => buildNextItems(scopedTasks), [scopedTasks]);
  const openBlockers = useMemo(
    () => blockers.filter((blocker) => blocker.conversationId === selectedConversationId),
    [blockers, selectedConversationId],
  );
  const localGraph = useMemo<TaskGraphMapView>(() => ({
    conversationId: selectedConversationId ?? '',
    tasks: scopedTasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      agent_id: task.agentId,
    })),
    edges: scopedTasks.flatMap((task) => task.dependencies.map((dependencyId) => ({
      id: `${task.id}-depends-${dependencyId}`,
      from_task_id: task.id,
      to_task_id: dependencyId,
      type: 'depends_on',
    }))),
    artifacts: scopedTasks.flatMap((task) => task.artifacts.map((artifact, index) => ({
      id: `${task.id}-artifact-${index}`,
      task_id: task.id,
      kind: artifact.type,
      label: artifact.label,
    }))),
  }), [scopedTasks, selectedConversationId]);
  const graphView = useMemo<TaskGraphMapView>(() => {
    if (!remoteGraph || (remoteGraph.tasks.length === 0 && localGraph.tasks.length > 0)) return localGraph;
    return {
      conversationId: remoteGraph.conversationId,
      tasks: remoteGraph.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        agent_id: task.agent_id,
      })),
      edges: remoteGraph.edges.map((edge) => ({
        id: edge.id,
        from_task_id: edge.from_task_id,
        to_task_id: edge.to_task_id,
        type: edge.type,
      })),
      artifacts: remoteGraph.artifacts.map((artifact) => ({
        id: artifact.id,
        task_id: artifact.task_id,
        kind: artifact.kind,
        label: artifact.label,
      })),
    };
  }, [localGraph, remoteGraph]);

  const tabs = [
    { value: 'board', label: '看板', count: scopedTasks.length },
    { value: 'map', label: '地图', count: scopedTasks.length },
    { value: 'tasks', label: '待办', count: nextItems.length },
    { value: 'risks', label: '风险', count: openBlockers.length },
    { value: 'debug', label: '调试' },
  ];

  const handleTabChange = (v: string) => {
    setActiveTab(v as 'board' | 'map' | 'tasks' | 'risks' | 'debug');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'shrink-0 h-full flex items-center justify-center',
          'w-6 border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-app))]',
          'hover:bg-[hsl(var(--bg-muted))] transition-colors',
          'text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))]',
        )}
        title={open ? '收起面板' : '展开面板'}
      >
        {open ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
      </button>

      {open && (
        <aside className={cn(
          'shrink-0 h-full border-l border-[hsl(var(--border))]',
          'bg-[hsl(var(--bg-muted))] flex flex-col',
          // 信息密度自适应：调试 tab（调用链/甘特/payload 密度高）加宽到 560px，其余 440px
          activeTab === 'debug'
            ? 'w-full md:w-[460px] lg:w-[560px]'
            : 'w-full md:w-[360px] lg:w-[440px]',
          'animate-slide-in-r',
        )}>
          {/* Tab Header - Team Info (始终显示) */}
          <div className="shrink-0 px-4 py-3 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))]">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-[hsl(var(--text-tertiary))]">
                  Project Board
                </div>
                <div className="text-sm font-semibold text-[hsl(var(--text-primary))] truncate mt-0.5">
                  {selectedConversation?.title ?? '项目侧栏'}
                </div>
              </div>
              <SyncStatusBar />
            </div>
          </div>

          {/* Tab Content */}
          <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 min-h-0 flex flex-col">
            <TabsList className="shrink-0 px-4 py-2 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} count={tab.count}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Board Tab */}
            <TabsContent value="board" className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
              {/* Team Info */}
              {teamPack && (
                <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] shadow-sm p-3 mb-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] flex items-center justify-center shrink-0">
                      {teamPack.teamMode === 'pipeline' && <Briefcase className="w-4 h-4 text-[hsl(var(--accent))]" />}
                      {teamPack.teamMode === 'parallel' && <Layout className="w-4 h-4 text-[hsl(var(--accent))]" />}
                      {teamPack.teamMode === 'hub_spoke' && <Sparkles className="w-4 h-4 text-[hsl(var(--accent))]" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm text-[hsl(var(--text-primary))] truncate">{teamPack.displayName}</div>
                        <span className="shrink-0 rounded-full bg-[hsl(var(--accent-soft))] px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--accent))]">
                          当前团队
                        </span>
                      </div>
                      <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1 line-clamp-2">
                        {teamPack.description || '这支团队负责当前项目的任务协作。'}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {teamPack.roles.slice(0, 6).map((role) => (
                          <span
                            key={role.id}
                            className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] px-2 py-1 text-[10px] font-medium text-[hsl(var(--text-secondary))]"
                            title={role.description ?? role.displayName}
                          >
                            <span className="size-1.5 rounded-full bg-[hsl(var(--accent))]" />
                            {role.displayName}
                          </span>
                        ))}
                        {teamPack.roles.length > 6 && (
                          <span className="rounded-full px-2 py-1 text-[10px] text-[hsl(var(--text-tertiary))]">
                            +{teamPack.roles.length - 6}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* MiniKanban */}
              <MiniKanban expanded={true} />
            </TabsContent>

            {/* Map Tab */}
            <TabsContent value="map" className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
              {graphError && (
                <div className="mb-2 rounded-md border border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))] px-2 py-1.5 text-xs text-[hsl(var(--status-rejected))]">
                  {graphError}，已显示本地任务视图。
                </div>
              )}
              {graphLoading && (
                <div className="mb-2 text-[10px] text-[hsl(var(--text-tertiary))]">正在刷新任务地图…</div>
              )}
              <TaskGraphMap graph={graphView} onSelectTask={setSelectedTaskId} />
            </TabsContent>

            {/* Tasks Tab */}
            <TabsContent value="tasks" className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
              <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] shadow-sm overflow-hidden">
                <div className="px-3 py-2 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between">
                  <div className="text-[11px] font-bold tracking-[0.16em] uppercase text-[hsl(var(--text-tertiary))]">下一步</div>
                  <span className="text-[10px] tabular-nums text-[hsl(var(--text-tertiary))]">{nextItems.length}</span>
                </div>
                <div className="p-2 flex flex-col gap-1.5">
                  {nextItems.length === 0 ? (
                    <div className="text-xs text-[hsl(var(--text-tertiary))] p-4 text-center">
                      暂无待办事项
                    </div>
                  ) : (
                    nextItems.map((item, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => item.taskId && setSelectedTaskId(item.taskId)}
                        className="text-left rounded-md border px-3 py-2 transition-colors bg-[hsl(var(--bg-app))] hover:bg-[hsl(var(--bg-card-hover))] border-[hsl(var(--border-subtle))]"
                      >
                        <div className="text-xs text-[hsl(var(--text-secondary))] line-clamp-2">{item.label}</div>
                      </button>
                    ))
                  )}
                </div>
              </section>
            </TabsContent>

            {/* Risks Tab */}
            <TabsContent value="risks" className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
              {openBlockers.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle className="w-12 h-12 mx-auto text-[hsl(var(--status-done))] mb-3" />
                  <div className="text-sm font-semibold text-[hsl(var(--text-primary))]">暂无风险</div>
                  <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">所有任务进展顺利</div>
                </div>
              ) : (
                <section className="rounded-xl border border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))] shadow-sm overflow-hidden">
                  <div className="px-3 py-2 border-b border-[hsl(var(--status-rejected-border))] flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--status-rejected))]" />
                    <div className="text-[11px] font-bold tracking-[0.16em] uppercase text-[hsl(var(--status-rejected))]">
                      风险 / 阻塞
                    </div>
                  </div>
                  <div className="p-2 space-y-1.5">
                    {openBlockers.map((blocker) => (
                      <button
                        key={blocker.id}
                        type="button"
                        onClick={() => setSelectedTaskId(blocker.taskId)}
                        className="w-full text-left rounded-md border px-3 py-2 transition-colors bg-[hsl(var(--bg-app))] hover:bg-[hsl(var(--bg-card-hover))] border-[hsl(var(--status-rejected-border))]"
                      >
                        <div className="text-xs text-[hsl(var(--text-primary))]">
                          {blocker.taskId} · {blocker.reasonSummary}
                        </div>
                        {blocker.evidenceRef && (
                          <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">{blocker.evidenceRef}</div>
                        )}
                      </button>
                    ))}
                    {openBlockers.length > 6 && (
                      <div className="text-center text-[10px] text-[hsl(var(--text-tertiary))] py-1">
                        还有 {openBlockers.length - 6} 条未显示
                      </div>
                    )}
                  </div>
                </section>
              )}
            </TabsContent>

            <TabsContent value="debug" className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
              <ProjectObservabilityPanel conversationId={selectedConversationId ?? undefined} />
            </TabsContent>
          </Tabs>
        </aside>
      )}
    </>
  );
}
