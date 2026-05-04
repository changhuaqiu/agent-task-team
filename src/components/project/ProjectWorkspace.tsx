'use client';

import { ProjectSidebar } from './ProjectSidebar';
import { ProjectChatPanel } from './ProjectChatPanel';
import { ProjectRightPanel } from './ProjectRightPanel';

export function ProjectWorkspace() {
  return (
    <div className="flex-1 min-h-0 flex overflow-hidden relative">
      <ProjectSidebar />
      <ProjectChatPanel />
      <ProjectRightPanel />
    </div>
  );
}
