'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FlaskConical, MessagesSquare } from 'lucide-react';
import { ProjectSidebar } from './ProjectSidebar';
import { ProjectChatPanel } from './ProjectChatPanel';
import { ProjectRightPanel } from './ProjectRightPanel';
import { AgentObservabilityDrawerHost } from './AgentObservabilityDrawerHost';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import type { DeliveryRunSnapshot } from '@/server/autonomous-delivery/types';
import { projectDeliveryNavigation, projectDeliveryWorkspace } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

const ProjectEvaluationWorkspace = dynamic(() => import('./ProjectEvaluationWorkspace').then((mod) => mod.ProjectEvaluationWorkspace));

export function ProjectWorkspace() {
  const {
    selectedDeliveryId,
    conversations,
    tasks,
    blockersByConversation,
    chatMessagesByConversation,
  } = useTaskHubStore(useShallow((state) => ({
    selectedDeliveryId: state.selectedConversationId,
    conversations: state.conversations,
    tasks: state.tasks,
    blockersByConversation: state.blockersByConversation,
    chatMessagesByConversation: state.chatMessagesByConversation,
  })));
  const selectedConversation = conversations.find((item) => item.id === selectedDeliveryId);
  const [mode, setMode] = useState<'collaboration' | 'evaluation'>('collaboration');
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

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <ProjectSidebar navigation={navigation} />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="shrink-0 h-11 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-[hsl(var(--text-primary))]">
              {selectedConversation?.title ?? '选择一个交付'}
            </div>
          </div>
          <div className="flex rounded-lg bg-[hsl(var(--bg-muted))] p-0.5 text-[10px]">
            <button type="button" onClick={() => setMode('collaboration')} className={cn(
              'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors',
              mode === 'collaboration' && 'bg-[hsl(var(--bg-card))] font-semibold shadow-sm',
            )}>
              <MessagesSquare className="size-3"/>交付
            </button>
            <button type="button" onClick={() => setMode('evaluation')} disabled={!selectedConversation}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                mode === 'evaluation' && 'bg-[hsl(var(--bg-card))] font-semibold shadow-sm',
              )}>
              <FlaskConical className="size-3"/>评估
            </button>
          </div>
        </div>
        {mode === 'collaboration' ? (
          <div className="min-h-0 flex-1 flex overflow-hidden">
            <ProjectChatPanel
              view={delivery}
              onDeliveryRunSnapshotChange={handleDeliveryRunSnapshotChange}
            />
            <ProjectRightPanel view={delivery} />
          </div>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-muted))] p-4 lg:p-6">
            <div className="mx-auto max-w-6xl">
              <ProjectEvaluationWorkspace conversationId={selectedConversation?.id} />
            </div>
          </main>
        )}
      </div>
      <AgentObservabilityDrawerHost />
    </div>
  );
}
