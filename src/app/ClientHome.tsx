'use client';

import { useTaskHubStore } from '@/store/taskHubStore';
import { TaskDetailPanel } from '@/components/task-hub/TaskDetailPanel';
import { NewTaskDialog } from '@/components/task-hub/NewTaskDialog';
import { AgentRosterModal } from '@/components/task-hub/AgentRosterModal';
import { SettingsDrawer } from '@/components/task-hub/SettingsDrawer';
import { ProjectWorkspace } from '@/components/project/ProjectWorkspace';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { useEffect } from 'react';
import { AlertTriangle, Plus, RefreshCw, Settings } from 'lucide-react';

export default function ClientHome() {
  const hasHydrated = useTaskHubStore((s) => s.hasHydrated);
  const runtimeHydrationError = useTaskHubStore((s) => s.runtimeHydrationError);
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
    return <LoadingSkeleton />;
  }

  return (
    <main className="h-dvh overflow-hidden bg-[hsl(var(--bg-app))] text-[hsl(var(--text-primary))] flex flex-col">
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
            <p className="text-[11px] text-[hsl(var(--text-tertiary))] font-bold tracking-widest uppercase">
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

      {runtimeHydrationError && (
        <div
          role="alert"
          className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-950"
        >
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="truncate">
              部分项目或智能体账号信息加载失败：{runtimeHydrationError}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void loadFromServer()}
            className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-amber-400 bg-white px-2.5 py-1.5 font-semibold hover:bg-amber-100"
          >
            <RefreshCw className="size-3.5" />
            重试
          </button>
        </div>
      )}

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
