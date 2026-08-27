'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, Cpu, ShieldCheck, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTaskHubStore } from '@/store/taskHubStore';

export function AgentBindingPanel({ agentId }: { agentId: string }) {
  const {
    agents,
    accounts,
    skillsMap,
    activeRunsByAgent,
    selectedConversationId,
    selectedProjectId,
    agentSessions,
  } = useTaskHubStore(useShallow((state) => ({
    agents: state.agentRoster,
    accounts: state.accounts,
    skillsMap: state.skillsMap,
    activeRunsByAgent: state.activeRunsByAgent,
    selectedConversationId: state.selectedConversationId,
    selectedProjectId: state.selectedProjectId,
    agentSessions: state.agentSessions,
  })));
  const [copied, setCopied] = useState(false);
  const agent = agents.find((item) => item.id === agentId);
  const sessionScope = selectedConversationId ?? selectedProjectId;
  const sessionId = sessionScope ? agentSessions[sessionScope]?.[agentId] : undefined;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!agent) {
    return <div className="px-3 py-3 text-xs text-amber-700">这个团队成员对应的 Agent Definition 已不存在，运行时不会临时合成替代对象。</div>;
  }

  const skillNames = agent.skillIds.map((id) => skillsMap[id]?.name ?? id);
  const accountNames = agent.accountIds.map((id) => accounts.find((account) => account.id === id)?.name ?? id);
  const permissions = [agent.canModifyCode && '修改代码', agent.canReview && '独立评审'].filter(Boolean) as string[];

  return <div className="px-3 pb-2 pt-1">
    <section className="space-y-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-4" aria-label={`${agent.name} Agent Definition`}>
      <header className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--bg-muted))] text-lg">{agent.emoji}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold">{agent.name}</h3><span className="rounded-full bg-[hsl(var(--bg-muted))] px-2 py-0.5 text-[10px]">{activeRunsByAgent[agent.id] ? '执行中' : '可协作'}</span></div><p className="mt-1 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">能力直接来自 Agent Definition；团队只保存该 Agent 的引用。</p></div></header>

      <div><div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">工作指令</div><p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-[hsl(var(--text-secondary))]">{agent.instructions}</p></div>

      <div className="grid gap-2 sm:grid-cols-2"><Info icon={<Cpu className="size-3.5" />} label="运行环境" value={`${agent.cliEngine ?? '默认'}${agent.model ? ` · ${agent.model}` : ''}`} /><Info icon={<ShieldCheck className="size-3.5" />} label="工作权限" value={permissions.join('、') || '只读协作'} /></div>

      <div><div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">技能</div>{skillNames.length ? <div className="mt-2 flex flex-wrap gap-1.5">{skillNames.map((name) => <span key={name} className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--bg-muted))] px-2 py-1 text-[10px]"><Sparkles className="size-3" />{name}</span>)}</div> : <p className="mt-1.5 text-[11px] text-[hsl(var(--text-tertiary))]">未选择专属技能</p>}</div>

      <div><div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">模型账号</div><p className="mt-1.5 text-[11px] text-[hsl(var(--text-secondary))]">{accountNames.length ? accountNames.join('、') : '使用运行环境的登录状态'}</p></div>

      {sessionId && <button type="button" onClick={() => { void navigator.clipboard?.writeText(sessionId); setCopied(true); }} className="flex w-full items-center gap-2 rounded-lg border border-[hsl(var(--border-subtle))] px-3 py-2 text-left text-[10px] text-[hsl(var(--text-tertiary))]"><span className="min-w-0 flex-1 truncate font-mono">{sessionId}</span>{copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}</button>}
    </section>
  </div>;
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-lg bg-[hsl(var(--bg-muted))] p-3"><div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-tertiary))]">{icon}{label}</div><div className="mt-1.5 truncate text-xs font-medium">{value}</div></div>;
}
