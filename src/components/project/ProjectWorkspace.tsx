'use client';

import { ProjectSidebar } from './ProjectSidebar';
import { ProjectChatPanel } from './ProjectChatPanel';
import { ProjectRightPanel } from './ProjectRightPanel';
import { useTaskHubStore } from '@/store/taskHubStore';

export function ProjectWorkspace() {
  const selectedConversation = useTaskHubStore((s) => s.getSelectedConversation());

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <ProjectSidebar />
      <ProjectChatPanel />
      <ProjectRightPanel teamPackId={selectedConversation?.teamPackId ?? ''} />
    </div>
  );
}
