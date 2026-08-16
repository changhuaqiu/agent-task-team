'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Network, PanelRightClose, PanelRightOpen, Rows3 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTaskHubStore } from '@/store/taskHubStore';
import { projectDeliveryWorkspace } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';
import { TaskGraphMap, type TaskGraphMapView } from '@/components/task-hub/TaskGraphMap';
import { useTaskGraph } from '@/components/task-hub/useTaskGraph';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { cn } from '@/lib/utils';
import { DeliveryAttentionSection } from './DeliveryAttentionSection';
import { MiniKanban } from './MiniKanban';
import { ProjectObservabilityPanel } from './ProjectObservabilityPanel';
import type { DeliveryRunSnapshot } from '@/server/autonomous-delivery/types';

function SyncStatusBar() {
  const { syncError, lastSyncAt, selectedDeliveryId, clearError } = useTaskHubStore(useShallow((state) => ({
    syncError: state.taskSyncError,
    lastSyncAt: state.lastTaskSyncAt,
    selectedDeliveryId: state.selectedConversationId,
    clearError: state.clearTaskSyncError,
  })));

  if (syncError && syncError.conversationId === selectedDeliveryId) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))] px-2 py-1.5">
        <AlertTriangle className="size-3.5 shrink-0 text-[hsl(var(--status-rejected))]" />
        <span className="line-clamp-1 flex-1 text-xs text-[hsl(var(--status-rejected))]">{syncError.message}</span>
        <button type="button" onClick={clearError} className="shrink-0 text-xs text-[hsl(var(--text-tertiary))] hover:underline">关闭</button>
      </div>
    );
  }

  if (!lastSyncAt) return null;
  const time = new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <div className="text-[10px] text-[hsl(var(--text-tertiary))]">最近同步 {time}</div>;
}

export function ProjectRightPanel({ deliveryRunSnapshot }: { deliveryRunSnapshot?: DeliveryRunSnapshot } = {}) {
  const {
    selectedDeliveryId,
    conversations,
    tasks,
    blockersByConversation,
    chatMessagesByConversation,
    setSelectedTaskId,
  } = useTaskHubStore(useShallow((state) => ({
    selectedDeliveryId: state.selectedConversationId,
    conversations: state.conversations,
    tasks: state.tasks,
    blockersByConversation: state.blockersByConversation,
    chatMessagesByConversation: state.chatMessagesByConversation,
    setSelectedTaskId: state.setSelectedTaskId,
  })));

  const delivery = useMemo(() => projectDeliveryWorkspace({
    conversations,
    tasks,
    deliveryRunSnapshot,
    blockersByConversation,
    chatMessagesByConversation,
  }, selectedDeliveryId), [
    blockersByConversation,
    chatMessagesByConversation,
    conversations,
    deliveryRunSnapshot,
    selectedDeliveryId,
    tasks,
  ]);

  const [open, setOpen] = useState(() => (delivery?.work.total ?? 0) > 0 || (delivery?.attention.length ?? 0) > 0);
  const [activeTab, setActiveTab] = useState<'tasks' | 'debug'>('tasks');
  const [taskView, setTaskView] = useState<'board' | 'map'>('board');
  const { graph: remoteGraph, isLoading: graphLoading, error: graphError } = useTaskGraph(selectedDeliveryId);

  const localGraph = useMemo<TaskGraphMapView>(() => ({
    conversationId: selectedDeliveryId ?? '',
    tasks: (delivery?.work.tasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      agent_id: task.agentId,
    })),
    edges: (delivery?.work.tasks ?? []).flatMap((task) => task.dependencies.map((dependencyId) => ({
      id: `${task.id}-depends-${dependencyId}`,
      from_task_id: task.id,
      to_task_id: dependencyId,
      type: 'depends_on',
    }))),
    artifacts: (delivery?.work.tasks ?? []).flatMap((task) => task.artifacts.map((artifact, index) => ({
      id: `${task.id}-artifact-${index}`,
      task_id: task.id,
      kind: artifact.type,
      label: artifact.label,
    }))),
  }), [delivery?.work.tasks, selectedDeliveryId]);

  const graphView = useMemo<TaskGraphMapView>(() => {
    if (
      !remoteGraph
      || remoteGraph.conversationId !== selectedDeliveryId
      || (remoteGraph.tasks.length === 0 && localGraph.tasks.length > 0)
    ) return localGraph;
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
  }, [localGraph, remoteGraph, selectedDeliveryId]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-full w-6 shrink-0 items-center justify-center border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-app))]',
          'text-[hsl(var(--text-tertiary))] transition-colors hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-primary))]',
        )}
        title={open ? '收起工作面板' : '展开工作面板'}
      >
        {open ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
      </button>

      {open && (
        <aside className={cn(
          'flex h-full shrink-0 flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] animate-slide-in-r',
          activeTab === 'debug' ? 'w-full md:w-[460px] lg:w-[560px]' : 'w-full md:w-[360px] lg:w-[440px]',
        )}>
          <div className="shrink-0 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-[hsl(var(--text-tertiary))]">工作面板</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-[hsl(var(--text-primary))]">
                  {delivery?.delivery.title ?? '选择一个交付'}
                </div>
              </div>
              <SyncStatusBar />
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'tasks' | 'debug')} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-4 py-2">
              <TabsTrigger value="tasks" count={delivery?.work.total ?? 0}>任务</TabsTrigger>
              <TabsTrigger value="debug">调试</TabsTrigger>
            </TabsList>

            <TabsContent value="tasks" className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
              <div className="space-y-3">
                <DeliveryAttentionSection items={delivery?.attention ?? []} onSelectTask={setSelectedTaskId} />

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-[hsl(var(--text-primary))]">全部任务</h3>
                    <p className="mt-0.5 text-[10px] text-[hsl(var(--text-tertiary))]">同一批工作项的不同查看方式</p>
                  </div>
                  <div className="flex rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-0.5">
                    <button type="button" aria-pressed={taskView === 'board'} onClick={() => setTaskView('board')}
                      className={cn('inline-flex min-h-8 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors',
                        taskView === 'board' ? 'bg-[hsl(var(--accent))] text-white' : 'text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]')}>
                      <Rows3 className="size-3.5" />任务视图
                    </button>
                    <button type="button" aria-pressed={taskView === 'map'} onClick={() => setTaskView('map')}
                      className={cn('inline-flex min-h-8 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors',
                        taskView === 'map' ? 'bg-[hsl(var(--accent))] text-white' : 'text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]')}>
                      <Network className="size-3.5" />关系图
                    </button>
                  </div>
                </div>

                {taskView === 'board' ? (
                  <MiniKanban expanded />
                ) : (
                  <div>
                    {graphError && (
                      <div className="mb-2 rounded-md border border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))] px-2 py-1.5 text-xs text-[hsl(var(--status-rejected))]">
                        {graphError}，已显示本地任务关系。
                      </div>
                    )}
                    {graphLoading && <div className="mb-2 text-[10px] text-[hsl(var(--text-tertiary))]">正在刷新任务关系…</div>}
                    <TaskGraphMap graph={graphView} onSelectTask={setSelectedTaskId} />
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="debug" className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
              <ProjectObservabilityPanel conversationId={selectedDeliveryId ?? undefined} />
            </TabsContent>
          </Tabs>
        </aside>
      )}
    </>
  );
}
