'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bot, CalendarClock, Check, ChevronDown, CirclePlay, Clipboard, Code2, Gavel, ListPlus, Pencil, Plus, RefreshCw, Sparkles, X, Zap } from 'lucide-react';
import type { Agent } from '@/store/agentStore';
import type { AutomationAction, AutomationCondition, AutomationRun, AutomationTrigger, ProjectAutomation } from '@/shared/automation';
import { AUTOMATION_EVENT_REGISTRY, automationEventDescriptor } from '@/shared/automation-event-registry';
import type { WorkspaceProject } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';

interface AutomationView extends ProjectAutomation { runs: AutomationRun[] }

export function ProjectAutomationWorkspace({ project, agents }: { project: WorkspaceProject; agents: Agent[] }) {
  const [items, setItems] = useState<AutomationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ProjectAutomation | 'create' | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/automations?projectId=${encodeURIComponent(project.id)}`, { cache: 'no-store' });
      const payload = await response.json() as { automations?: AutomationView[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'automation_load_failed');
      setItems(payload.automations ?? []);
      setError('');
    } catch (cause) {
      setError(userMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!items.some((item) => item.runs.some((run) => run.status === 'pending' || run.status === 'running'))) return;
    const timer = window.setTimeout(() => { void refresh(); }, 900);
    return () => window.clearTimeout(timer);
  }, [items, refresh]);

  async function send(name: 'automation.set_enabled' | 'automation.trigger' | 'automation.retry' | 'automation.decide', automation: ProjectAutomation, input: Record<string, unknown>) {
    setPendingId(automation.id);
    setError('');
    try {
      const commandId = newCommandId();
      const response = await fetch('/api/commands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId, idempotencyKey: commandId, name, projectId: project.id, expectedRevision: automation.revision, input }),
      });
      const receipt = await response.json() as { reasonCode?: string };
      if (!response.ok) throw new Error(receipt.reasonCode ?? 'automation_command_failed');
      await refresh();
    } catch (cause) {
      setError(userMessage(cause));
    } finally {
      setPendingId(null);
    }
  }

  async function copyDefinition(automation: ProjectAutomation) {
    try {
      const response = await fetch('/api/automation-definition', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: { name: automation.name, description: automation.description, trigger: automation.trigger, actions: automation.actions } }),
      });
      const payload = await response.json() as { document?: string; error?: string };
      if (!response.ok || !payload.document) throw new Error(payload.error ?? 'automation_document_invalid');
      await navigator.clipboard.writeText(payload.document);
      setError('');
    } catch (cause) { setError(userMessage(cause)); }
  }

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))] p-6" aria-label="项目自动化">
    <div className="mx-auto max-w-5xl">
      <header className="flex items-start justify-between gap-4">
        <div><div className="flex items-center gap-2"><Zap className="size-4" /><h3 className="text-sm font-semibold">自动化</h3></div><p className="mt-1 text-xs leading-5 text-[hsl(var(--text-tertiary))]">当项目里发生某件事时，通知项目、交给 Agent，或创建正式工作。</p></div>
        <div className="flex items-center gap-2"><button type="button" onClick={() => void refresh()} className="inline-flex size-9 items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]" aria-label="刷新自动化"><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /></button><button type="button" onClick={() => setEditing('create')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-3 text-xs font-medium text-[hsl(var(--text-inverse))]"><Plus className="size-3.5" />创建自动化</button></div>
      </header>

      {error && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-xs text-red-600">{error}</div>}
      {!loading && items.length === 0 && <button type="button" onClick={() => setEditing('create')} className="mt-6 flex w-full flex-col items-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-6 py-16 text-center hover:border-[hsl(var(--accent))]"><span className="flex size-11 items-center justify-center rounded-xl bg-[hsl(var(--accent-soft))]"><Sparkles className="size-5" /></span><span className="mt-4 text-sm font-medium">创建第一个自动化</span><span className="mt-1.5 max-w-md text-xs leading-5 text-[hsl(var(--text-tertiary))]">例如：评审通过后通知项目，并让指定 Agent 做最终复核。</span></button>}

      <div className="mt-6 grid gap-3 md:grid-cols-2">{items.map((automation) => {
        const latest = automation.runs[0];
        const expanded = expandedId === automation.id;
        return <article key={automation.id} className="overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] shadow-sm">
          <div className="p-4"><div className="flex items-start gap-3"><div className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg', automation.enabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))]')}><Zap className="size-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="truncate text-sm font-medium">{automation.name}</h4><span className={cn('rounded-full px-2 py-0.5 text-[10px]', automation.enabled ? 'bg-emerald-500/10 text-emerald-700' : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))]')}>{automation.enabled ? '已启用' : '未启用'}</span></div><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">{automation.description || automationSummary(automation.trigger, automation.actions, agents)}</p></div><div className="flex shrink-0"><button type="button" onClick={() => void copyDefinition(automation)} className="flex size-8 items-center justify-center rounded-md hover:bg-[hsl(var(--bg-muted))]" aria-label={`复制 ${automation.name} 的定义`}><Clipboard className="size-3.5" /></button><button type="button" onClick={() => setEditing(automation)} className="flex size-8 items-center justify-center rounded-md hover:bg-[hsl(var(--bg-muted))]" aria-label={`编辑 ${automation.name}`}><Pencil className="size-3.5" /></button></div></div>
            <div className="mt-4 rounded-lg bg-[hsl(var(--bg-app))] px-3 py-2.5 text-[11px] leading-5 text-[hsl(var(--text-secondary))]">{automationSummary(automation.trigger, automation.actions, agents)}</div>
            <div className="mt-4 flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-[10px] text-[hsl(var(--text-tertiary))]"><Activity className="size-3" />{latest ? <span>最近：{runStatus(latest.status)} · {formatTime(latest.createdAt)}</span> : <span>尚未运行</span>}</div><div className="flex items-center gap-1"><button type="button" disabled={pendingId === automation.id} onClick={() => void send('automation.trigger', automation, { automationId: automation.id })} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] hover:bg-[hsl(var(--bg-muted))] disabled:opacity-50"><CirclePlay className="size-3.5" />立即运行</button><button type="button" role="switch" aria-checked={automation.enabled} disabled={pendingId === automation.id} onClick={() => void send('automation.set_enabled', automation, { automationId: automation.id, enabled: !automation.enabled })} className={cn('relative h-5 w-9 rounded-full transition-colors disabled:opacity-50', automation.enabled ? 'bg-emerald-500' : 'bg-[hsl(var(--border))]')} aria-label={automation.enabled ? '停用自动化' : '启用自动化'}><span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform', automation.enabled ? 'translate-x-4' : 'translate-x-0.5')} /></button></div></div>
          </div>
          <button type="button" onClick={() => setExpandedId(expanded ? null : automation.id)} className="flex h-9 w-full items-center justify-between border-t border-[hsl(var(--border-subtle))] px-4 text-[10px] text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-card-hover))]"><span>运行记录 {automation.runs.length > 0 ? `(${automation.runs.length})` : ''}</span><ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} /></button>
          {expanded && <RunHistory runs={automation.runs} pending={pendingId === automation.id} onRetry={(runId) => send('automation.retry', automation, { runId })} onDecide={(decisionId, decision) => send('automation.decide', automation, { decisionId, decision })} />}
        </article>;
      })}</div>
    </div>
    {editing && <AutomationDialog project={project} agents={agents} automation={editing === 'create' ? undefined : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); }} />}
  </main>;
}

function RunHistory({ runs, pending, onRetry, onDecide }: { runs: AutomationRun[]; pending: boolean; onRetry: (runId: string) => void | Promise<void>; onDecide: (decisionId: string, decision: 'approved' | 'denied') => void | Promise<void> }) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  if (runs.length === 0) return <div className="border-t border-[hsl(var(--border-subtle))] px-4 py-6 text-center text-[11px] text-[hsl(var(--text-tertiary))]">启用或立即运行后，这里会保留每一次记录。</div>;
  return <div className="border-t border-[hsl(var(--border-subtle))]">{runs.slice(0, 8).map((run) => {
    const expanded = expandedRunId === run.id;
    return <div key={run.id} className="border-b border-[hsl(var(--border-subtle))] last:border-b-0">
      <div className="flex items-start gap-2.5 px-4 py-3">
        <span className={cn('mt-1 size-2 rounded-full', run.status === 'completed' ? 'bg-emerald-500' : run.status === 'failed' ? 'bg-red-500' : 'bg-amber-500')} />
        <button type="button" onClick={() => setExpandedRunId(expanded ? null : run.id)} className="min-w-0 flex-1 text-left" aria-expanded={expanded}>
          <span className="flex items-center justify-between gap-2"><span className="text-[11px] font-medium">{runStatus(run.status)}</span><span className="text-[10px] text-[hsl(var(--text-tertiary))]">{formatTime(run.createdAt)}</span></span>
          <span className="mt-1 block text-[10px] text-[hsl(var(--text-tertiary))]">定义 v{run.definitionRevision ?? 1} · {run.trace.length}/{run.actionsSnapshot?.length ?? run.trace.length} 个步骤{(run.retryCount ?? 0) > 0 ? ` · 已重试 ${run.retryCount} 次` : ''}{run.errorMessage ? ` · ${userMessage(new Error(run.errorMessage))}` : ''}</span>
        </button>
        {run.status === 'failed' && run.errorCode !== 'automation_command_delivery_unknown' && <button type="button" disabled={pending} onClick={() => void onRetry(run.id)} className="inline-flex h-7 items-center gap-1 rounded-md border border-[hsl(var(--border))] px-2 text-[10px] disabled:opacity-40"><RefreshCw className="size-3" />重试</button>}
      </div>
      {expanded && <div className="space-y-2 bg-[hsl(var(--bg-app))] px-4 py-3">{run.trace.length === 0 ? <p className="text-[10px] text-[hsl(var(--text-tertiary))]">尚未开始执行步骤。</p> : run.trace.map((step, index) => {
        const decision = run.decisions?.find((item) => item.stepId === step.stepId);
        return <div key={`${step.stepId}:${index}`} className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-medium">{index + 1}. {actionLabel(step.actionType)}</span><span className="text-[10px] text-[hsl(var(--text-tertiary))]">{stepStatus(step.status)}</span></div><div className="mt-1 text-[10px] text-[hsl(var(--text-tertiary))]">开始 {formatTime(step.startedAt)}{step.completedAt ? ` · 结束 ${formatTime(step.completedAt)}` : ''}</div>{step.error && <p className="mt-1 break-words text-[10px] text-red-600">{userMessage(new Error(step.error))}</p>}{step.output && step.status !== 'waiting_decision' && <p className="mt-1 break-words text-[10px] text-[hsl(var(--text-secondary))]">{safeStepOutput(step.output)}</p>}{decision && <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5"><p className="text-[11px] font-medium">{decision.prompt}</p><p className="mt-1 text-[10px] text-[hsl(var(--text-tertiary))]">{decision.status === 'pending' ? '等待你的决定' : decision.status === 'approved' ? '已批准继续' : '已拒绝并结束本次运行'}</p>{decision.status === 'pending' && <div className="mt-2 flex gap-2"><button type="button" disabled={pending} onClick={() => void onDecide(decision.id, 'approved')} className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[10px] text-white disabled:opacity-40"><Check className="size-3" />批准继续</button><button type="button" disabled={pending} onClick={() => void onDecide(decision.id, 'denied')} className="inline-flex h-7 items-center gap-1 rounded-md border border-[hsl(var(--border))] px-2 text-[10px] disabled:opacity-40"><X className="size-3" />拒绝</button></div>}</div>}</div>;
      })}</div>}
    </div>;
  })}</div>;
}

interface AutomationDraft {
  name: string;
  description: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
}

function AutomationDialog({ project, agents, automation, onClose, onSaved }: { project: WorkspaceProject; agents: Agent[]; automation?: ProjectAutomation; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const initial = useMemo<AutomationDraft>(() => automation ? { name: automation.name, description: automation.description, trigger: automation.trigger, actions: automation.actions } : { name: '', description: '', trigger: { type: 'event', eventType: 'review.decision_recorded', conditions: [] }, actions: [{ id: actionId(), type: 'notify', message: '' }] }, [automation]);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const [definitionCode, setDefinitionCode] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function close() {
    if (dirty && !window.confirm('放弃尚未保存的自动化修改？')) return;
    onClose();
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const commandId = newCommandId();
      const input = automation ? { id: automation.id, ...draft } : draft;
      const response = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId, idempotencyKey: commandId, name: automation ? 'automation.update' : 'automation.create', projectId: project.id, expectedRevision: automation?.revision, input }) });
      const receipt = await response.json() as { reasonCode?: string };
      if (!response.ok) throw new Error(receipt.reasonCode ?? 'automation_save_failed');
      await onSaved();
    } catch (cause) { setError(userMessage(cause)); } finally { setSaving(false); }
  }

  function openDefinitionCode() {
    setDefinitionCode(`${JSON.stringify({ schemaVersion: 1, ...draft }, null, 2)}\n`);
    setCodeOpen(true);
    setError('');
  }

  async function applyDefinitionCode() {
    try {
      const response = await fetch('/api/automation-definition', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: definitionCode }),
      });
      const payload = await response.json() as { definition?: AutomationDraft; document?: string; error?: string };
      if (!response.ok || !payload.definition || !payload.document) throw new Error(payload.error ?? 'automation_document_invalid');
      setDraft(payload.definition);
      setDefinitionCode(payload.document);
      setCodeOpen(false);
      setError('');
    } catch (cause) { setError(userMessage(cause)); }
  }

  function setTriggerType(type: AutomationTrigger['type']) {
    setDraft((value) => ({ ...value, trigger: type === 'event' ? { type, eventType: 'review.decision_recorded', conditions: [] } : type === 'schedule' ? { type, intervalMinutes: 60 } : { type } }));
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label={automation ? '编辑自动化' : '创建自动化'}><section className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-2xl"><header className="flex items-start justify-between border-b border-[hsl(var(--border-subtle))] px-5 py-4"><div><h3 className="text-sm font-semibold">{automation ? '编辑自动化' : '创建自动化'}</h3><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">{project.name} · 创建后默认保持关闭</p></div><div className="flex gap-1"><button type="button" onClick={openDefinitionCode} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] hover:bg-[hsl(var(--bg-muted))]"><Code2 className="size-3.5" />定义代码</button><button type="button" onClick={close} className="flex size-8 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg-muted))]" aria-label="关闭"><X className="size-4" /></button></div></header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      {error && <div className="rounded-lg bg-red-500/8 px-3 py-2 text-xs text-red-600">{error}</div>}
      {codeOpen && <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-3"><div className="flex items-center justify-between"><div><div className="text-xs font-medium">定义代码（JSON）</div><p className="mt-1 text-[10px] text-[hsl(var(--text-tertiary))]">可复制或粘贴另一份定义；应用后仍需保存，导入不会自动启用。</p></div><button type="button" onClick={() => void navigator.clipboard.writeText(definitionCode)} className="inline-flex h-7 items-center gap-1 rounded-md border border-[hsl(var(--border))] px-2 text-[10px]"><Clipboard className="size-3" />复制</button></div><textarea aria-label="自动化定义代码" value={definitionCode} onChange={(event) => setDefinitionCode(event.target.value)} className="mt-3 h-52 w-full resize-y rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-3 font-mono text-[11px] leading-5" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setCodeOpen(false)} className="h-8 rounded-md px-2 text-[10px]">返回表单</button><button type="button" onClick={() => void applyDefinitionCode()} className="h-8 rounded-md bg-[hsl(var(--text-primary))] px-3 text-[10px] text-[hsl(var(--text-inverse))]">校验并应用</button></div></div>}
      <Field label="名称"><input value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} placeholder="例如：评审通过后复核" className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]" /></Field>
      <Field label="说明（可选）"><input value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} placeholder="告诉团队这个自动化为什么存在" className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]" /></Field>
      <Field label="什么时候开始"><div className="grid grid-cols-3 gap-2">{([{ id: 'event', label: '项目发生事件', icon: Zap }, { id: 'schedule', label: '定时', icon: CalendarClock }, { id: 'manual', label: '仅手动', icon: CirclePlay }] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTriggerType(id)} className={cn('flex h-10 items-center justify-center gap-1.5 rounded-lg border text-xs', draft.trigger.type === id ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]')}><Icon className="size-3.5" />{label}</button>)}</div></Field>
      {draft.trigger.type === 'event' && <EventTriggerEditor trigger={draft.trigger} onChange={(trigger) => setDraft((value) => ({ ...value, trigger }))} />}
      {draft.trigger.type === 'schedule' && <Field label="间隔"><div className="flex items-center gap-2"><input type="number" min={1} max={43200} value={draft.trigger.intervalMinutes} onChange={(event) => setDraft((value) => ({ ...value, trigger: { type: 'schedule', intervalMinutes: Number(event.target.value) } }))} className="h-10 w-28 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-3 text-sm" /><span className="text-xs text-[hsl(var(--text-tertiary))]">分钟</span></div></Field>}
      <Field label="接下来做什么"><div className="space-y-2">{draft.actions.map((action, index) => <ActionEditor key={action.id} action={action} agents={agents} index={index} onChange={(next) => setDraft((value) => ({ ...value, actions: value.actions.map((item) => item.id === action.id ? next : item) }))} onRemove={draft.actions.length > 1 ? () => setDraft((value) => ({ ...value, actions: value.actions.filter((item) => item.id !== action.id) })) : undefined} />)}<div className="flex flex-wrap gap-2"><button type="button" onClick={() => setDraft((value) => ({ ...value, actions: [...value.actions, { id: actionId(), type: 'notify', message: '' }] }))} className="inline-flex h-8 items-center gap-1 rounded-md border border-[hsl(var(--border))] px-2 text-[11px]"><Plus className="size-3" />通知项目</button><button type="button" onClick={() => setDraft((value) => ({ ...value, actions: [...value.actions, { id: actionId(), type: 'dispatch_agent', agentId: agents[0]?.id ?? '', prompt: '' }] }))} className="inline-flex h-8 items-center gap-1 rounded-md border border-[hsl(var(--border))] px-2 text-[11px]"><Bot className="size-3" />交给 Agent</button><button type="button" onClick={() => setDraft((value) => ({ ...value, actions: [...value.actions, { id: actionId(), type: 'product_command', command: { name: 'work.create', input: { title: '', category: 'change_request', description: '' } } }] }))} className="inline-flex h-8 items-center gap-1 rounded-md border border-[hsl(var(--border))] px-2 text-[11px]"><ListPlus className="size-3" />创建工作</button><button type="button" onClick={() => setDraft((value) => ({ ...value, actions: [...value.actions, { id: actionId(), type: 'request_decision', prompt: '' }] }))} className="inline-flex h-8 items-center gap-1 rounded-md border border-[hsl(var(--border))] px-2 text-[11px]"><Gavel className="size-3" />等待决定</button></div></div></Field>
      <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-3"><div className="text-[10px] font-medium text-[hsl(var(--text-tertiary))]">运行预览</div><p className="mt-1.5 text-xs leading-5">{automationSummary(draft.trigger, draft.actions, agents)}</p></div>
    </div>
    <footer className="flex items-center justify-between border-t border-[hsl(var(--border-subtle))] px-5 py-3"><span className="text-[10px] text-[hsl(var(--text-tertiary))]">保存后不会立即触发，需要你明确启用。</span><div className="flex gap-2"><button type="button" onClick={close} className="h-9 rounded-lg px-3 text-xs hover:bg-[hsl(var(--bg-muted))]">取消</button><button type="button" disabled={saving || !draft.name.trim()} onClick={() => void save()} className="h-9 rounded-lg bg-[hsl(var(--text-primary))] px-4 text-xs font-medium text-[hsl(var(--text-inverse))] disabled:opacity-40">{saving ? '保存中…' : '保存自动化'}</button></div></footer></section></div>;
}

function EventTriggerEditor({ trigger, onChange }: { trigger: Extract<AutomationTrigger, { type: 'event' }>; onChange: (trigger: Extract<AutomationTrigger, { type: 'event' }>) => void }) {
  const condition = trigger.conditions[0];
  const descriptor = automationEventDescriptor(trigger.eventType) ?? AUTOMATION_EVENT_REGISTRY[0];
  const defaultField = descriptor.fields[0]?.id ?? 'actor.id';
  return <div className="grid gap-4 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-3 sm:grid-cols-2"><Field label="事件"><select aria-label="触发事件" value={trigger.eventType} onChange={(event) => onChange({ ...trigger, eventType: event.target.value, conditions: [] })} className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs">{AUTOMATION_EVENT_REGISTRY.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}</select></Field><Field label="条件（可选）"><select aria-label="是否添加触发条件" value={condition ? 'condition' : 'none'} onChange={(event) => onChange({ ...trigger, conditions: event.target.value === 'none' ? [] : [{ field: defaultField, operator: 'equals', value: '' }] })} className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs"><option value="none">任何情况</option><option value="condition">满足一个条件</option></select></Field>{condition && <><select aria-label="条件字段" value={condition.field} onChange={(event) => onChange({ ...trigger, conditions: [{ ...condition, field: event.target.value as AutomationCondition['field'] }] })} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs">{descriptor.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select><div className="flex gap-2"><select aria-label="条件判断" value={condition.operator} onChange={(event) => onChange({ ...trigger, conditions: [{ ...condition, operator: event.target.value as AutomationCondition['operator'] }] })} className="h-10 w-28 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-2 text-xs"><option value="equals">等于</option><option value="not_equals">不等于</option><option value="contains">包含</option></select><input aria-label="条件值" value={condition.value} onChange={(event) => onChange({ ...trigger, conditions: [{ ...condition, value: event.target.value }] })} placeholder="值" className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs" /></div></>}</div>;
}

function ActionEditor({ action, agents, index, onChange, onRemove }: { action: AutomationAction; agents: Agent[]; index: number; onChange: (action: AutomationAction) => void; onRemove?: () => void }) {
  function changeType(type: AutomationAction['type']) {
    if (type === 'notify') onChange({ id: action.id, type, message: '' });
    else if (type === 'dispatch_agent') onChange({ id: action.id, type, agentId: agents[0]?.id ?? '', prompt: '' });
    else if (type === 'product_command') onChange({ id: action.id, type, command: { name: 'work.create', input: { title: '', category: 'change_request', description: '' } } });
    else onChange({ id: action.id, type, prompt: '' });
  }
  return <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-medium text-[hsl(var(--text-tertiary))]">步骤 {index + 1}</span>{onRemove && <button type="button" onClick={onRemove} className="text-[10px] text-red-500">移除</button>}</div><div className="mt-2 flex gap-2"><select value={action.type} onChange={(event) => changeType(event.target.value as AutomationAction['type'])} className="h-10 w-32 shrink-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-2 text-xs"><option value="notify">通知项目</option><option value="dispatch_agent">交给 Agent</option><option value="product_command">创建工作</option><option value="request_decision">等待决定</option></select>{action.type === 'notify' ? <input value={action.message} onChange={(event) => onChange({ ...action, message: event.target.value })} placeholder="通知内容" className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs" /> : action.type === 'dispatch_agent' ? <div className="flex min-w-0 flex-1 gap-2"><select value={action.agentId} onChange={(event) => onChange({ ...action, agentId: event.target.value })} className="h-10 w-32 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-2 text-xs">{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.emoji} {agent.name}</option>)}</select><input value={action.prompt} onChange={(event) => onChange({ ...action, prompt: event.target.value })} placeholder="交给 Agent 的要求" className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs" /></div> : action.type === 'product_command' ? <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_130px]"><input value={action.command.input.title} onChange={(event) => onChange({ ...action, command: { ...action.command, input: { ...action.command.input, title: event.target.value } } })} placeholder="工作标题" className="h-10 min-w-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs" /><select value={action.command.input.category} onChange={(event) => onChange({ ...action, command: { ...action.command, input: { ...action.command.input, category: event.target.value as 'issue' | 'change_request' | 'improvement' } } })} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-2 text-xs"><option value="change_request">变更</option><option value="issue">问题</option><option value="improvement">改进</option></select><input value={action.command.input.description ?? ''} onChange={(event) => onChange({ ...action, command: { ...action.command, input: { ...action.command.input, description: event.target.value } } })} placeholder="说明（可选）" className="h-9 min-w-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs sm:col-span-2" /></div> : <input value={action.prompt} onChange={(event) => onChange({ ...action, prompt: event.target.value })} placeholder="需要你决定什么" className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs" />}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="block"><div className="mb-1.5 text-[11px] font-medium text-[hsl(var(--text-secondary))]">{label}</div>{children}</div>; }

function automationSummary(trigger: AutomationTrigger, actions: AutomationAction[], agents: Agent[]): string {
  const when = trigger.type === 'manual' ? '手动运行时' : trigger.type === 'schedule' ? `每 ${trigger.intervalMinutes} 分钟` : `当“${eventLabel(trigger.eventType)}”时${trigger.conditions.length ? '，且条件满足' : ''}`;
  const then = actions.map((action) => action.type === 'notify'
    ? '通知项目'
    : action.type === 'dispatch_agent'
      ? `交给 ${agents.find((agent) => agent.id === action.agentId)?.name ?? 'Agent'}`
      : action.type === 'product_command'
        ? '创建正式工作'
        : '等待你的决定').join('，然后');
  return `${when}，${then || '执行动作'}。`;
}

function eventLabel(type: string): string { return automationEventDescriptor(type)?.label ?? type; }
function runStatus(status: AutomationRun['status']): string { return ({ pending: '等待执行', running: '运行中', waiting_decision: '等待决定', completed: '已完成', failed: '失败', cancelled: '已取消', skipped: '已跳过' } as Record<AutomationRun['status'], string>)[status]; }
function actionLabel(type: AutomationAction['type']): string { return ({ notify: '通知项目', dispatch_agent: '交给 Agent', product_command: '创建正式工作', request_decision: '等待决定' } as const)[type]; }
function stepStatus(status: AutomationRun['trace'][number]['status']): string { return ({ running: '执行中', waiting_decision: '等待决定', completed: '已完成', failed: '失败', cancelled: '已取消' } as const)[status]; }
function safeStepOutput(output: Record<string, unknown>): string { return Object.entries(output).map(([key, value]) => `${key}: ${String(value)}`).join(' · '); }
function formatTime(value: string): string { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function actionId(): string { return `step-${Math.random().toString(36).slice(2, 9)}`; }
function newCommandId(): string { return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function userMessage(cause: unknown): string { const code = cause instanceof Error ? cause.message : String(cause); return ({ automation_name_required: '请填写自动化名称', automation_actions_required: '至少添加一个动作', automation_condition_value_required: '请填写条件值', automation_name_conflict: '这个项目中已有同名自动化', automation_revision_conflict: '自动化已被其他操作更新，请刷新后重试', automation_agent_not_found: '目标 Agent 不存在，请重新选择', automation_work_title_required: '请填写要创建的工作标题', automation_decision_prompt_required: '请填写需要决定的内容', automation_decision_conflict: '这个决定已经以另一种结果处理', automation_document_json_invalid: '定义代码不是有效 JSON', automation_document_version_unsupported: '定义代码版本不受支持', automation_document_unknown_field: '定义代码包含不允许的字段', project_not_found: '项目不存在或已被删除' } as Record<string, string>)[code.split(':')[0]] ?? `操作失败：${code}`; }
