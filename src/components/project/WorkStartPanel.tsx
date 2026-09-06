'use client';

import { useRef, useState } from 'react';
import { useTaskHubStore, type WorkspaceProject } from '@/store/taskHubStore';
import type { ProjectWorkItem } from '@/lib/project-work-items';

export function WorkStartPanel({ item, project, onOpenActivity, onManageTeam }: {
  item: ProjectWorkItem;
  project: WorkspaceProject;
  onOpenActivity: () => void;
  onManageTeam?: () => void;
}) {
  const roster = useTaskHubStore((state) => state.agentRoster);
  const fallbackIds = useTaskHubStore((state) => state.activeAgentIds);
  const members = project.agentIds ?? fallbackIds;
  const coordinator = roster.find((agent) => members.includes(agent.id) && agent.responsibility === 'coordinator');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error?: string; submitted?: boolean }>();
  const inFlight = useRef(false);
  async function start() {
    if (inFlight.current || !coordinator) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const content = `@${coordinator.id} 请开始统筹「${item.title}」：理解目标与验收条件，拆解执行任务、分配负责人，并推进到有证据的验收。需要我决定时请明确说明问题与下一步。\n\n${item.description}`;
      // Reuse the entire issuance across retries and remounts in this tab.
      // A changed goal/coordinator is a different intent, not the same key.
      const storageKey = 'work-arrange:' + JSON.stringify([item.conversationId, item.id, item.rootTask?.revision ?? 0, content]);
      let command = { key: 'webui:work-arrange:' + crypto.randomUUID(), issuedAt: new Date().toISOString() };
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
        if (saved && typeof saved.key === 'string' && typeof saved.issuedAt === 'string') command = saved;
        else sessionStorage.setItem(storageKey, JSON.stringify(command));
      } catch { /* Storage may be unavailable; the server still validates this command. */ }
      const result = await useTaskHubStore.getState().addChatMessage({
        agentId: 'human', conversationId: item.conversationId,
        ...(item.rootTask ? { referencedTaskId: item.rootTask.id } : {}),
        content,
        commandIdempotencyKey: command.key,
        commandIssuedAt: command.issuedAt,
      });
      if (!result.ok) throw new Error(result.error);
      setNotice({ submitted: true });
    } catch (error) { setNotice({ error: error instanceof Error ? error.message : '安排请求未提交，请重试。' }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section aria-label="团队安排" className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-5">
    <h4 className="text-sm font-semibold">{notice?.submitted ? '安排请求已提交' : '目标已记录，等待团队安排'}</h4>
    <p className="mt-2 text-xs leading-5 text-[hsl(var(--text-secondary))]">{notice?.submitted
      ? '这表示系统收到了你的要求，不代表 Agent 已开始执行。到活动中查看接手确认与后续计划。'
      : coordinator ? `${coordinator.name} 将负责理解目标、拆解和分派；具体执行与验收由团队继续完成。` : '项目中还没有负责统筹的成员，先添加一位协调者。'}</p>
    {coordinator && <p className="mt-1 text-xs leading-5 text-[hsl(var(--text-tertiary))]">{coordinator.runtimeMode === 'custom' ? '使用该成员单独配置的账号与模型。' : '使用本机默认登录配置，无需重复添加账号；首次执行时仍会检查程序与登录是否可用。'}</p>}
    <div className="mt-3">{notice?.submitted
      ? <button type="button" onClick={onOpenActivity} className="rounded-lg border px-3 py-2 text-xs">查看接手进度</button>
      : coordinator ? <button type="button" onClick={() => void start()} disabled={busy} className="rounded-lg bg-[hsl(var(--text-primary))] px-3 py-2 text-xs text-[hsl(var(--text-inverse))] disabled:opacity-50">{busy ? '正在提交…' : '交给团队安排'}</button>
        : onManageTeam && <button type="button" onClick={onManageTeam} className="rounded-lg border px-3 py-2 text-xs">配置项目团队</button>}</div>
    {notice?.error && <p role="alert" className="mt-3 text-xs leading-5">{notice.error}</p>}
  </section>;
}
