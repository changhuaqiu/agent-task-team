'use client';

import { useTaskHubStore, selectActiveAgents } from '@/store/taskHubStore';
import { AgentTaskGroup } from '@/components/task-hub/AgentTaskGroup';
import { TaskDetailPanel } from '@/components/task-hub/TaskDetailPanel';
import { NewTaskDialog } from '@/components/task-hub/NewTaskDialog';
import { SummaryBar } from '@/components/task-hub/SummaryBar';
import { GlobalChatRoom } from '@/components/task-hub/GlobalChatRoom';
import { AgentRosterModal } from '@/components/task-hub/AgentRosterModal';
import { QualityView } from '@/components/war-room/QualityView';
import { WarRoomView } from '@/components/war-room/WarRoomView';
import { useEffect, useState } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

export default function ClientHome() {
  const [view, setView] = useState<'war_room' | 'board' | 'quality'>('war_room');
  const hasHydrated = useTaskHubStore((s) => s.hasHydrated);
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

  if (!hasHydrated) {
    return (
      <main className="min-h-screen bg-[hsl(var(--bg-app))] text-[hsl(var(--text-primary))] flex flex-col">
        <header className="h-[64px] px-6 flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--accent-soft))] flex items-center justify-center shadow-[2px_2px_0px_hsl(var(--text-primary))]">
              <span className="text-[12px] font-black tracking-tight text-[hsl(var(--accent))]">HUB</span>
            </div>
            <div>
              <h1 className="text-[16px] font-bold tracking-tight text-[hsl(var(--text-primary))] uppercase">DevOps Hub</h1>
              <p className="text-[10px] text-[hsl(var(--text-tertiary))] font-bold tracking-widest uppercase">Multi-Agent Guild</p>
            </div>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-6 shadow-sm">
            <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">Initializing</div>
            <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))] mt-1">Hydrating local state…</div>
            <div className="text-[12px] text-[hsl(var(--text-tertiary))] mt-2">If this takes too long, refresh the page.</div>
          </div>
        </div>
      </main>
    );
  }

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

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-1">
            <button
              type="button"
              onClick={() => setView('war_room')}
              className={`h-8 px-3 rounded-[var(--radius-md)] text-[12px] font-semibold ${
                view === 'war_room'
                  ? 'bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))]'
                  : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-card))]'
              }`}
            >
              War Room
            </button>
            <button
              type="button"
              onClick={() => setView('board')}
              className={`h-8 px-3 rounded-[var(--radius-md)] text-[12px] font-semibold ${
                view === 'board'
                  ? 'bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))]'
                  : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-card))]'
              }`}
            >
              Board
            </button>
            <button
              type="button"
              onClick={() => setView('quality')}
              className={`h-8 px-3 rounded-[var(--radius-md)] text-[12px] font-semibold ${
                view === 'quality'
                  ? 'bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))]'
                  : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-card))]'
              }`}
            >
              Quality
            </button>
          </div>

          <button
            type="button"
            onClick={() => setNewTaskDialogOpen(true)}
            className="inline-flex items-center gap-1.5 bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] px-3.5 py-2 rounded-[var(--radius-md)] text-[12px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all duration-200 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Task
          </button>
        </div>
      </header>

      {/* ── Summary Bar ── */}
      <div className="px-6 py-3 border-b border-[hsl(var(--border-subtle))]">
        <SummaryBar />
      </div>

      {/* ── Main Two-Column Layout ── */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 border-r-[2px] border-[hsl(var(--border))] overflow-hidden">
          {view === 'war_room' && <WarRoomView />}

          {view === 'quality' && <QualityView />}

          {view === 'board' && (
            <div className="h-full overflow-x-auto overflow-y-hidden p-6">
              <div className="flex gap-5 items-start w-max min-h-[calc(100vh-140px)]">
                {activeAgents.map((agent) => (
                  <AgentTaskGroup key={agent.id} agent={agent} />
                ))}

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
          )}
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
