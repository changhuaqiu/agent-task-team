'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FlaskConical, LayoutDashboard, MessagesSquare } from 'lucide-react';
import { ProjectSidebar, type WorkspaceSurface } from './ProjectSidebar';
import { ProjectChatPanel } from './ProjectChatPanel';
import { ProjectRightPanel } from './ProjectRightPanel';
import { ProjectsOverview } from './ProjectsOverview';
import { AgentObservabilityDrawerHost } from './AgentObservabilityDrawerHost';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import type { DeliveryRunSnapshot } from '@/server/autonomous-delivery/types';
import { projectDeliveryNavigation, projectDeliveryWorkspace } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

const ProjectEvaluationWorkspace = dynamic(() => import('./ProjectEvaluationWorkspace').then((mod) => mod.ProjectEvaluationWorkspace));

export function ProjectWorkspace() {
  const {
    selectedDeliveryId,
    setSelectedDeliveryId,
    conversations,
    tasks,
    blockersByConversation,
    chatMessagesByConversation,
  } = useTaskHubStore(useShallow((state) => ({
    selectedDeliveryId: state.selectedConversationId,
    setSelectedDeliveryId: state.setSelectedConversationId,
    conversations: state.conversations,
    tasks: state.tasks,
    blockersByConversation: state.blockersByConversation,
    chatMessagesByConversation: state.chatMessagesByConversation,
  })));
  const selectedConversation = conversations.find((item) => item.id === selectedDeliveryId);
  const [surface, setSurface] = useState<WorkspaceSurface>('overview');
  const previousSelectedDeliveryId = useRef(selectedDeliveryId);
  const [mode, setMode] = useState<'overview' | 'activity' | 'evaluation'>('overview');
  const [deliveryRunState, setDeliveryRunState] = useState<{
    deliveryId: string;
    snapshot: DeliveryRunSnapshot;
  }>();
  const deliveryRunSnapshot = deliveryRunState && deliveryRunState.deliveryId === selectedConversation?.id
    ? deliveryRunState.snapshot
    : undefined;
  const handleDeliveryRunSnapshotChange = useCallback((snapshot: DeliveryRunSnapshot | undefined) => {
    const deliveryId = selectedConversation?.id;
    if (!deliveryId || !snapshot) return;
    setDeliveryRunState({ deliveryId, snapshot });
  }, [selectedConversation?.id]);
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
  const navigation = useMemo(() => projectDeliveryNavigation({
    conversations,
    tasks,
    blockersByConversation,
  }), [blockersByConversation, conversations, tasks]);
  const activeProject = navigation.find((project) => (
    project.deliveries.some((item) => item.id === selectedDeliveryId)
  )) ?? null;

  useEffect(() => {
    if (previousSelectedDeliveryId.current === selectedDeliveryId) return;
    previousSelectedDeliveryId.current = selectedDeliveryId;
    setMode('overview');
    setSurface(selectedDeliveryId ? 'delivery' : 'overview');
  }, [selectedDeliveryId]);

  function handleSelectDelivery(deliveryId: string) {
    setSelectedDeliveryId(deliveryId);
    setMode('overview');
    setSurface('delivery');
  }

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <ProjectSidebar
        navigation={navigation}
        activeSurface={surface}
        selectedDeliveryId={selectedDeliveryId}
        onOpenOverview={() => setSurface('overview')}
        onSelectDelivery={handleSelectDelivery}
      />
      <div className="min-w-0 flex-1 flex flex-col">
        {surface === 'overview' ? (
          <ProjectsOverview navigation={navigation} onOpenDelivery={handleSelectDelivery} />
        ) : (
          <>
            {selectedConversation && (
              <div className="shrink-0 h-12 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-4 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="truncate text-xs text-[hsl(var(--text-tertiary))]">{activeProject?.name ?? '未分类项目'}</div>
                  <div className="mt-0.5 truncate text-sm font-medium text-[hsl(var(--text-primary))]">{selectedConversation.title}</div>
                </div>
                <div className="flex rounded-lg bg-[hsl(var(--bg-muted))] p-0.5 text-xs">
                  <button type="button" onClick={() => setMode('overview')} className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors',
                    mode === 'overview' && 'bg-[hsl(var(--bg-card))] font-medium shadow-sm',
                  )}>
                    <LayoutDashboard className="size-3" />概览
                  </button>
                  <button type="button" onClick={() => setMode('activity')} className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors',
                    mode === 'activity' && 'bg-[hsl(var(--bg-card))] font-medium shadow-sm',
                  )}>
                    <MessagesSquare className="size-3" />活动
                  </button>
                  <button type="button" onClick={() => setMode('evaluation')}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors',
                      mode === 'evaluation' && 'bg-[hsl(var(--bg-card))] font-medium shadow-sm',
                    )}>
                    <FlaskConical className="size-3" />评估
                  </button>
                </div>
              </div>
            )}
            <div className={cn(
              'min-h-0 flex-1 overflow-hidden',
              mode === 'evaluation' ? 'hidden' : 'flex',
            )}>
                <ProjectChatPanel
                  view={delivery}
                  surface={mode === 'activity' ? 'activity' : 'overview'}
                  onDeliveryRunSnapshotChange={handleDeliveryRunSnapshotChange}
                />
                {delivery && mode === 'overview' && <ProjectRightPanel view={delivery} />}
            </div>
            {mode === 'evaluation' && selectedConversation && (
              <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-muted))] p-4 lg:p-6">
                <div className="mx-auto max-w-6xl">
                  <ProjectEvaluationWorkspace conversationId={selectedConversation.id} />
                </div>
              </main>
            )}
          </>
        )}
      </div>
      <AgentObservabilityDrawerHost />
    </div>
  );
}
