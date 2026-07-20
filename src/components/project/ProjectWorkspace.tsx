'use client';

import { useState } from 'react';
import { FlaskConical, MessagesSquare } from 'lucide-react';
import { ProjectSidebar } from './ProjectSidebar';
import { ProjectChatPanel } from './ProjectChatPanel';
import { ProjectRightPanel } from './ProjectRightPanel';
import { ProjectEvaluationWorkspace } from './ProjectEvaluationWorkspace';
import { AgentObservabilityDrawer } from './AgentObservabilityDrawer';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';

export function ProjectWorkspace() {
  const selectedConversation = useTaskHubStore((s) => s.getSelectedConversation());
  const [mode, setMode] = useState<'collaboration' | 'evaluation'>('collaboration');

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <ProjectSidebar />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="shrink-0 h-11 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-[hsl(var(--text-primary))]">
              {selectedConversation?.title ?? '选择一个项目'}
            </div>
          </div>
          <div className="flex rounded-lg bg-[hsl(var(--bg-muted))] p-0.5 text-[10px]">
            <button type="button" onClick={() => setMode('collaboration')} className={cn(
              'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors',
              mode === 'collaboration' && 'bg-[hsl(var(--bg-card))] font-semibold shadow-sm',
            )}>
              <MessagesSquare className="size-3"/>协作
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
            <ProjectChatPanel />
            <ProjectRightPanel teamPackId={selectedConversation?.teamPackId ?? ''} />
          </div>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-muted))] p-4 lg:p-6">
            <div className="mx-auto max-w-6xl">
              <ProjectEvaluationWorkspace conversationId={selectedConversation?.id} />
            </div>
          </main>
        )}
      </div>
      <AgentObservabilityDrawer />
    </div>
  );
}
