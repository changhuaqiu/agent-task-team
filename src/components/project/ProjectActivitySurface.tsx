'use client';

import { MessageSquareText } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { FocusedMessage } from './FocusedMessage';
import { projectChatTimeline } from '@/components/task-hub/chatTimelineProjection';
import type { WorkItemIdentity, ProjectWorkItem } from '@/lib/project-work-items';
import type { WorkspaceProject } from '@/store/taskHubStore';
import { useTaskHubStore } from '@/store/taskHubStore';

export function ProjectActivitySurface({ project, workItems, focusMessageId, onOpenWork }: { project: WorkspaceProject; workItems: ProjectWorkItem[]; focusMessageId?: string; onOpenWork?: (identity: WorkItemIdentity, messageId: string) => void }) {
  const { messages, agents } = useTaskHubStore(useShallow((state) => ({
    messages: state.chatMessagesByConversation,
    agents: state.agentRoster,
  })));
  const labels = new Map(workItems.map((item) => [item.conversationId, item.title]));
  labels.set(project.workspaceConversationId, '项目讨论（历史）');
  const activity = [...labels.entries()].flatMap(([conversationId, label]) => (
    projectChatTimeline((messages[conversationId] ?? [])
      .filter((message) => !['thinking', 'tool_use', 'tool_result'].includes(message.contentType ?? 'text')))
      .map((entry) => {
        const message = entry.kind === 'activity' ? entry.message : entry.messages.at(-1)!;
        const work = workItems.find((work) => work.conversationId === conversationId && (!work.legacy || work.tasks.some((task) => task.id === message.referencedTaskId)));
        return { ...message, label: work?.title ?? label, conversationId, work, content: entry.kind === 'activity' ? message.content : entry.messages.map((message) => message.content).join('\n\n') };
      })
  )).sort((left, right) => right.timestamp.localeCompare(left.timestamp)).slice(0, 120);
  const agentNames = new Map(agents.map((agent) => [agent.id, `${agent.emoji} ${agent.name}`]));

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))]" aria-label="项目活动">
    <div className="mx-auto w-full max-w-5xl px-5 py-6">
      <header><h3 className="text-sm font-semibold">项目活动</h3><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">跨工作项的只读汇总。进入具体工作项后再讨论或要求 Agent 执行。</p></header>
      {focusMessageId && <div className="mt-4"><FocusedMessage key={focusMessageId} messageId={focusMessageId} projectId={project.id} /></div>}
      {activity.length > 0 ? <div className="mt-5 overflow-hidden rounded-2xl bg-[hsl(var(--bg-card))] divide-y divide-[hsl(var(--border-subtle))]">{activity.map((item) => <article key={`${item.conversationId}:${item.id}`} className="px-4 py-3.5 sm:px-5"><div className="flex flex-wrap items-center gap-2 text-[10px] text-[hsl(var(--text-tertiary))]"><span className="rounded bg-[hsl(var(--bg-muted))] px-1.5 py-0.5">{item.label}</span><span>{agentNames.get(item.agentId) ?? (item.agentId === 'human' ? '你' : '系统')}</span><time>{new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false })}</time></div><details className="mt-2"><summary className="cursor-pointer text-sm leading-5 text-[hsl(var(--text-secondary))]"><span className="line-clamp-2">{item.content.slice(0, 160)}</span><span className="mt-1 block text-xs underline">阅读完整内容</span></summary><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.content}</p></details>{item.work && onOpenWork && <button type="button" onClick={() => onOpenWork({ conversationId: item.conversationId, taskId: item.work!.id }, item.id)} className="mt-3 text-xs underline">进入所属工作项</button>}</article>)}</div>
        : <div className="mt-5 flex min-h-72 flex-col items-center justify-center rounded-2xl bg-[hsl(var(--bg-card))] px-6 text-center"><MessageSquareText className="size-6 text-[hsl(var(--text-tertiary))]" /><h4 className="mt-3 text-sm font-medium">还没有项目活动</h4><p className="mt-1.5 text-xs text-[hsl(var(--text-tertiary))]">创建工作项并开始协作后，重要活动会汇总到这里。</p></div>}
    </div>
  </main>;
}

