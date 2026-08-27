'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Rocket, Trash2, UsersRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTeamPackStore } from '@/store/teamPackStore';
import type { Agent } from '@/store/agentStore';
import type { WorkspaceProject } from '@/store/taskHubStore';
import type { AgentTeamDefinitionInput, TeamPack } from '@/types/teamPack';

interface TeamDraft {
  name: string;
  description: string;
  memberIds: string[];
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || `team-${Date.now()}`;
}

function buildTeamInput(draft: TeamDraft, agents: Agent[], existing?: TeamPack): AgentTeamDefinitionInput {
  const members = draft.memberIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => Boolean(agent));
  const ids = members.map((agent) => agent.id);
  return {
    name: existing?.name ?? slug(draft.name),
    displayName: draft.name.trim(),
    description: draft.description.trim(),
    version: existing?.version ?? '1.0.0',
    tags: existing?.tags ?? [],
    category: existing?.category ?? 'agent-team',
    teamMode: existing?.teamMode ?? 'hub_spoke',
    members: members.map((agent) => ({ agentId: agent.id, required: true })),
    workflow: existing?.workflow ?? {
      type: 'linear',
      description: '成员根据项目事件和工作合同协作。',
      steps: members.map((agent) => ({
        role: agent.id,
        action: '处理被接纳的项目事件',
        output: '结构化工作结果',
      })),
    },
    communicationMatrix: Object.fromEntries(ids.map((id) => [id, {
      canSendTo: ids.filter((target) => target !== id),
      canReceiveFrom: ids.filter((source) => source !== id),
    }])),
    sharedContext: existing?.sharedContext ?? { state: ['project', 'channel', 'work', 'review'] },
    rules: existing?.rules ?? { requireEvidence: true, autoAssign: false },
  };
}

function TeamEditor({
  team,
  agents,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  team: TeamPack | null;
  agents: Agent[];
  saving: boolean;
  error: string;
  onClose(): void;
  onSubmit(draft: TeamDraft): void;
}) {
  const initial = useMemo<TeamDraft>(() => ({
    name: team?.displayName ?? '',
    description: team?.description ?? '',
    memberIds: team?.roles.map((member) => member.id).filter((id) => agents.some((agent) => agent.id === id)) ?? [],
  }), [agents, team]);
  const [draft, setDraft] = useState(initial);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function requestClose() {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  return <>
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={team ? '编辑 Agent Team' : '新建 Agent Team'} className="w-full max-w-xl overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] px-5 py-4"><div><h2 className="text-base font-semibold">{team ? '编辑 Agent Team' : '新建 Agent Team'}</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">团队只引用已有 Agent，不复制身份、技能或运行配置。</p></div><button type="button" onClick={requestClose} aria-label="关闭" className="flex size-8 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg-muted))]"><X className="size-4" /></button></header>
        <div className="space-y-4 p-5">
          {error && <div role="alert" className="rounded-lg bg-[hsl(var(--status-rejected-bg))] px-3 py-2 text-xs text-[hsl(var(--status-rejected))]">{error}</div>}
          <label className="block space-y-1.5"><span className="text-xs font-medium">团队名称</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：产品交付小组" className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-medium">说明（可选）</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]" /></label>
          <fieldset><legend className="text-xs font-medium">选择 Agent</legend><div className="mt-2 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">{agents.map((agent) => { const checked = draft.memberIds.includes(agent.id); return <label key={agent.id} className={cn('flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-xs', checked ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))]' : 'border-[hsl(var(--border-subtle))]')}><input type="checkbox" checked={checked} onChange={() => setDraft({ ...draft, memberIds: checked ? draft.memberIds.filter((id) => id !== agent.id) : [...draft.memberIds, agent.id] })} /><span className="text-base">{agent.emoji}</span><span className="min-w-0 flex-1 truncate font-medium">{agent.name}</span><span className="text-[10px] text-[hsl(var(--text-tertiary))]">{agent.skillIds.length} 技能</span></label>; })}</div></fieldset>
        </div>
        <footer className="flex justify-end gap-2 border-t border-[hsl(var(--border-subtle))] px-5 py-4"><button type="button" onClick={requestClose} disabled={saving} className="h-9 rounded-lg px-3 text-xs hover:bg-[hsl(var(--bg-muted))]">取消</button><button type="button" onClick={() => onSubmit(draft)} disabled={saving || !draft.name.trim() || draft.memberIds.length === 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-4 text-xs font-medium text-[hsl(var(--text-inverse))] disabled:opacity-50">{saving && <Loader2 className="size-3.5 animate-spin" />}{team ? '保存团队' : '创建团队'}</button></footer>
      </div>
    </div>
    {confirmDiscard && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4" role="presentation"><div role="alertdialog" aria-modal="true" aria-label="放弃团队改动" className="w-full max-w-sm rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-2xl"><h3 className="text-sm font-semibold">放弃团队改动？</h3><p className="mt-2 text-xs text-[hsl(var(--text-tertiary))]">当前名称、说明和成员选择将丢失。</p><div className="mt-5 flex justify-end gap-2"><button type="button" autoFocus onClick={() => setConfirmDiscard(false)} className="h-9 rounded-lg border border-[hsl(var(--border))] px-3 text-xs">继续编辑</button><button type="button" onClick={onClose} className="h-9 rounded-lg bg-red-600 px-3 text-xs text-white">放弃改动</button></div></div></div>}
  </>;
}

export function SettingsTeamPacksTab({ agentOptions = [], deploymentTargets = [] }: { agentOptions?: Agent[]; deploymentTargets?: WorkspaceProject[] }) {
  const teamPacks = useTeamPackStore((state) => state.teamPacks);
  const loading = useTeamPackStore((state) => state.isLoading);
  const storeError = useTeamPackStore((state) => state.error);
  const fetchTeamPacks = useTeamPackStore((state) => state.fetchTeamPacks);
  const createTeamPack = useTeamPackStore((state) => state.createTeamPack);
  const updateTeamPack = useTeamPackStore((state) => state.updateTeamPack);
  const deleteTeamPack = useTeamPackStore((state) => state.deleteTeamPack);
  const [editorTeam, setEditorTeam] = useState<TeamPack | null | undefined>(undefined);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deployingTeam, setDeployingTeam] = useState<TeamPack | null>(null);
  const [deployProjectId, setDeployProjectId] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => { void fetchTeamPacks(); }, [fetchTeamPacks]);

  async function saveTeam(draft: TeamDraft) {
    setEditorSaving(true);
    setEditorError('');
    try {
      const input = buildTeamInput(draft, agentOptions, editorTeam ?? undefined);
      if (editorTeam) await updateTeamPack(editorTeam.id, input);
      else await createTeamPack(input);
      setEditorTeam(undefined);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : '团队保存失败');
    } finally {
      setEditorSaving(false);
    }
  }

  async function removeTeam(team: TeamPack) {
    if (!window.confirm(`删除“${team.displayName}”？`)) return;
    setDeletingId(team.id);
    await deleteTeamPack(team.id);
    setDeletingId(null);
  }

  function openDeploy(team: TeamPack) {
    setDeployingTeam(team);
    setDeployProjectId(deploymentTargets[0]?.id ?? '');
    setDeployError('');
  }

  async function deploy() {
    if (!deployingTeam || !deployProjectId) return;
    const project = deploymentTargets.find((item) => item.id === deployProjectId);
    if (!project) return;
    setDeploying(true);
    setDeployError('');
    const commandId = `ui-${crypto.randomUUID()}`;
    try {
      const response = await fetch('/api/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'agent_team.deploy', commandId, idempotencyKey: commandId, projectId: project.id, input: { teamId: deployingTeam.id, channelId: project.workspaceConversationId } }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.reasonCode ?? body.error ?? '部署失败');
      setNotice(`${deployingTeam.displayName} 已部署到 ${project.name}。`);
      setDeployingTeam(null);
    } catch (cause) {
      setDeployError(cause instanceof Error ? cause.message : '部署失败');
    } finally {
      setDeploying(false);
    }
  }

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Agent Teams</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">选择真实 Agent 形成可重复部署的协作组合。</p></div><button type="button" onClick={() => { setEditorError(''); setEditorTeam(null); }} disabled={!agentOptions.length} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-3 text-xs font-medium text-[hsl(var(--text-inverse))] disabled:opacity-50"><Plus className="size-3.5" />新建团队</button></div>
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300">{notice}</div>}
    {loading && teamPacks.length === 0 ? <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin" /></div> : storeError ? <div role="alert" className="rounded-xl bg-[hsl(var(--status-rejected-bg))] p-4 text-xs text-[hsl(var(--status-rejected))]">{storeError}</div> : teamPacks.length === 0 ? <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-10 text-center"><UsersRound className="mx-auto size-5 text-[hsl(var(--text-tertiary))]" /><h3 className="mt-3 text-sm font-medium">还没有 Agent Team</h3><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">从已有 Agent 中选择成员即可创建。</p></div> : <div className="grid gap-3">{teamPacks.map((team) => { const missing = team.roles.filter((member) => !agentOptions.some((agent) => agent.id === member.id)); return <article key={team.id} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-4"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--bg-muted))]"><UsersRound className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold">{team.displayName}</h3>{team.isPreset && <span className="rounded-full bg-[hsl(var(--bg-muted))] px-2 py-0.5 text-[10px]">预设</span>}</div>{team.description && <p className="mt-1 line-clamp-2 text-[11px] text-[hsl(var(--text-tertiary))]">{team.description}</p>}<div className="mt-3 flex flex-wrap gap-1.5">{team.roles.map((member) => { const agent = agentOptions.find((item) => item.id === member.id); return <span key={member.id} className={cn('rounded-full px-2 py-1 text-[10px]', agent ? 'bg-[hsl(var(--bg-muted))]' : 'bg-amber-100 text-amber-800')}>{agent?.emoji} {agent?.name ?? `${member.id}（Agent 已缺失）`}</span>; })}</div>{missing.length > 0 && <p className="mt-2 text-[10px] text-amber-700">缺失的 Agent 不会被运行时临时合成；请编辑团队重新选择成员。</p>}</div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => openDeploy(team)} disabled={!deploymentTargets.length || missing.length > 0} aria-label={`部署 ${team.displayName}`} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] hover:bg-[hsl(var(--bg-muted))] disabled:opacity-40"><Rocket className="size-3.5" />部署</button><button type="button" onClick={() => { setEditorError(''); setEditorTeam(team); }} aria-label={`编辑 ${team.displayName}`} className="flex size-8 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg-muted))]"><Pencil className="size-3.5" /></button>{!team.isPreset && <button type="button" onClick={() => void removeTeam(team)} disabled={deletingId === team.id} aria-label={`删除 ${team.displayName}`} className="flex size-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50">{deletingId === team.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}</button>}</div></div></article>; })}</div>}
    {editorTeam !== undefined && <TeamEditor key={editorTeam?.id ?? 'new'} team={editorTeam} agents={agentOptions} saving={editorSaving} error={editorError} onClose={() => setEditorTeam(undefined)} onSubmit={(draft) => void saveTeam(draft)} />}
    {deployingTeam && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deploying) setDeployingTeam(null); }}><div role="dialog" aria-modal="true" aria-label="部署 Agent Team" className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-2xl"><header className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] px-5 py-4"><div><h2 className="text-base font-semibold">部署 {deployingTeam.displayName}</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">项目会引用这些 Agent 的最新 Definition。</p></div><button type="button" onClick={() => setDeployingTeam(null)} aria-label="关闭" className="flex size-8 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg-muted))]"><X className="size-4" /></button></header><div className="space-y-4 p-5">{deployError && <div role="alert" className="rounded-lg bg-[hsl(var(--status-rejected-bg))] px-3 py-2 text-xs text-[hsl(var(--status-rejected))]">{deployError}</div>}<label className="block space-y-1.5"><span className="text-xs font-medium">目标项目</span><select value={deployProjectId} onChange={(event) => setDeployProjectId(event.target.value)} className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 text-xs"><option value="">选择项目</option>{deploymentTargets.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><footer className="flex justify-end gap-2 border-t border-[hsl(var(--border-subtle))] px-5 py-4"><button type="button" onClick={() => setDeployingTeam(null)} disabled={deploying} className="h-9 rounded-lg px-3 text-xs">取消</button><button type="button" onClick={() => void deploy()} disabled={deploying || !deployProjectId} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-4 text-xs text-[hsl(var(--text-inverse))] disabled:opacity-50">{deploying && <Loader2 className="size-3.5 animate-spin" />}部署</button></footer></div></div>}
  </div>;
}
