'use client';

import { useMemo, useState } from 'react';
import { Activity, Bot, ChevronLeft, ChevronRight, FolderKanban, Search, Settings } from 'lucide-react';
import type { Conversation, WorkspaceProject } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';
import { cn } from '@/lib/utils';

export type WorkspaceSurface = 'activity' | 'agents' | 'projects' | 'project';

export function ProjectSidebar({ projects, conversations, tasks, activeSurface, selectedProjectId, onOpenActivity, onOpenAgents, onOpenProjects, onOpenSettings, onSelectProject }: {
  projects: WorkspaceProject[];
  conversations: Conversation[];
  tasks: Task[];
  activeSurface: WorkspaceSurface;
  selectedProjectId: string | null;
  onOpenActivity: () => void;
  onOpenAgents: () => void;
  onOpenProjects: () => void;
  onOpenSettings: () => void;
  onSelectProject: (project: WorkspaceProject) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? projects.filter((project) => project.name.toLowerCase().includes(value) || project.rootPath.toLowerCase().includes(value)) : projects;
  }, [projects, query]);
  const conversationProject = useMemo(() => new Map(conversations.map((conversation) => [conversation.id, conversation.projectId])), [conversations]);
  const workCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const projectId = conversationProject.get(task.conversationId) ?? projects.find((project) => project.workspaceConversationId === task.conversationId)?.id;
      if (projectId) counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
    }
    return counts;
  }, [conversationProject, projects, tasks]);
  const navButton = (active: boolean) => cn('flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs transition-colors', active ? 'bg-[hsl(var(--accent-soft))] font-medium text-[hsl(var(--text-primary))]' : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-card-hover))]');

  return <aside className={cn('flex h-full shrink-0 flex-col border-r border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] transition-[width] duration-200', expanded ? 'w-[248px]' : 'w-14')} data-testid="project-sidebar">
    <div className="flex h-12 shrink-0 items-center px-3">
      {expanded ? <><div className="flex min-w-0 flex-1 items-center gap-2"><div className="flex size-7 items-center justify-center rounded-lg bg-[hsl(var(--text-primary))] text-[10px] font-semibold text-[hsl(var(--text-inverse))]">AT</div><div className="truncate text-sm font-semibold">Agent Task</div></div><button type="button" onClick={() => setExpanded(false)} aria-label="收起工作区侧栏" className="flex size-7 items-center justify-center rounded-md text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]"><ChevronLeft className="size-4" /></button></> : <button type="button" onClick={() => setExpanded(true)} aria-label="展开工作区侧栏" className="mx-auto flex size-8 items-center justify-center rounded-md hover:bg-[hsl(var(--bg-muted))]"><ChevronRight className="size-4" /></button>}
    </div>

    {expanded ? <>
      <nav className="space-y-1 px-2" aria-label="工作区导航"><button type="button" onClick={onOpenActivity} className={navButton(activeSurface === 'activity')}><Activity className="size-4" />收件箱</button><button type="button" onClick={onOpenAgents} className={navButton(activeSurface === 'agents')}><Bot className="size-4" />Agents</button></nav>
      <div className="mt-5 flex items-center px-4 pb-1"><button type="button" onClick={onOpenProjects} className={cn('min-w-0 flex-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--text-tertiary))]', activeSurface === 'projects' && 'text-[hsl(var(--text-primary))]')}>Projects</button></div>
      {projects.length >= 7 && <div className="px-3 pb-2"><div className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--text-tertiary))]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目…" aria-label="搜索项目" className="h-8 w-full rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] pl-8 pr-2 text-xs outline-none" /></div></div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{filtered.map((project) => { const count = workCountByProject.get(project.id) ?? 0; const active = activeSurface === 'project' && selectedProjectId === project.id; return <button key={project.id} type="button" onClick={() => onSelectProject(project)} className={cn('mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors', active ? 'bg-[hsl(var(--accent-soft))]' : 'hover:bg-[hsl(var(--bg-card-hover))]')} aria-current={active ? 'page' : undefined}><div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))]"><FolderKanban className="size-3.5" /></div><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{project.name}</span><span className="mt-0.5 block truncate text-[10px] text-[hsl(var(--text-tertiary))]">{count} 个工作项</span></span></button>; })}{filtered.length === 0 && <div className="px-3 py-8 text-center text-xs text-[hsl(var(--text-tertiary))]">没有匹配的项目</div>}</div>
      <div className="border-t border-[hsl(var(--border-subtle))] p-2"><button type="button" onClick={onOpenSettings} className={navButton(false)}><Settings className="size-4" />设置</button></div>
    </> : <div className="flex flex-1 flex-col items-center gap-1.5 py-2"><button type="button" onClick={onOpenActivity} title="收件箱" className={cn('flex size-10 items-center justify-center rounded-lg', activeSurface === 'activity' && 'bg-[hsl(var(--accent-soft))]')}><Activity className="size-4" /></button><button type="button" onClick={onOpenAgents} title="Agents" className={cn('flex size-10 items-center justify-center rounded-lg', activeSurface === 'agents' && 'bg-[hsl(var(--accent-soft))]')}><Bot className="size-4" /></button><button type="button" onClick={onOpenProjects} title="Projects" className={cn('flex size-10 items-center justify-center rounded-lg', ['projects', 'project'].includes(activeSurface) && 'bg-[hsl(var(--accent-soft))]')}><FolderKanban className="size-4" /></button><button type="button" onClick={onOpenSettings} title="设置" className="mt-auto flex size-10 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg-muted))]"><Settings className="size-4" /></button></div>}
  </aside>;
}
