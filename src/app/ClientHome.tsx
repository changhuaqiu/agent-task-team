'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import { TaskDetailPanel } from '@/components/task-hub/TaskDetailPanel';
import { NewTaskDialog } from '@/components/task-hub/NewTaskDialog';
import { AgentRosterModal } from '@/components/task-hub/AgentRosterModal';
import { SettingsDrawer } from '@/components/task-hub/SettingsDrawer';
import { ProjectWorkspace } from '@/components/project/ProjectWorkspace';
import { useEffect } from 'react';
import { Plus, Settings } from 'lucide-react';

export default function ClientHome() {
  const hasHydrated = useTaskHubStore((s) => s.hasHydrated);
  const selectedTaskId = useTaskHubStore((s) => s.selectedTaskId);
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const isNewTaskDialogOpen = useTaskHubStore((s) => s.isNewTaskDialogOpen);
  const isRosterModalOpen = useTaskHubStore((s) => s.isRosterModalOpen);
  const setNewTaskDialogOpen = useTaskHubStore((s) => s.setNewTaskDialogOpen);
  const setSettingsOpen = useTaskHubStore((s) => s.setSettingsOpen);
  const connectDaemon = useTaskHubStore((s) => s.connectDaemon);
  const loadFromServer = useTaskHubStore((s) => s.loadFromServer);

  useEffect(() => {
    loadFromServer().then(() => connectDaemon());
  }, [loadFromServer, connectDaemon]);

  if (!hasHydrated) {
    return (
      <main className="h-screen overflow-hidden bg-[hsl(var(--bg-app))] text-[hsl(var(--text-primary))] flex flex-col">
        <header className="h-[64px] px-6 flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--accent-soft))] flex items-center justify-center shadow-[2px_2px_0px_hsl(var(--text-primary))]">
              <span className="text-[12px] font-black tracking-tight text-[hsl(var(--accent))]">HUB</span>
            </div>
            <div>
              <h1 className="text-[16px] font-bold tracking-tight text-[hsl(var(--text-primary))] uppercase">DevOps 中心</h1>
              <p className="text-[10px] text-[hsl(var(--text-tertiary))] font-bold tracking-widest uppercase">多智能体协作</p>
            </div>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-6 shadow-sm">
            <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">初始化中</div>
            <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))] mt-1">正在加载状态…</div>
            <div className="text-[12px] text-[hsl(var(--text-tertiary))] mt-2">如果等待过久，请刷新页面。</div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[hsl(var(--bg-app))] text-[hsl(var(--text-primary))] flex flex-col">
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
              DevOps 中心
            </h1>
            <p className="text-[10px] text-[hsl(var(--text-tertiary))] font-bold tracking-widest uppercase">
              多智能体协作
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNewTaskDialogOpen(true)}
            disabled={!selectedConversationId}
            className="inline-flex items-center gap-1.5 bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] px-3.5 py-2 rounded-[var(--radius-md)] text-[12px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            新建任务
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center justify-center w-10 h-10 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-card))]"
            aria-label="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <ProjectWorkspace />

      {/* ── Task Detail Drawer ── */}
      {selectedTaskId && <TaskDetailPanel />}

      {/* ── New Task Dialog ── */}
      {isNewTaskDialogOpen && <NewTaskDialog />}

      {/* ── Agent Roster Modal ── */}
      {isRosterModalOpen && <AgentRosterModal />}

      <SettingsDrawer />
    </main>
  );
}
