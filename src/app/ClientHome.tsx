'use client';

import { useTaskHubStore, selectActiveAgents } from '@/store/taskHubStore';
import { AgentTaskGroup } from '@/components/task-hub/AgentTaskGroup';
import { TaskDetailPanel } from '@/components/task-hub/TaskDetailPanel';
import { NewTaskDialog } from '@/components/task-hub/NewTaskDialog';
import { SummaryBar } from '@/components/task-hub/SummaryBar';
import { GlobalChatRoom } from '@/components/task-hub/GlobalChatRoom';
import { AgentRosterModal } from '@/components/task-hub/AgentRosterModal';
import { useEffect } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

export default function ClientHome() {
  const activeAgents = useTaskHubStore(useShallow(selectActiveAgents));
  const selectedTaskId = useTaskHubStore((s) => s.selectedTaskId);
  const isNewTaskDialogOpen = useTaskHubStore((s) => s.isNewTaskDialogOpen);
  const isRosterModalOpen = useTaskHubStore((s) => s.isRosterModalOpen);
  const setRosterModalOpen = useTaskHubStore((s) => s.setRosterModalOpen);
  const setNewTaskDialogOpen = useTaskHubStore((s) => s.setNewTaskDialogOpen);
  const connectDaemon = useTaskHubStore((s) => s.connectDaemon);

  useEffect(() => {
    connectDaemon();
  }, [connectDaemon]);

  return (
    <main className="min-h-screen bg-[hsl(var(--bg-app))] text-[hsl(var(--text-primary))] flex flex-col">
      {/* ── Header ── */}
      <header className="h-[64px] px-6 flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--accent-soft))] flex items-center justify-center shadow-[2px_2px_0px_hsl(var(--text-primary))]">
            <span className="text-[12px] font-black tracking-tight text-[hsl(var(--accent))]">
              HUB
            </span>
          </div>
          <div>
            <h1 className="text-[16px] font-bold tracking-tight text-[hsl(var(--text-primary))] uppercase">
              DevOps Hub
            </h1>
            <p className="text-[10px] text-[hsl(var(--text-tertiary))] font-bold tracking-widest uppercase">
              Multi-Agent Guild
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setNewTaskDialogOpen(true)}
          className="inline-flex items-center gap-1.5 bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] px-3.5 py-2 rounded-[var(--radius-md)] text-[12px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all duration-200 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          New Task
        </button>
      </header>

      {/* ── Summary Bar ── */}
      <div className="px-6 py-3 border-b border-[hsl(var(--border-subtle))]">
        <SummaryBar />
      </div>

      {/* ── Main Two-Column Layout ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Task Board */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-6 border-r-[2px] border-[hsl(var(--border))]">
          <div className="flex gap-5 items-start w-max min-h-[calc(100vh-140px)]">
            {activeAgents.map((agent) => (
              <AgentTaskGroup key={agent.id} agent={agent} />
            ))}

            {/* Invite Agent Button Area */}
            <div className="w-[320px] shrink-0 flex flex-col h-full">
              <button
                onClick={() => setRosterModalOpen(true)}
                className="flex-1 min-h-[200px] border-2 border-dashed border-[hsl(var(--border))] rounded-[4px] flex flex-col items-center justify-center gap-3 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-soft))] transition-all group"
              >
                <div className="w-12 h-12 rounded-[4px] border-2 border-current flex items-center justify-center group-hover:scale-110 transition-transform">
                  <UserPlus className="w-6 h-6" />
                </div>
                <span className="text-[12px] font-bold uppercase tracking-widest">
                  Invite Agent
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Right: Global Chat Room */}
        <div className="w-[360px] shrink-0 bg-[hsl(var(--bg-app))] relative z-10 hidden lg:block">
          <GlobalChatRoom />
        </div>
      </div>

      {/* ── Task Detail Drawer ── */}
      {selectedTaskId && <TaskDetailPanel />}

      {/* ── New Task Dialog ── */}
      {isNewTaskDialogOpen && <NewTaskDialog />}

      {/* ── Agent Roster Modal ── */}
      {isRosterModalOpen && <AgentRosterModal />}
    </main>
  );
}
