'use client';

import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  Cpu,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import type { AgentRuntimeCatalogItem } from '@/lib/agent-runtime-catalog-client';
import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import type { Account, Agent } from '@/store/agentStore';
import type { SkillSummary } from '@/lib/agent-context/types';
import { cn } from '@/lib/utils';
import type { AgentResponsibility } from '@/shared/agent-definition';

export interface AgentDefinitionDraft {
  saveKey: string;
  id?: string;
  revision?: number;
  name: string;
  instructions: string;
  responsibility?: AgentResponsibility;
  runtimeId: RuntimeCliEngine;
  accountIds: string[];
  model: string;
  skillIds: string[];
  emoji: string;
  theme: Agent['theme'];
  customExecution: boolean;
  canModifyCode: boolean;
  canReview: boolean;
  audienceMode: NonNullable<Agent['audienceMode']>;
  audienceIds: string[];
  parallelism: string;
  instanceNamePool: string[];
  runLocation: 'local';
}

interface AgentDefinitionDialogProps {
  draft: AgentDefinitionDraft;
  dirty: boolean;
  saving: boolean;
  error: string;
  runtimes: AgentRuntimeCatalogItem[];
  accounts: Account[];
  skills: Array<SkillSummary & { id: string }>;
  agents: Agent[];
  onChange(next: AgentDefinitionDraft): void;
  onSave(): void;
  onClose(): void;
}

type AgentSnapshot = Partial<{
  name: string;
  instructions: string;
  responsibility: AgentResponsibility;
  emoji: string;
  runtimeId: string;
  model: string;
  skillIds: string[];
  audienceMode: NonNullable<Agent['audienceMode']>;
  audienceIds: string[];
  parallelism: number;
  instanceNamePool: string[];
  permissions: { canModifyCode?: boolean; canReview?: boolean };
}>;

export function AgentDefinitionDialog({
  draft,
  dirty,
  saving,
  error,
  runtimes,
  accounts,
  skills,
  agents,
  onChange,
  onSave,
  onClose,
}: AgentDefinitionDialogProps) {
  const [pane, setPane] = useState<'create' | 'import'>('create');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedRuntime = runtimes.find((runtime) => runtime.id === draft.runtimeId);
  const advancedConfigured = draft.audienceMode !== 'owner'
    || draft.parallelism !== ''
    || draft.instanceNamePool.length > 0
    || draft.skillIds.length > 0
    || draft.canModifyCode
    || draft.canReview;
  const [advancedOpen, setAdvancedOpen] = useState(advancedConfigured);
  const modelSuggestions = useMemo(() => [...new Set(accounts.flatMap((account) => account.models))], [accounts]);
  const parsedParallelism = draft.parallelism === '' ? undefined : Number(draft.parallelism);
  const formValid = Boolean(
    draft.name.trim()
    && draft.instructions.trim()
    && (!draft.customExecution || selectedRuntime?.available)
    && (draft.audienceMode !== 'selected' || draft.audienceIds.length > 0)
    && (parsedParallelism === undefined || (Number.isSafeInteger(parsedParallelism) && parsedParallelism >= 1 && parsedParallelism <= 32)),
  );

  function requestClose() {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  function switchPane(next: 'create' | 'import') {
    if (next === pane) return;
    // The creation draft remains mounted while browsing import options. Merely
    // switching creation sources must not be treated as deleting local data.
    setPane(next);
  }

  async function readSnapshot(file: File) {
    setImportError('');
    try {
      if (file.size > 1_000_000) throw new Error('Agent 文件不能超过 1 MB。');
      const parsed = JSON.parse(await file.text()) as AgentSnapshot;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string' || typeof parsed.instructions !== 'string') {
        throw new Error('这不是有效的 Agent 文件：缺少名称或工作指令。');
      }
      const runtimeId = typeof parsed.runtimeId === 'string' && runtimes.some((runtime) => runtime.id === parsed.runtimeId)
        ? parsed.runtimeId as RuntimeCliEngine
        : draft.runtimeId;
      const audienceMode = ['owner', 'anyone', 'selected'].includes(parsed.audienceMode ?? '')
        ? parsed.audienceMode!
        : 'owner';
      onChange({
        ...draft,
        id: undefined,
        revision: undefined,
        name: parsed.name.slice(0, 120),
        instructions: parsed.instructions.slice(0, 20_000),
        responsibility: ['coordinator', 'implementer', 'reviewer', 'specialist'].includes(parsed.responsibility ?? '')
          ? parsed.responsibility!
          : 'specialist',
        emoji: typeof parsed.emoji === 'string' ? parsed.emoji.slice(0, 4) : draft.emoji,
        runtimeId,
        customExecution: typeof parsed.runtimeId === 'string',
        model: typeof parsed.model === 'string' ? parsed.model.slice(0, 200) : '',
        skillIds: Array.isArray(parsed.skillIds)
          ? parsed.skillIds.filter((id): id is string => typeof id === 'string' && skills.some((skill) => skill.id === id))
          : [],
        audienceMode,
        audienceIds: Array.isArray(parsed.audienceIds)
          ? parsed.audienceIds.filter((id): id is string => typeof id === 'string' && agents.some((agent) => agent.id === id))
          : [],
        parallelism: Number.isSafeInteger(parsed.parallelism) ? String(parsed.parallelism) : '',
        instanceNamePool: Array.isArray(parsed.instanceNamePool)
          ? parsed.instanceNamePool.filter((name): name is string => typeof name === 'string').map((name) => name.trim()).filter(Boolean).slice(0, 32)
          : [],
        canModifyCode: Boolean(parsed.permissions?.canModifyCode),
        canReview: Boolean(parsed.permissions?.canReview),
      });
      setPane('create');
      setAdvancedOpen(true);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : 'Agent 文件读取失败。');
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void readSnapshot(file);
  }

  return <div
    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label={draft.id ? '编辑 Agent' : '添加 Agent'}
      className="flex h-[min(820px,92vh)] w-full max-w-5xl overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-2xl"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); requestClose(); } }}
    >
      <aside className="flex w-56 shrink-0 flex-col border-r border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4">
        <h2 className="px-2 text-base font-semibold">{draft.id ? '编辑 Agent' : '添加 Agent'}</h2>
        <nav className="mt-5 space-y-1" aria-label="Agent 创建方式">
          <DialogNavButton active={pane === 'create'} icon={<Plus className="size-4" />} onClick={() => switchPane('create')}>创建 Agent</DialogNavButton>
          {!draft.id && <DialogNavButton active={pane === 'import'} icon={<Upload className="size-4" />} onClick={() => switchPane('import')}>导入</DialogNavButton>}
        </nav>
        {!draft.id && <div className="mt-5 border-t border-[hsl(var(--border-subtle))] px-2 pt-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--text-tertiary))]">共享 Agent</div>
          <p className="mt-3 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">还没有共享给你的 Agent</p>
        </div>}
        <div className="mt-auto rounded-xl bg-[hsl(var(--bg-muted))] p-3 text-[10px] leading-5 text-[hsl(var(--text-tertiary))]">
          Agent 是可复用身份；运行实例会在项目首次触发后按需建立。
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--border-subtle))] px-5">
          <div><div className="text-sm font-semibold">{pane === 'create' ? (draft.id ? 'Agent 信息' : '创建 Agent') : '导入 Agent'}</div></div>
          <button type="button" onClick={requestClose} disabled={saving} className="flex size-8 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg-muted))]" aria-label="关闭"><X className="size-4" /></button>
        </header>

        {pane === 'import' ? <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
          <div className="w-full max-w-xl">
            <div
              className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-8 text-center transition-colors hover:border-[hsl(var(--accent))]"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <span className="flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--bg-muted))]"><Upload className="size-5" /></span>
              <h3 className="mt-4 text-sm font-semibold">拖入 .agent.json 文件</h3>
              <p className="mt-2 max-w-sm text-xs leading-5 text-[hsl(var(--text-tertiary))]">文件只会先形成可检查的本地草稿；点击“创建 Agent”前不会保存，也不会启动运行实例。</p>
              <button type="button" onClick={() => fileInput.current?.click()} className="mt-5 h-9 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-4 text-xs font-medium">选择文件</button>
              <input ref={fileInput} type="file" accept=".agent.json,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readSnapshot(file); event.target.value = ''; }} />
            </div>
            {importError && <div role="alert" className="mt-4 rounded-lg bg-[hsl(var(--status-rejected-bg))] px-3 py-2 text-xs text-[hsl(var(--status-rejected))]">{importError}</div>}
          </div>
        </div> : <>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
            <div className="mx-auto max-w-2xl space-y-6">
              {error && <div role="alert" className="rounded-lg bg-[hsl(var(--status-rejected-bg))] px-3 py-2 text-xs text-[hsl(var(--status-rejected))]">{error}</div>}

              <div className="grid gap-5 sm:grid-cols-[128px_minmax(0,1fr)]">
                <label className="space-y-2"><span className="text-xs font-medium">头像</span><span className="flex aspect-square w-full items-center justify-center rounded-full border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg-app))]"><input value={draft.emoji} onChange={(event) => onChange({ ...draft, emoji: event.target.value.slice(0, 4) })} className="h-16 w-20 bg-transparent text-center text-4xl outline-none" aria-label="Agent 头像" /></span></label>
                <div className="space-y-4">
                  <label className="block space-y-1.5"><span className="text-xs font-medium">Agent 名称</span><input autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="例如：代码审查员" maxLength={120} className="h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]" /></label>
                  <label className="block space-y-1.5"><span className="text-xs font-medium">主要职责</span><select value={draft.responsibility ?? 'specialist'} onChange={(event) => onChange({ ...draft, responsibility: event.target.value as AgentResponsibility })} className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 text-xs"><option value="coordinator">协调与分派</option><option value="implementer">实现工作</option><option value="reviewer">评审与验证</option><option value="specialist">专业支持</option></select><span className="block text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">它决定 Agent 接到消息后先规划、实现还是评审；工作指令不能自行扩大权限。</span></label>
                  <label className="block space-y-1.5"><span className="text-xs font-medium">工作指令</span><textarea value={draft.instructions} onChange={(event) => onChange({ ...draft, instructions: event.target.value })} placeholder="描述它负责什么、如何协作、什么情况下需要向你确认……" rows={6} maxLength={20_000} className="w-full resize-y rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[hsl(var(--accent))]" /></label>
                </div>
              </div>

              <section className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium"><Sparkles className="size-3.5" />AI 配置</div>
                <div className="grid grid-cols-2 rounded-xl bg-[hsl(var(--bg-muted))] p-1">
                  <button type="button" onClick={() => onChange({ ...draft, customExecution: false, accountIds: [] })} className={cn('h-9 rounded-lg text-xs transition-colors', !draft.customExecution ? 'bg-[hsl(var(--bg-elevated))] font-medium shadow-sm' : 'text-[hsl(var(--text-tertiary))]')}>使用 Agent 默认值</button>
                  <button type="button" onClick={() => onChange({ ...draft, customExecution: true })} className={cn('h-9 rounded-lg text-xs transition-colors', draft.customExecution ? 'bg-[hsl(var(--bg-elevated))] font-medium shadow-sm' : 'text-[hsl(var(--text-tertiary))]')}>为此 Agent 单独配置</button>
                </div>
                <p className="text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">{draft.customExecution ? '此 Agent 使用下面的 Harness 和模型；账号仍由全局资源统一管理。' : '跟随本机 Agent 默认 Harness、模型和登录状态；以后修改默认值时无需逐个编辑。'}</p>
              </section>

              {draft.customExecution && <section className="space-y-4 rounded-2xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4">
                <label className="block space-y-1.5"><span className="flex items-center gap-2 text-xs font-medium"><Cpu className="size-3.5" />Agent Harness</span><select value={draft.runtimeId} onChange={(event) => onChange({ ...draft, runtimeId: event.target.value as RuntimeCliEngine, accountIds: [], model: '' })} className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs outline-none">{runtimes.map((runtime) => <option key={runtime.id} value={runtime.id} disabled={!runtime.available}>{runtime.label}{runtime.available ? '' : '（未安装）'}</option>)}</select></label>
                {selectedRuntime && !selectedRuntime.available && <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">{selectedRuntime.label} 尚未在本机就绪，请先在设置中完成安装或选择其他 Harness。</div>}
                <label className="block space-y-1.5"><span className="text-xs font-medium">模型</span><input list="agent-model-suggestions" value={draft.model} onChange={(event) => onChange({ ...draft, model: event.target.value })} placeholder="使用 Harness 默认模型，或输入自定义模型" className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 text-xs outline-none" /><datalist id="agent-model-suggestions">{modelSuggestions.map((model) => <option key={model} value={model} />)}</datalist></label>
                {accounts.some((account) => account.enabled) && <fieldset><legend className="text-xs font-medium">模型账号（可选）</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{accounts.filter((account) => account.enabled).map((account) => <label key={account.id} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-elevated))] px-3 py-2 text-xs"><input type="checkbox" checked={draft.accountIds.includes(account.id)} onChange={() => onChange({ ...draft, accountIds: draft.accountIds.includes(account.id) ? draft.accountIds.filter((id) => id !== account.id) : [...draft.accountIds, account.id] })} />{account.name}</label>)}</div></fieldset>}
              </section>}

              <section className="border-t border-[hsl(var(--border-subtle))] pt-5">
                <button type="button" onClick={() => setAdvancedOpen((open) => !open)} className="flex w-full items-center gap-2 text-left text-xs font-semibold" aria-expanded={advancedOpen}>高级{advancedConfigured && <span className="rounded-full bg-[hsl(var(--accent-soft))] px-2 py-0.5 text-[10px] text-[hsl(var(--accent))]">已配置</span>}<ChevronDown className={cn('ml-auto size-4 transition-transform', advancedOpen && 'rotate-180')} /></button>
                {advancedOpen && <div className="mt-5 space-y-5">
                  <label className="block space-y-1.5"><span className="flex items-center gap-2 text-xs font-medium"><UserRound className="size-3.5" />谁可以向它发送指令</span><select value={draft.audienceMode} onChange={(event) => onChange({ ...draft, audienceMode: event.target.value as NonNullable<Agent['audienceMode']>, audienceIds: [] })} className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 text-xs"><option value="owner">仅我与受管 Agent（默认）</option><option value="anyone">项目中的任何成员</option><option value="selected">指定 Agent</option></select><span className="block text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">{draft.audienceMode === 'owner' ? '外部成员的提及不会触发它。' : draft.audienceMode === 'anyone' ? '加入项目的成员都能通过协作流触发它。' : '只有你和下面选中的 Agent 能触发它。'}</span></label>
                  {draft.audienceMode === 'selected' && <fieldset><legend className="text-[11px] font-medium">允许的 Agent</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{agents.filter((agent) => agent.id !== draft.id).map((agent) => { const checked = draft.audienceIds.includes(agent.id); return <label key={agent.id} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border-subtle))] px-3 py-2 text-xs"><input type="checkbox" checked={checked} onChange={() => onChange({ ...draft, audienceIds: checked ? draft.audienceIds.filter((id) => id !== agent.id) : [...draft.audienceIds, agent.id] })} /><span>{agent.emoji}</span><span className="truncate">{agent.name}</span>{checked && <Check className="ml-auto size-3 text-[hsl(var(--accent))]" />}</label>; })}</div></fieldset>}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5"><span className="text-xs font-medium">并行度 <span className="font-normal text-[hsl(var(--text-tertiary))]">可选</span></span><input type="number" min={1} max={32} value={draft.parallelism} onChange={(event) => onChange({ ...draft, parallelism: event.target.value })} placeholder="使用应用默认值" className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 text-xs" /><span className="block text-[10px] leading-4 text-[hsl(var(--text-tertiary))]">1–32；每个实例同一时刻只处理一个会话。</span></label>
                    <label className="space-y-1.5"><span className="text-xs font-medium">实例名称池 <span className="font-normal text-[hsl(var(--text-tertiary))]">可选</span></span><input value={draft.instanceNamePool.join(', ')} onChange={(event) => onChange({ ...draft, instanceNamePool: event.target.value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 32) })} placeholder="Birch, Compass, Ridge" className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 text-xs" /><span className="block text-[10px] leading-4 text-[hsl(var(--text-tertiary))]">用逗号分隔，帮助识别并行实例。</span></label>
                  </div>
                  {skills.length > 0 && <fieldset><legend className="flex items-center gap-2 text-xs font-medium"><Sparkles className="size-3.5" />技能</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{skills.map((skill) => { const checked = draft.skillIds.includes(skill.id); return <label key={skill.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[hsl(var(--border-subtle))] px-3 py-2 text-xs"><input type="checkbox" checked={checked} onChange={() => onChange({ ...draft, skillIds: checked ? draft.skillIds.filter((id) => id !== skill.id) : [...draft.skillIds, skill.id] })} /><span className="truncate">{skill.name}</span>{checked && <Check className="ml-auto size-3 text-[hsl(var(--accent))]" />}</label>; })}</div></fieldset>}
                  <fieldset><legend className="flex items-center gap-2 text-xs font-medium"><ShieldCheck className="size-3.5" />工作权限</legend><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border-subtle))] px-3 py-2 text-xs"><input type="checkbox" checked={draft.canModifyCode} onChange={(event) => onChange({ ...draft, canModifyCode: event.target.checked })} />可以修改代码</label><label className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border-subtle))] px-3 py-2 text-xs"><input type="checkbox" checked={draft.canReview} onChange={(event) => onChange({ ...draft, canReview: event.target.checked })} />可以执行独立评审</label></div></fieldset>
                  <div className="rounded-xl bg-[hsl(var(--bg-muted))] p-3 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">凭据和私密环境配置由模型账号统一管理，不保存在 Agent 文件、运行日志或可访问性树中。</div>
                </div>}
              </section>
            </div>
          </div>
          <footer className="flex h-16 shrink-0 items-center justify-end gap-2 border-t border-[hsl(var(--border-subtle))] px-5">
            <button type="button" onClick={requestClose} disabled={saving} className="h-9 rounded-lg px-4 text-xs hover:bg-[hsl(var(--bg-muted))]">取消</button>
            <button type="button" onClick={onSave} disabled={saving || !formValid} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-4 text-xs font-medium text-[hsl(var(--text-inverse))] disabled:opacity-45">{saving && <Loader2 className="size-3.5 animate-spin" />}{draft.id ? '保存更改' : '添加 Agent'}</button>
          </footer>
        </>}
      </section>
    </div>

    {confirmDiscard && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-label="放弃 Agent 改动" className="w-full max-w-sm rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-2xl">
        <h3 className="text-sm font-semibold">放弃 Agent 改动？</h3>
        <p className="mt-2 text-xs leading-5 text-[hsl(var(--text-tertiary))]">你对这个 Agent 的更改将丢失。</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" autoFocus onClick={() => setConfirmDiscard(false)} className="h-9 rounded-lg border border-[hsl(var(--border))] px-3 text-xs font-medium">继续编辑</button><button type="button" onClick={onClose} className="h-9 rounded-lg bg-red-600 px-3 text-xs font-medium text-white">放弃改动</button></div>
      </div>
    </div>}
  </div>;
}

function DialogNavButton({ active, icon, children, onClick }: { active: boolean; icon: ReactNode; children: ReactNode; onClick(): void }) {
  return <button type="button" onClick={onClick} className={cn('flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs', active ? 'bg-[hsl(var(--text-primary))] font-medium text-[hsl(var(--text-inverse))]' : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-muted))]')}>{icon}{children}</button>;
}
