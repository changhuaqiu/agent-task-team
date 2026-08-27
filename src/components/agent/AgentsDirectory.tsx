'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bot, ChevronRight, Clock3, Cpu, Hash, Loader2, MessageSquareText, Plus, RotateCcw, Settings2, Sparkles, Square, TerminalSquare, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { loadAgentRuntimeCatalog, type AgentRuntimeCatalogItem } from '@/lib/agent-runtime-catalog-client';
import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import { loadAgents, type Agent } from '@/store/agentStore';
import { useTaskHubStore, type ActiveAgentRun, type ChatMessage, type Conversation, type WorkspaceProject } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import { SettingsTeamPacksTab } from '@/components/task-hub/SettingsTeamPacksTab';
import {
  AgentDefinitionDialog,
  type AgentDefinitionDraft,
} from '@/components/agent/AgentDefinitionDialog';

type ProfileTab = 'activity' | 'info' | 'runtime' | 'channels' | 'skills';

interface RuntimeSnapshot {
  key: {
    agentId: string;
    projectId: string;
    runtimeNodeId: string;
    runtimeId: string;
  };
  generation: number;
  lifecycle: 'stopped' | 'starting' | 'listening' | 'waking' | 'ready' | 'degraded' | 'failed' | 'stopping';
  acceptingWork: boolean;
  readyWorkers: number;
  totalWorkers: number;
  workerNames?: string[];
  failureCount: number;
  reasonCode?: string;
  retryAt?: string;
  circuitOpenUntil?: string;
}

interface MessageDraft {
  projectId: string;
  content: string;
}

function runtimeLabel(items: AgentRuntimeCatalogItem[], runtimeId?: RuntimeCliEngine) {
  return items.find((item) => item.id === runtimeId)?.label ?? runtimeId ?? '未配置';
}

function formatActivityTime(timestamp: string) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function draftFingerprint(draft: AgentDefinitionDraft): string {
  return JSON.stringify({ ...draft, saveKey: undefined });
}

export function AgentsDirectory() {
  const { agents, accounts, skillsMap, activeRunsByAgent, daemonStatus, conversations, projects, chatMessagesByConversation, addChatMessage } = useTaskHubStore(useShallow((state) => ({
    agents: state.agentRoster,
    accounts: state.accounts,
    skillsMap: state.skillsMap,
    activeRunsByAgent: state.activeRunsByAgent,
    daemonStatus: state.daemonConnection.status,
    conversations: state.conversations,
    projects: state.projects,
    chatMessagesByConversation: state.chatMessagesByConversation,
    addChatMessage: state.addChatMessage,
  })));
  const [selectedId, setSelectedId] = useState<string | null>(agents[0]?.id ?? null);
  const [tab, setTab] = useState<ProfileTab>('activity');
  const [runtimes, setRuntimes] = useState<AgentRuntimeCatalogItem[]>([]);
  const [draft, setDraft] = useState<AgentDefinitionDraft | null>(null);
  const [draftBaseline, setDraftBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [libraryView, setLibraryView] = useState<'agents' | 'teams'>('agents');
  const [runtimeSnapshots, setRuntimeSnapshots] = useState<RuntimeSnapshot[]>([]);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeAction, setRuntimeAction] = useState<'stop' | 'restart' | null>(null);
  const [runtimeNotice, setRuntimeNotice] = useState<{ kind: 'status' | 'alert'; message: string } | null>(null);
  const [messageDraft, setMessageDraft] = useState<MessageDraft | null>(null);
  const [messageSending, setMessageSending] = useState(false);

  useEffect(() => {
    void loadAgentRuntimeCatalog().then(setRuntimes).catch(() => undefined);
  }, []);

  const effectiveSelectedId = selectedId && agents.some((agent) => agent.id === selectedId)
    ? selectedId
    : agents[0]?.id ?? null;

  const refreshRuntimeSnapshots = useCallback(async (agentId: string) => {
    setRuntimeLoading(true);
    try {
      const response = await fetch(`/api/agent-runtime-control?agentId=${encodeURIComponent(agentId)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? '无法读取运行实例');
      setRuntimeSnapshots(Array.isArray(body.runtimes) ? body.runtimes : []);
    } catch (cause) {
      setRuntimeSnapshots([]);
      setRuntimeNotice({
        kind: 'alert',
        message: cause instanceof Error ? cause.message : '无法读取运行实例',
      });
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!effectiveSelectedId || tab !== 'runtime') return;
    const timer = window.setTimeout(() => {
      setRuntimeSnapshots([]);
      setRuntimeNotice(null);
      void refreshRuntimeSnapshots(effectiveSelectedId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [effectiveSelectedId, refreshRuntimeSnapshots, tab]);

  const selected = agents.find((agent) => agent.id === effectiveSelectedId) ?? null;
  const skills = useMemo(() => Object.entries(skillsMap).map(([key, value]) => ({ ...value, id: value.id ?? key })), [skillsMap]);
  const readyRuntime = runtimes.find((item) => item.available)?.id ?? 'codex';

  const openEditor = useCallback((agent?: Agent) => {
    setError('');
    const next: AgentDefinitionDraft = agent ? {
      saveKey: crypto.randomUUID(),
      id: agent.id,
      revision: agent.revision ?? 1,
      name: agent.name,
      instructions: agent.instructions,
      responsibility: agent.responsibility ?? 'specialist',
      runtimeId: agent.cliEngine ?? readyRuntime,
      accountIds: agent.accountIds,
      model: agent.model ?? '',
      skillIds: agent.skillIds,
      emoji: agent.emoji || '🤖',
      theme: agent.theme,
      customExecution: agent.runtimeMode
        ? agent.runtimeMode === 'custom'
        : Boolean(agent.accountIds.length || agent.model),
      canModifyCode: agent.canModifyCode,
      canReview: agent.canReview,
      audienceMode: agent.audienceMode ?? 'owner',
      audienceIds: agent.audienceIds ?? [],
      parallelism: agent.parallelism ? String(agent.parallelism) : '',
      instanceNamePool: agent.instanceNamePool ?? [],
      runLocation: agent.runLocation ?? 'local',
    } : {
      saveKey: crypto.randomUUID(),
      name: '',
      instructions: '',
      responsibility: 'specialist',
      runtimeId: readyRuntime,
      accountIds: [],
      model: '',
      skillIds: [],
      emoji: '🤖',
      theme: 'mario',
      customExecution: false,
      canModifyCode: false,
      canReview: false,
      audienceMode: 'owner',
      audienceIds: [],
      parallelism: '',
      instanceNamePool: [],
      runLocation: 'local',
    };
    setDraft(next);
    setDraftBaseline(draftFingerprint(next));
  }, [readyRuntime]);

  async function saveAgent() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.instructions.trim()) {
      setError('请填写 Agent 名称和工作指令。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.id ? 'agent.update' : 'agent.create',
          commandId: draft.saveKey,
          idempotencyKey: draft.saveKey,
          ...(draft.id ? { expectedRevision: draft.revision } : {}),
          input: {
            ...(draft.id ? { id: draft.id } : {}),
            name: draft.name,
            instructions: draft.instructions,
            responsibility: draft.responsibility ?? 'specialist',
            runtimeMode: draft.customExecution ? 'custom' : 'defaults',
            runtimeId: draft.customExecution ? draft.runtimeId : readyRuntime,
            accountIds: draft.customExecution ? draft.accountIds : [],
            model: draft.customExecution ? draft.model : undefined,
            skillIds: draft.skillIds,
            emoji: draft.emoji,
            theme: draft.theme,
            audience: { mode: draft.audienceMode, ids: draft.audienceIds },
            parallelism: draft.parallelism === '' ? null : Number(draft.parallelism),
            instanceNamePool: draft.instanceNamePool,
            runLocation: draft.runLocation,
            permissions: {
              canModifyCode: draft.canModifyCode,
              canReview: draft.canReview,
            },
          },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.reasonCode ?? body.error ?? 'Agent 保存失败');
      await loadAgents({ propagateFailure: true });
      setSelectedId(body.result?.agent?.id ?? draft.id ?? null);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(next: AgentDefinitionDraft) {
    setDraft((current) => current ? { ...next, saveKey: draftFingerprint(next) === draftFingerprint(current) ? current.saveKey : crypto.randomUUID() } : next);
  }

  async function controlRuntime(action: 'stop' | 'restart', projectId: string) {
    if (!selected) return;
    setRuntimeAction(action);
    setRuntimeNotice(null);
    try {
      const response = await fetch('/api/agent-runtime-control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: selected.id, projectId, action }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? (action === 'stop' ? '停止失败' : '重启失败'));
      const runtimes: RuntimeSnapshot[] = Array.isArray(body.runtimes) ? body.runtimes : [];
      const failedRuntimeCount = runtimes.filter((runtime) => runtime.lifecycle === 'failed').length;
      setRuntimeSnapshots((current) => [
        ...current.filter((runtime) => runtime.key.projectId !== projectId),
        ...runtimes,
      ]);
      setRuntimeNotice({
        kind: action === 'restart' && failedRuntimeCount > 0 ? 'alert' : 'status',
        message: action === 'stop'
          ? `已停止 ${runtimes.length} 个运行实例${body.cancelledInvocations ? `，取消 ${body.cancelledInvocations} 个当前任务` : ''}。`
          : failedRuntimeCount > 0
            ? `已发起重启，但 ${failedRuntimeCount} 个运行实例启动失败。请检查原因码与运行配置。`
            : `已重新启动 ${runtimes.length} 个运行实例。`,
      });
    } catch (cause) {
      setRuntimeNotice({
        kind: 'alert',
        message: cause instanceof Error ? cause.message : (action === 'stop' ? '停止失败' : '重启失败'),
      });
    } finally {
      setRuntimeAction(null);
    }
  }

  function openMessageComposer() {
    setError('');
    setMessageDraft({ projectId: projects[0]?.id ?? '', content: '' });
  }

  async function sendAgentMessage() {
    if (!selected || !messageDraft) return;
    const project = projects.find((item) => item.id === messageDraft.projectId);
    if (!project) {
      setError('请选择消息所属的项目。');
      return;
    }
    if (!messageDraft.content.trim()) {
      setError('请输入要发送给 Agent 的消息。');
      return;
    }
    setMessageSending(true);
    setError('');
    const issuedAt = new Date().toISOString();
    try {
      const result = await addChatMessage({
        agentId: 'human',
        content: `@${selected.id} ${messageDraft.content.trim()}`,
        conversationId: project.workspaceConversationId,
        commandIdempotencyKey: `agent-message:${selected.id}:${project.id}:${issuedAt}`,
        commandIssuedAt: issuedAt,
      });
      if (!result.ok) throw new Error(result.error);
      setMessageDraft(null);
      setTab('activity');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '消息发送失败');
    } finally {
      setMessageSending(false);
    }
  }

  const selectedSkillNames = selected?.skillIds.map((id) => skills.find((skill) => skill.id === id)?.name ?? id) ?? [];
  const selectedAgentId = selected?.id;
  const selectedActivity = selectedAgentId
    ? Object.entries(chatMessagesByConversation)
      .flatMap(([conversationId, messages]) => messages
        .filter((message) => message.agentId === selectedAgentId)
        .map((message) => ({ ...message, conversationId: message.conversationId ?? conversationId })))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, 100)
    : [];
  const selectedChannels = selectedAgentId
    ? Object.entries(chatMessagesByConversation)
      .map(([conversationId, messages]) => {
        const agentMessages = messages.filter((message) => message.agentId === selectedAgentId);
        if (!agentMessages.length) return null;
        const conversation = conversations.find((item) => item.id === conversationId);
        const project = projects.find((item) => item.workspaceConversationId === conversationId || item.id === conversation?.projectId);
        const lastMessage = agentMessages.slice().sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
        return {
          id: conversationId,
          title: project?.name ?? conversation?.title ?? conversationId,
          count: agentMessages.length,
          timestamp: lastMessage.timestamp,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    : [];
  const status = selected && activeRunsByAgent[selected.id]
    ? '执行中'
    : daemonStatus !== 'connected'
      ? '服务未连接'
      : selected?.isOnline
        ? '可协作'
        : '空闲';

  return <main className="flex min-h-0 flex-1 bg-[hsl(var(--bg-card))]" data-testid="agents-directory">
    <section className="w-[340px] shrink-0 overflow-y-auto border-r border-[hsl(var(--border-subtle))] p-4">
      <div className="mb-4 flex items-start justify-between gap-3 px-1">
        <div><h2 className="text-lg font-semibold">Agents</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">Agent 身份与可复用团队。</p></div>
        {libraryView === 'agents' && <span className="rounded-full bg-[hsl(var(--bg-muted))] px-2 py-1 text-[10px] text-[hsl(var(--text-tertiary))]">{agents.length}</span>}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-[hsl(var(--bg-muted))] p-1" aria-label="Agent 资料库"><button type="button" onClick={() => setLibraryView('agents')} className={cn('h-8 rounded-md text-xs', libraryView === 'agents' ? 'bg-[hsl(var(--bg-elevated))] font-medium shadow-sm' : 'text-[hsl(var(--text-tertiary))]')}>Agents</button><button type="button" onClick={() => setLibraryView('teams')} className={cn('h-8 rounded-md text-xs', libraryView === 'teams' ? 'bg-[hsl(var(--bg-elevated))] font-medium shadow-sm' : 'text-[hsl(var(--text-tertiary))]')}>Agent teams</button></div>
      {libraryView === 'agents' ? <><button type="button" onClick={() => openEditor()} className="mb-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-3 text-left hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-soft))]">
        <span className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))]"><Plus className="size-4" /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">新建 Agent</span><span className="mt-0.5 block text-[11px] text-[hsl(var(--text-tertiary))]">添加一个可重复使用的协作者</span></span>
        <ChevronRight className="size-4 text-[hsl(var(--text-tertiary))]" />
      </button>
      <div className="space-y-1.5">{agents.map((agent) => {
        const running = Boolean(activeRunsByAgent[agent.id]);
        return <button key={agent.id} type="button" onClick={() => { setSelectedId(agent.id); setTab('activity'); }} className={cn('flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors', effectiveSelectedId === agent.id ? 'bg-[hsl(var(--accent-soft))]' : 'hover:bg-[hsl(var(--bg-card-hover))]')}>
          <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--bg-muted))] text-lg">{agent.emoji || <Bot className="size-4" />}<span className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[hsl(var(--bg-card))]', running ? 'bg-emerald-500' : agent.isOnline ? 'bg-sky-500' : 'bg-slate-400')} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{agent.name}</span><span className="mt-0.5 block truncate text-[11px] text-[hsl(var(--text-tertiary))]">{running ? '执行中' : runtimeLabel(runtimes, agent.cliEngine)} · {agent.skillIds.length} 个技能</span></span>
          <ChevronRight className="size-4 text-[hsl(var(--text-tertiary))]" />
        </button>;
      })}</div></> : <div className="px-2 py-3 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">团队是已有 Agent 的协作组合，不会创建新的能力对象。</div>}
    </section>

    {libraryView === 'teams' ? <section className="min-w-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-3xl p-7"><SettingsTeamPacksTab agentOptions={agents} deploymentTargets={projects} /></div></section> : selected ? <section className="min-w-0 flex-1 overflow-y-auto">
      <div className="border-b border-[hsl(var(--border-subtle))] px-7 pb-0 pt-6">
        <div className="flex items-start gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--bg-muted))] text-2xl">{selected.emoji}</div>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-semibold">{selected.name}</h2><span className="rounded-full bg-[hsl(var(--bg-muted))] px-2 py-1 text-[10px] text-[hsl(var(--text-secondary))]">{status}</span></div><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">{runtimeLabel(runtimes, selected.cliEngine)} · {selected.skillIds.length} 个技能</p></div>
          <div className="flex items-center gap-2"><button type="button" onClick={openMessageComposer} disabled={projects.length === 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-3 text-xs text-[hsl(var(--text-inverse))] disabled:opacity-50"><MessageSquareText className="size-3.5" />发消息</button><button type="button" onClick={() => openEditor(selected)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 text-xs hover:bg-[hsl(var(--bg-muted))]"><Settings2 className="size-3.5" />编辑 Agent</button></div>
        </div>
        <nav className="mt-6 flex gap-5" aria-label="Agent 详情">{([
          ['activity', '活动'], ['info', '信息'], ['runtime', '运行'], ['channels', '频道'], ['skills', '技能'],
        ] as Array<[ProfileTab, string]>).map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={cn('border-b-2 px-0.5 pb-3 text-xs', tab === id ? 'border-[hsl(var(--text-primary))] font-medium text-[hsl(var(--text-primary))]' : 'border-transparent text-[hsl(var(--text-tertiary))]')}>{label}</button>)}</nav>
      </div>
      <div className="mx-auto max-w-3xl p-7">
        {tab === 'activity' && <AgentActivityPanel agentName={selected.name} activeRun={activeRunsByAgent[selected.id]} activity={selectedActivity} conversations={conversations} projects={projects} />}
        {tab === 'info' && <div className="space-y-5"><section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4"><h3 className="text-xs font-semibold">身份与工作指令</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[hsl(var(--text-secondary))]">{selected.instructions}</p><p className="mt-3 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">这段指令描述 Agent 的工作方式；结构化主要职责和工作权限决定它能否进入实现。</p></section><section className="grid gap-3 sm:grid-cols-3"><InfoCard label="主要职责" value={{ coordinator: '协调与分派', implementer: '实现工作', reviewer: '评审与验证', specialist: '专业支持' }[selected.responsibility ?? 'specialist']} hint="提及只负责触达，不会改写职责" /><InfoCard label="工作权限" value={[selected.canModifyCode && '可修改代码', selected.canReview && '可独立评审'].filter(Boolean).join('、') || '只读协作'} hint="权限属于 Agent Definition" /><InfoCard label="指令来源" value="Agent 自身" hint="Team 只引用这个 Agent，不复制能力配置" /></section></div>}
        {tab === 'runtime' && <RuntimePanel runtime={runtimes.find((item) => item.id === selected.cliEngine)} runtimeName={runtimeLabel(runtimes, selected.cliEngine)} model={selected.model} accountCount={selected.accountIds.length} status={status} activeRun={activeRunsByAgent[selected.id]} permissions={[selected.canModifyCode && '可修改代码', selected.canReview && '可执行评审'].filter(Boolean).join('、') || '只读协作'} snapshots={runtimeSnapshots} projects={projects} loading={runtimeLoading} action={runtimeAction} notice={runtimeNotice} onStop={(projectId) => void controlRuntime('stop', projectId)} onRestart={(projectId) => void controlRuntime('restart', projectId)} />}
        {tab === 'channels' && (selectedChannels.length ? <div className="overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))]">{selectedChannels.map((channel) => <div key={channel.id} className="flex items-center gap-3 border-b border-[hsl(var(--border-subtle))] px-4 py-3 last:border-b-0"><span className="flex size-9 items-center justify-center rounded-lg bg-[hsl(var(--bg-muted))]"><Hash className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{channel.title}</span><span className="mt-1 block text-[11px] text-[hsl(var(--text-tertiary))]">{channel.count} 条 Agent 活动 · 最近 {formatActivityTime(channel.timestamp)}</span></span></div>)}</div> : <EmptyPanel title="还没有频道活动" description="Agent 在某个项目中被触发或回复后，这里会显示真实协作范围。" />)}
        {tab === 'skills' && (selectedSkillNames.length ? <div className="grid gap-2 sm:grid-cols-2">{selectedSkillNames.map((name) => <div key={name} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-3 text-xs"><Sparkles className="size-3.5 text-[hsl(var(--accent))]" />{name}</div>)}</div> : <EmptyPanel title="还没有专属技能" description="编辑 Agent 时可从技能库选择；运行时仍会按当前工作合同裁剪可用能力。" />)}
      </div>
    </section> : <div className="flex flex-1 items-center justify-center"><EmptyPanel title="还没有 Agent" description="创建一个 Agent，为它配置身份、指令和执行环境。" /></div>}
    {libraryView === 'agents' && draft && <AgentDefinitionDialog
      draft={draft}
      dirty={draftFingerprint(draft) !== draftBaseline}
      saving={saving}
      error={error}
      runtimes={runtimes}
      accounts={accounts}
      skills={skills}
      agents={agents}
      onChange={updateDraft}
      onSave={() => void saveAgent()}
      onClose={() => setDraft(null)}
    />}
    {libraryView === 'agents' && messageDraft && selected && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !messageSending) setMessageDraft(null); }}><div role="dialog" aria-modal="true" aria-label={`发消息给 ${selected.name}`} className="w-full max-w-lg overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-2xl">
      <header className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] px-5 py-4"><div><h2 className="text-base font-semibold">发消息给 {selected.name}</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">消息进入项目事件流，并稳定触发这个 Agent。</p></div><button type="button" onClick={() => setMessageDraft(null)} disabled={messageSending} className="flex size-8 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg-muted))]" aria-label="关闭"><X className="size-4" /></button></header>
      <div className="space-y-4 p-5">{error && <div role="alert" className="rounded-lg bg-[hsl(var(--status-rejected-bg))] px-3 py-2 text-xs text-[hsl(var(--status-rejected))]">{error}</div>}<label className="block space-y-1.5"><span className="text-xs font-medium">项目</span><select value={messageDraft.projectId} onChange={(event) => setMessageDraft({ ...messageDraft, projectId: event.target.value })} className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 text-xs outline-none">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="block space-y-1.5"><span className="text-xs font-medium">消息</span><textarea autoFocus rows={5} value={messageDraft.content} onChange={(event) => setMessageDraft({ ...messageDraft, content: event.target.value })} placeholder="告诉它要处理什么；后续过程会保留在项目活动中。" className="w-full resize-y rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[hsl(var(--accent))]" /></label></div>
      <footer className="flex justify-end gap-2 border-t border-[hsl(var(--border-subtle))] px-5 py-4"><button type="button" onClick={() => setMessageDraft(null)} disabled={messageSending} className="h-9 rounded-lg px-3 text-xs hover:bg-[hsl(var(--bg-muted))]">取消</button><button type="button" onClick={() => void sendAgentMessage()} disabled={messageSending} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-4 text-xs font-medium text-[hsl(var(--text-inverse))] disabled:opacity-60">{messageSending && <Loader2 className="size-3.5 animate-spin" />}发送</button></footer>
    </div></div>}
  </main>;
}

function AgentActivityPanel({ agentName, activeRun, activity, conversations, projects }: {
  agentName: string;
  activeRun?: ActiveAgentRun;
  activity: Array<ChatMessage & { conversationId: string }>;
  conversations: Conversation[];
  projects: WorkspaceProject[];
}) {
  function contextName(conversationId: string) {
    const conversation = conversations.find((item) => item.id === conversationId);
    return projects.find((item) => item.workspaceConversationId === conversationId || item.id === conversation?.projectId)?.name
      ?? conversation?.title
      ?? '未知项目';
  }

  if (!activeRun && !activity.length) {
    return <EmptyPanel title="还没有运行活动" description={`${agentName} 开始参与项目工作后，这里会展示接纳状态、工具轨迹和最终回复。`} />;
  }

  return <div className="space-y-3">
    {activeRun && <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/20" aria-label="当前运行">
      <div className="flex items-center gap-2"><span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" /></span><span className="text-xs font-semibold">正在运行</span><span className="ml-auto text-[10px] text-[hsl(var(--text-tertiary))]">{formatActivityTime(activeRun.startedAt)} 开始</span></div>
      <div className="mt-3 grid gap-2 text-[11px] text-[hsl(var(--text-secondary))] sm:grid-cols-2"><span>Project：{contextName(activeRun.conversationId)}</span><span>Activity：{activeRun.activity === 'awaiting_children' ? '等待子 Agent' : '处理事件'}</span><span className="truncate sm:col-span-2" title={activeRun.runId}>Run：{activeRun.runId}</span></div>
    </section>}
    <section className="overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))]">
      {activity.map((message) => <article key={`${message.conversationId}:${message.id}`} className="border-b border-[hsl(var(--border-subtle))] p-4 last:border-b-0">
        <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--text-tertiary))]"><Activity className="size-3" /><span className="font-medium text-[hsl(var(--text-secondary))]">{contextName(message.conversationId)}</span>{message.invocationId && <span className="rounded bg-[hsl(var(--bg-muted))] px-1.5 py-0.5">Invocation</span>}<span className="ml-auto">{formatActivityTime(message.timestamp)}</span></div>
        {message.content && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[hsl(var(--text-secondary))]">{message.content}</p>}
        {(message.toolEvents?.length ?? 0) > 0 && <div className="mt-3 space-y-1.5">{message.toolEvents!.map((event) => <div key={event.id} className="flex items-start gap-2 rounded-lg bg-[hsl(var(--bg-muted))] px-2.5 py-2 text-[10px]"><TerminalSquare className="mt-0.5 size-3 shrink-0" /><span className="min-w-0"><span className="font-medium">{event.label}</span>{event.detail && <span className="ml-1 break-all text-[hsl(var(--text-tertiary))]">{event.detail}</span>}</span></div>)}</div>}
        {message.tokenUsage && <div className="mt-2 text-[10px] text-[hsl(var(--text-tertiary))]">{message.tokenUsage.model} · 输入 {message.tokenUsage.inputTokens} · 输出 {message.tokenUsage.outputTokens}</div>}
      </article>)}
    </section>
  </div>;
}

function RuntimePanel({ runtime, runtimeName, model, accountCount, status, activeRun, permissions, snapshots, projects, loading, action, notice, onStop, onRestart }: {
  runtime?: AgentRuntimeCatalogItem;
  runtimeName: string;
  model?: string;
  accountCount: number;
  status: string;
  activeRun?: ActiveAgentRun;
  permissions: string;
  snapshots: RuntimeSnapshot[];
  projects: WorkspaceProject[];
  loading: boolean;
  action: 'stop' | 'restart' | null;
  notice: { kind: 'status' | 'alert'; message: string } | null;
  onStop(projectId: string): void;
  onRestart(projectId: string): void;
}) {
  return <div className="space-y-4">
    <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4">
      <div className="flex items-start gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--bg-muted))]"><Cpu className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{runtimeName}</h3><span className={cn('rounded-full px-2 py-0.5 text-[10px]', runtime?.available === false ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>{runtime?.available === false ? '不可用' : status}</span></div><p className="mt-1 text-[11px] text-[hsl(var(--text-tertiary))]">{runtime?.available === false ? '本机尚未满足该运行环境的启动条件。' : '状态来自本机目录与当前 Agent 运行投影。'}</p></div></div>
    </section>
    <div className="grid gap-3 sm:grid-cols-2"><InfoCard label="模型" value={model || '使用环境默认模型'} hint={accountCount ? `${accountCount} 个已绑定账号` : '使用运行环境的登录状态'} /><InfoCard label="工作权限" value={permissions} hint="权限由 Agent 自身持有，每轮仍按工作合同裁剪" /><InfoCard label="当前实例" value={activeRun ? '1 个活动实例' : '没有活动实例'} hint={activeRun ? `开始于 ${formatActivityTime(activeRun.startedAt)}` : '被项目事件触发后启动或复用会话'} /><InfoCard label="连接协议" value="ACP" hint="具体命令和进程参数只在脱敏诊断中显示" /></div>
    <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4"><div><h3 className="text-xs font-semibold">运行实例</h3><p className="mt-1 text-[11px] text-[hsl(var(--text-tertiary))]">每个项目独立控制；停止会取消该项目当前处理，重启会建立新一代实例并隔离旧结果。</p></div>{notice && <div role={notice.kind} className={cn('mt-3 rounded-lg px-3 py-2 text-[11px]', notice.kind === 'alert' ? 'bg-[hsl(var(--status-rejected-bg))] text-[hsl(var(--status-rejected))]' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300')}>{notice.message}</div>}{loading ? <div className="mt-3 flex items-center gap-2 text-[11px] text-[hsl(var(--text-tertiary))]"><Loader2 className="size-3 animate-spin" />正在读取实例…</div> : snapshots.length ? <div className="mt-3 space-y-2">{snapshots.map((snapshot) => { const projectName = projectRuntimeLabel(projects, snapshot.key.projectId); return <div key={`${snapshot.key.projectId}:${snapshot.key.runtimeNodeId}`} className="flex items-center gap-3 rounded-lg bg-[hsl(var(--bg-muted))] px-3 py-2 text-[11px]"><span className={cn('size-2 rounded-full', snapshot.acceptingWork ? 'bg-emerald-500' : snapshot.lifecycle === 'failed' ? 'bg-red-500' : 'bg-slate-400')} /><span className="min-w-0 flex-1 truncate"><span className="block truncate">{projectName}</span>{snapshot.workerNames?.length ? <span className="mt-0.5 block truncate text-[10px] text-[hsl(var(--text-tertiary))]">{snapshot.workerNames.join(' · ')}</span> : null}</span><span className="text-right text-[hsl(var(--text-tertiary))]"><span className="block">{snapshot.lifecycle} · {snapshot.readyWorkers}/{snapshot.totalWorkers}</span>{snapshot.reasonCode && <span className="mt-0.5 block font-mono text-[10px]">{snapshot.reasonCode}</span>}</span><span className="flex gap-1"><button type="button" aria-label={`停止 ${projectName}`} onClick={() => onStop(snapshot.key.projectId)} disabled={Boolean(action)} className="inline-flex size-7 items-center justify-center rounded-md border border-[hsl(var(--border))] disabled:opacity-50">{action === 'stop' ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}</button><button type="button" aria-label={`重启 ${projectName}`} onClick={() => onRestart(snapshot.key.projectId)} disabled={Boolean(action)} className="inline-flex size-7 items-center justify-center rounded-md border border-[hsl(var(--border))] disabled:opacity-50">{action === 'restart' ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}</button></span></div>; })}</div> : <p className="mt-3 text-[11px] text-[hsl(var(--text-tertiary))]">尚未启动过。Agent 首次被项目事件触发后，会在这里保留可复用实例。</p>}</section>
    {activeRun && <section className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4"><div className="flex items-center gap-2 text-xs font-semibold"><Clock3 className="size-3.5" />当前会话</div><div className="mt-3 grid gap-2 text-[11px] text-[hsl(var(--text-secondary))]"><div className="break-all">Run：{activeRun.runId}</div><div className="break-all">Conversation：{activeRun.conversationId}</div><div>状态：{activeRun.activity === 'awaiting_children' ? '等待子 Agent' : '处理中'}</div></div></section>}
    <p className="text-[10px] leading-5 text-[hsl(var(--text-tertiary))]">环境变量、凭据和敏感命令参数不会出现在此页面、日志或辅助功能树中。</p>
  </div>;
}

function projectRuntimeLabel(projects: WorkspaceProject[], projectId: string) {
  const name = projects.find((project) => project.id === projectId)?.name;
  if (name) return name;
  return projectId.length > 28 ? `${projectId.slice(0, 12)}…${projectId.slice(-8)}` : projectId;
}

function InfoCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4"><div className="text-[11px] font-medium text-[hsl(var(--text-tertiary))]">{label}</div><div className="mt-2 text-sm font-semibold">{value}</div><div className="mt-1 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">{hint}</div></div>;
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return <div className="mx-auto max-w-md py-16 text-center"><div className="mx-auto flex size-10 items-center justify-center rounded-full bg-[hsl(var(--bg-muted))]"><Bot className="size-4 text-[hsl(var(--text-tertiary))]" /></div><h3 className="mt-3 text-sm font-medium">{title}</h3><p className="mt-1.5 text-xs leading-5 text-[hsl(var(--text-tertiary))]">{description}</p></div>;
}
