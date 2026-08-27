'use client';

import dynamic from 'next/dynamic';
import { useTaskHubStore } from '@/store/taskHubStore';
import { ProjectWorkspace } from '@/components/project/ProjectWorkspace';
import { WorkspaceAppChrome } from '@/components/shell/WorkspaceAppChrome';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

const TaskDetailPanel = dynamic(() => import('@/components/task-hub/TaskDetailPanel').then((mod) => mod.TaskDetailPanel));
const AgentRosterModal = dynamic(() => import('@/components/task-hub/AgentRosterModal').then((mod) => mod.AgentRosterModal));
const SettingsDrawer = dynamic(() => import('@/components/task-hub/SettingsDrawer').then((mod) => mod.SettingsDrawer));
const ProjectAddDialog = dynamic(() => import('@/components/project/ProjectAddDialog').then((mod) => mod.ProjectAddDialog));

export default function ClientHome() {
  const {
    hasHydrated,
    runtimeHydrationError,
    selectedTaskId,
    isRosterModalOpen,
    isSettingsOpen,
    connectDaemon,
    loadFromServer,
  } = useTaskHubStore(useShallow((s) => ({
    hasHydrated: s.hasHydrated,
    runtimeHydrationError: s.runtimeHydrationError,
    selectedTaskId: s.selectedTaskId,
    isRosterModalOpen: s.isRosterModalOpen,
    isSettingsOpen: s.isSettingsOpen,
    connectDaemon: s.connectDaemon,
    loadFromServer: s.loadFromServer,
  })));
  const [isAddProjectOpen, setAddProjectOpen] = useState(false);

  useEffect(() => {
    loadFromServer().then(() => connectDaemon());
  }, [loadFromServer, connectDaemon]);

  if (!hasHydrated) {
    return <LoadingSkeleton />;
  }

  return (
    <main className="h-dvh overflow-hidden bg-[hsl(var(--bg-app))] text-[hsl(var(--text-primary))] flex flex-col">
      <WorkspaceAppChrome />

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

      <ProjectWorkspace onAddProject={() => setAddProjectOpen(true)} />

      {/* ── Task Detail Drawer ── */}
      {selectedTaskId && <TaskDetailPanel />}

      {isAddProjectOpen && (
        <ProjectAddDialog
          open
          onClose={() => setAddProjectOpen(false)}
          onCreated={(project) => useTaskHubStore.getState().setSelectedConversationId(project.workspaceConversationId)}
        />
      )}

      {/* ── Agent Roster Modal ── */}
      {isRosterModalOpen && <AgentRosterModal />}

      {isSettingsOpen && <SettingsDrawer />}
    </main>
  );
}
