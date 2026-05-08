'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useTaskHubStore,
  type Account,
  type AccountAuthMode,
  type AccountProvider,
  PROVIDER_LABELS,
  PROVIDER_OPTIONS,
  MODEL_SUGGESTIONS,
} from '@/store/taskHubStore';
import { TagEditor } from '@/components/ui/TagEditor';
import { cn } from '@/lib/utils';
import { X, Plus, Trash2, Loader2, Zap, Users, Download, GitBranch, Pencil } from 'lucide-react';
import { RoleCardListPage } from '@/components/role-card/RoleCardListPage';
import { RoleCardDetailDrawer } from '@/components/role-card/RoleCardDetailDrawer';
import { RoleCardEditor } from '@/components/role-card/RoleCardEditor';
import { SkillLibrary } from '@/components/skill/SkillLibrary';
import { useTeamPackStore } from '@/store/teamPackStore';
import type { CreateTeamPackInput, TeamPack, TeamPackRole } from '@/types/teamPack';

const AUTH_MODE_OPTIONS: Array<{ value: AccountAuthMode; label: string }> = [
  { value: 'oauth', label: 'OAuth' },
  { value: 'api_key', label: 'API Key' },
];

const STATUS_CONFIG: Record<Account['status'], { dot: string; label: string }> = {
  valid:   { dot: 'bg-emerald-400', label: '已验证' },
  error:   { dot: 'bg-red-400',     label: '验证失败' },
  pending: { dot: 'bg-amber-400',   label: '待验证' },
  unknown: { dot: 'bg-zinc-400',    label: '未验证' },
};

function AccountCard({
  account,
  onEdit,
  onDelete,
  verifying,
  onVerify,
}: {
  account: Account;
  onEdit: () => void;
  onDelete: () => void;
  verifying: boolean;
  onVerify: () => void;
}) {
  const providerLabel = PROVIDER_LABELS[account.provider] ?? account.provider;
  const statusCfg = STATUS_CONFIG[account.status ?? 'unknown'];

  return (
    <div
      className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-3 cursor-pointer hover:border-[hsl(var(--accent))]/40 transition-colors"
      onClick={onEdit}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-semibold text-[hsl(var(--text-primary))]">{account.name}</span>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold border',
              account.authMode === 'oauth'
                ? 'bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))] border-[hsl(var(--accent))]'
                : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))] border-[hsl(var(--border))]'
            )}>
              {account.authMode === 'oauth' ? 'OAuth' : 'API Key'}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] border border-[hsl(var(--border-subtle))]">
              {providerLabel}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--text-tertiary))]">
              <span className={cn('inline-block w-1.5 h-1.5 rounded-full', statusCfg.dot)} />
              {statusCfg.label}
            </span>
          </div>
          {account.baseUrl && (
            <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1 truncate">
              {account.baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
              {account.hasApiKey ? ' · 已配置' : ''}
            </div>
          )}
          {account.authMode === 'oauth' && !account.baseUrl && (
            <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">{providerLabel} · OAuth</div>
          )}
          {account.status === 'error' && account.verifyError && (
            <div className="text-[10px] text-red-400 mt-1 truncate" title={account.verifyError}>
              {account.verifyError.length > 60 ? account.verifyError.slice(0, 60) + '…' : account.verifyError}
            </div>
          )}
          {account.models.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {account.models.map((m) => (
                <span key={m} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border-subtle))]">
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onVerify(); }}
            disabled={verifying}
            className="p-1.5 rounded text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-soft))] transition-colors disabled:opacity-50"
            aria-label="测试连接"
            title="测试连接"
          >
            {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 rounded text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--status-rejected))] hover:bg-[hsl(var(--status-rejected-bg))] transition-colors"
            aria-label="删除账号"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountDialog({
  initial,
  open,
  onClose,
  onSubmit,
}: {
  initial?: Account | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    id?: string;
    name: string;
    authMode: AccountAuthMode;
    provider: AccountProvider;
    baseUrl?: string;
    apiKey?: string;
    models: string[];
  }) => Promise<string | undefined>;
}) {
  const isEdit = Boolean(initial);

  const [authMode, setAuthMode] = useState<AccountAuthMode>(initial?.authMode ?? 'oauth');
  const [provider, setProvider] = useState<AccountProvider>(initial?.provider ?? 'anthropic');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);

  const prevOpenRef = useRef(open);
  const prevInitialIdRef = useRef<string | undefined>(initial?.id);
  useEffect(() => {
    const isOpening = open && !prevOpenRef.current;
    const initialChanged = initial?.id !== prevInitialIdRef.current;
    if (isOpening || (open && initialChanged)) {
      setAuthMode(initial?.authMode ?? 'oauth');
      setProvider(initial?.provider ?? 'anthropic');
      setName(initial?.name ?? '');
      setBaseUrl(initial?.baseUrl ?? '');
      setModels(initial?.models ?? []);
      setApiKey('');
      setSubmitting(false);
    }
    prevOpenRef.current = open;
    prevInitialIdRef.current = initial?.id;
  }, [open, initial]);

  if (!open) return null;

  const isOAuth = authMode === 'oauth';
  const suggestions = (MODEL_SUGGESTIONS[provider] ?? []).filter((m) => !models.includes(m));

  const canSubmit = isOAuth
    ? Boolean(name.trim())
    : Boolean(name.trim()) && models.length > 0 && (isEdit || Boolean(baseUrl.trim() && apiKey.trim()));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload = {
        id: initial?.id,
        name: name.trim(),
        authMode,
        provider,
        baseUrl: !isOAuth && baseUrl.trim() ? baseUrl.trim() : undefined,
        apiKey: !isOAuth && apiKey.trim() ? apiKey.trim() : undefined,
        models,
      };
      const id = await onSubmit(payload);
      if (id && payload.authMode === 'api_key' && payload.apiKey) {
        fetch('/api/accounts/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accountId: id }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.account) useTaskHubStore.getState().upsertAccount(data.account);
          })
          .catch(() => {});
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div
          className="w-full max-w-[480px] rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-[var(--shadow-lg)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
            <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))]">
              {isEdit ? '编辑账号' : '添加账号'}
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="flex rounded-[var(--radius-md)] border border-[hsl(var(--border))] p-0.5">
              {AUTH_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => !isEdit && setAuthMode(opt.value)}
                  disabled={isEdit}
                  className={cn(
                    'flex-1 rounded-[var(--radius-sm)] py-1.5 text-[12px] font-medium transition',
                    authMode === opt.value
                      ? 'bg-[hsl(var(--accent))] text-white shadow-sm'
                      : 'text-[hsl(var(--text-tertiary))]',
                    isEdit ? 'cursor-not-allowed' : 'hover:bg-[hsl(var(--bg-muted))]'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">账号名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如 my-claude-account"
                className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]"
              />
            </div>

            {isOAuth && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">Provider</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as AccountProvider)}
                  className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]"
                >
                  {PROVIDER_OPTIONS.map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                  ))}
                </select>
              </div>
            )}

            {!isOAuth && (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">API 服务地址</label>
                  <input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                    API Key{isEdit ? '（留空保持不变）' : ''}
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={isEdit ? '••••••••' : 'sk-...'}
                    className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]"
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">可用模型</label>
              <TagEditor
                tags={models}
                onChange={setModels}
                addLabel="+ 添加"
                placeholder="输入模型名"
                emptyLabel={isOAuth ? '(可选，留空使用默认模型)' : '(至少添加 1 个模型)'}
              />
              {isOAuth && suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  <span className="text-[10px] text-[hsl(var(--text-tertiary))]">推荐</span>
                  {suggestions.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModels([...models, m])}
                      className="rounded-full border border-dashed border-[hsl(var(--border))] px-2 py-0.5 text-[10px] text-[hsl(var(--text-secondary))] transition hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))]"
                    >
                      + {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 px-5 py-4 border-t border-[hsl(var(--border))]">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-[var(--radius-md)] bg-[hsl(var(--bg-muted))] text-[12px] font-semibold text-[hsl(var(--text-secondary))]">取消</button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="h-9 px-4 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[12px] font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const TEAM_MODE_LABELS: Record<TeamPack['teamMode'], string> = {
  pipeline: 'Pipeline',
  parallel: 'Parallel',
  hub_spoke: 'Hub & Spoke',
  custom: 'Custom',
};

function TeamPackCard({
  pack,
  onEdit,
  onMaterialize,
  onExport,
  onDelete,
  materializing,
  exporting,
  deleting,
}: {
  pack: TeamPack;
  onEdit: () => void;
  onMaterialize: () => void;
  onExport: () => void;
  onDelete: () => void;
  materializing: boolean;
  exporting: boolean;
  deleting: boolean;
}) {
  const missingSnapshotCount = pack.roles.filter((role) => !role.roleCardSnapshot).length;

  return (
    <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-semibold text-[hsl(var(--text-primary))]">{pack.displayName}</span>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold border',
              'bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))] border-[hsl(var(--accent))]'
            )}>
              {TEAM_MODE_LABELS[pack.teamMode]}
            </span>
            {pack.isPreset && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] border border-[hsl(var(--border-subtle))]">
                预设
              </span>
            )}
          </div>
          {pack.description && (
            <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1 line-clamp-2">{pack.description}</div>
          )}
          <div className="text-[10px] text-[hsl(var(--text-tertiary))] mt-1">
            {pack.roles.length} 个成员
            {missingSnapshotCount > 0 ? ` · ${missingSnapshotCount} 个待固化` : ' · 已自包含'}
          </div>
          {pack.roles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {pack.roles.map((r) => (
                <span key={r.id} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border-subtle))]">
                  {r.displayName}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 rounded text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-soft))] transition-colors"
            aria-label="编辑团队套件"
            title="编辑团队套件"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {missingSnapshotCount > 0 && (
            <button
              type="button"
              onClick={onMaterialize}
              disabled={materializing}
              className="p-1.5 rounded text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-soft))] transition-colors disabled:opacity-50"
              aria-label="固化团队成员"
              title="固化团队成员"
            >
              {materializing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="p-1.5 rounded text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-soft))] transition-colors disabled:opacity-50"
            aria-label="导出团队套件"
            title="导出团队套件"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          </button>
          {!pack.isPreset && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="p-1.5 rounded text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--status-rejected))] hover:bg-[hsl(var(--status-rejected-bg))] transition-colors disabled:opacity-50"
              aria-label="删除团队套件"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function downloadTeamPack(pack: TeamPack) {
  const data = JSON.stringify(pack, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${pack.name || pack.id}.team-pack.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function safeStringify(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJsonField<T>(label: string, value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} 不是有效 JSON`);
  }
}

function createBlankRole(index: number): TeamPackRole {
  const id = `member-${index + 1}`;
  return {
    id,
    displayName: `成员 ${index + 1}`,
    soul: `# 成员 ${index + 1}`,
    required: true,
  };
}

function TeamPackEditorDialog({
  pack,
  open,
  onClose,
  onSubmit,
}: {
  pack: TeamPack | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (id: string, patch: Partial<CreateTeamPackInput>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [teamMode, setTeamMode] = useState<TeamPack['teamMode']>('pipeline');
  const [roles, setRoles] = useState<TeamPackRole[]>([]);
  const [workflowText, setWorkflowText] = useState('{}');
  const [communicationText, setCommunicationText] = useState('{}');
  const [sharedContextText, setSharedContextText] = useState('{}');
  const [rulesText, setRulesText] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !pack) return;
    setName(pack.name);
    setDisplayName(pack.displayName);
    setDescription(pack.description);
    setTeamMode(pack.teamMode);
    setRoles(pack.roles);
    setWorkflowText(safeStringify(pack.workflow));
    setCommunicationText(safeStringify(pack.communicationMatrix));
    setSharedContextText(safeStringify(pack.sharedContext ?? {}));
    setRulesText(safeStringify(pack.rules ?? {}));
    setError(null);
    setSaving(false);
  }, [open, pack]);

  if (!open || !pack) return null;

  const updateRole = (index: number, patch: Partial<TeamPackRole>) => {
    setRoles((items) => items.map((role, i) => i === index ? { ...role, ...patch } : role));
  };

  const canSubmit = Boolean(name.trim() && displayName.trim() && roles.length > 0 && roles.every((role) => role.id.trim() && role.displayName.trim()));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const patch: Partial<CreateTeamPackInput> = {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        teamMode,
        roles: roles.map((role) => ({
          ...role,
          id: role.id.trim(),
          displayName: role.displayName.trim(),
          description: role.description?.trim() || undefined,
          soul: role.soul.trim(),
        })),
        workflow: parseJsonField('工作流', workflowText),
        communicationMatrix: parseJsonField('通信矩阵', communicationText),
        sharedContext: parseJsonField('共享上下文', sharedContextText),
        rules: parseJsonField('团队规则', rulesText),
      };
      await onSubmit(pack.id, patch);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div
          className="w-full max-w-[760px] max-h-[86vh] overflow-hidden rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-[var(--shadow-lg)] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
            <div>
              <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))]">编辑团队套件</div>
              <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-0.5">{pack.displayName}</div>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">名称</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]" />
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">显示名称</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]" />
              </label>
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">说明</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]" />
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">团队模式</span>
                <select value={teamMode} onChange={(e) => setTeamMode(e.target.value as TeamPack['teamMode'])} className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]">
                  {Object.entries(TEAM_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">团队成员</div>
                <button type="button" onClick={() => setRoles([...roles, createBlankRole(roles.length)])} className="h-7 px-2 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[11px] font-semibold inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" />
                  添加成员
                </button>
              </div>
              <div className="space-y-2">
                {roles.map((role, index) => (
                  <div key={`${role.id}-${index}`} className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-3 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-[120px_1fr_auto] gap-2">
                      <input value={role.id} onChange={(e) => updateRole(index, { id: e.target.value })} placeholder="member-id" className="h-8 px-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] text-[12px] outline-none focus:border-[hsl(var(--accent))]" />
                      <input value={role.displayName} onChange={(e) => updateRole(index, { displayName: e.target.value })} placeholder="成员名称" className="h-8 px-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] text-[12px] outline-none focus:border-[hsl(var(--accent))]" />
                      <label className="h-8 inline-flex items-center gap-1.5 text-[11px] text-[hsl(var(--text-secondary))]">
                        <input type="checkbox" checked={role.required} onChange={(e) => updateRole(index, { required: e.target.checked })} />
                        必需
                      </label>
                    </div>
                    <input value={role.description ?? ''} onChange={(e) => updateRole(index, { description: e.target.value })} placeholder="职责说明" className="w-full h-8 px-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] text-[12px] outline-none focus:border-[hsl(var(--accent))]" />
                    <textarea value={role.soul} onChange={(e) => updateRole(index, { soul: e.target.value })} rows={3} className="w-full px-2 py-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] text-[12px] font-mono outline-none focus:border-[hsl(var(--accent))]" />
                    <div className="flex justify-end">
                      <button type="button" onClick={() => setRoles(roles.filter((_, i) => i !== index))} className="text-[11px] text-[hsl(var(--status-rejected))] hover:underline">移除成员</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                ['工作流', workflowText, setWorkflowText],
                ['通信矩阵', communicationText, setCommunicationText],
                ['共享上下文', sharedContextText, setSharedContextText],
                ['团队规则', rulesText, setRulesText],
              ].map(([label, value, setter]) => (
                <label key={label as string} className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">{label as string}</span>
                  <textarea value={value as string} onChange={(e) => (setter as (next: string) => void)(e.target.value)} rows={7} className="w-full px-2 py-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[11px] font-mono outline-none focus:border-[hsl(var(--accent))]" />
                </label>
              ))}
            </div>
            {error && <div className="text-[11px] text-red-400">{error}</div>}
          </div>

          <div className="flex justify-end gap-2 px-5 py-4 border-t border-[hsl(var(--border))]">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-[var(--radius-md)] bg-[hsl(var(--bg-muted))] text-[12px] font-semibold text-[hsl(var(--text-secondary))]">取消</button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit || saving} className="h-9 px-4 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[12px] font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              保存
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function TeamPacksTab() {
  const teamPacks = useTeamPackStore((s) => s.teamPacks);
  const isLoading = useTeamPackStore((s) => s.isLoading);
  const error = useTeamPackStore((s) => s.error);
  const fetchTeamPacks = useTeamPackStore((s) => s.fetchTeamPacks);
  const deleteTeamPack = useTeamPackStore((s) => s.deleteTeamPack);
  const updateTeamPack = useTeamPackStore((s) => s.updateTeamPack);
  const materializeTeamPack = useTeamPackStore((s) => s.materializeTeamPack);
  const exportTeamPack = useTeamPackStore((s) => s.exportTeamPack);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingPack, setEditingPack] = useState<TeamPack | null>(null);
  const [materializingId, setMaterializingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    fetchTeamPacks();
  }, [fetchTeamPacks]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个团队套件吗？')) return;
    setDeletingId(id);
    try {
      await deleteTeamPack(id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleMaterialize = async (id: string) => {
    setMaterializingId(id);
    try {
      await materializeTeamPack(id);
    } finally {
      setMaterializingId(null);
    }
  };

  const handleExport = async (id: string) => {
    setExportingId(id);
    try {
      const pack = await exportTeamPack(id);
      downloadTeamPack(pack);
    } finally {
      setExportingId(null);
    }
  };

  const handleImport = async () => {
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch('/api/role-cards/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? '导入失败');
      }
      setImportUrl('');
      setShowImport(false);
      await fetchTeamPacks();
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const presets = teamPacks.filter((p) => p.isPreset);
  const imported = teamPacks.filter((p) => !p.isPreset);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-[hsl(var(--text-tertiary))]">
          团队套件定义了 Agent 团队的角色配置和协作模式。
        </div>
        <button
          type="button"
          onClick={() => setShowImport((v) => !v)}
          className="shrink-0 h-8 px-3 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[11px] font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
        >
          <GitBranch className="w-3.5 h-3.5" />
          从 GitHub 导入
        </button>
      </div>

      {showImport && (
        <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-3 space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">GitHub 仓库地址</label>
          <div className="flex gap-2">
            <input
              value={importUrl}
              onChange={(e) => { setImportUrl(e.target.value); setImportError(null); }}
              placeholder="https://github.com/user/team-pack-repo"
              className="flex-1 h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]"
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || !importUrl.trim()}
              className="shrink-0 h-9 px-4 rounded-[var(--radius-md)] bg-[hsl(var(--accent))] text-white text-[11px] font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              导入
            </button>
          </div>
          {importError && (
            <div className="text-[10px] text-red-400">{importError}</div>
          )}
        </div>
      )}

      {isLoading && teamPacks.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-[hsl(var(--text-tertiary))]" />
        </div>
      ) : error ? (
        <div className="rounded-[var(--radius-lg)] border border-red-400/30 bg-red-400/5 p-4 text-center">
          <div className="text-[12px] text-red-400">{error}</div>
          <button
            type="button"
            onClick={() => fetchTeamPacks()}
            className="mt-2 text-[11px] text-[hsl(var(--accent))] hover:underline"
          >
            重试
          </button>
        </div>
      ) : teamPacks.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-8 text-center">
          <div className="text-[13px] font-semibold text-[hsl(var(--text-secondary))]">还没有团队套件</div>
          <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-2">
            点击「从 GitHub 导入」添加团队套件，或浏览预设套件。
          </div>
        </div>
      ) : (
        <>
          {presets.length > 0 && (
            <>
              <div className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))] pt-1">预设套件</div>
              {presets.map((pack) => (
                <TeamPackCard
                  key={pack.id}
                  pack={pack}
                  onEdit={() => setEditingPack(pack)}
                  onMaterialize={() => handleMaterialize(pack.id)}
                  onExport={() => handleExport(pack.id)}
                  onDelete={() => {}}
                  materializing={materializingId === pack.id}
                  exporting={exportingId === pack.id}
                  deleting={false}
                />
              ))}
            </>
          )}
          {imported.length > 0 && (
            <>
              <div className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))] pt-1">已导入</div>
              {imported.map((pack) => (
                <TeamPackCard
                  key={pack.id}
                  pack={pack}
                  onEdit={() => setEditingPack(pack)}
                  onMaterialize={() => handleMaterialize(pack.id)}
                  onExport={() => handleExport(pack.id)}
                  onDelete={() => handleDelete(pack.id)}
                  materializing={materializingId === pack.id}
                  exporting={exportingId === pack.id}
                  deleting={deletingId === pack.id}
                />
              ))}
            </>
          )}
        </>
      )}
      <TeamPackEditorDialog
        pack={editingPack}
        open={Boolean(editingPack)}
        onClose={() => setEditingPack(null)}
        onSubmit={updateTeamPack}
      />
    </>
  );
}

export function SettingsDrawer() {
  const isOpen = useTaskHubStore((s) => s.isSettingsOpen);
  const setOpen = useTaskHubStore((s) => s.setSettingsOpen);
  const accounts = useTaskHubStore((s) => s.accounts);
  const upsertAccount = useTaskHubStore((s) => s.upsertAccount);
  const removeAccount = useTaskHubStore((s) => s.removeAccount);

  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'accounts' | 'roles' | 'skills' | 'team-packs'>('accounts');

  if (!isOpen) return null;

  const handleAccountSubmit = async (payload: {
    id?: string;
    name: string;
    authMode: AccountAuthMode;
    provider: AccountProvider;
    baseUrl?: string;
    apiKey?: string;
    models: string[];
  }) => {
    const id = await upsertAccount({
      id: payload.id,
      name: payload.name,
      authMode: payload.authMode,
      provider: payload.provider,
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      models: payload.models,
      enabled: true,
    });
    return id;
  };

  const handleVerify = async (accountId: string) => {
    setVerifyingId(accountId);
    try {
      const res = await fetch('/api/accounts/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json();
      if (data.account) {
        upsertAccount(data.account);
      }
    } catch {
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40 animate-fade-in" onClick={() => setOpen(false)} />
      <div
        className="fixed top-0 right-0 h-full w-full max-w-[520px] bg-[hsl(var(--bg-elevated))] border-l-2 border-[hsl(var(--text-primary))] shadow-[-4px_0_0px_hsl(var(--text-primary))] z-50 flex flex-col animate-slide-in-r"
        role="dialog"
        aria-label="设置"
      >
        <div className="flex items-center justify-between p-5 border-b-2 border-[hsl(var(--text-primary))]">
          <div className="flex items-center gap-3">
            <div className="flex border-2 border-[hsl(var(--text-primary))] rounded-[4px] overflow-hidden shadow-[2px_2px_0px_hsl(var(--text-primary))]">
              <button
                type="button"
                onClick={() => setActiveTab('accounts')}
                className={cn(
                  'px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase transition-colors',
                  activeTab === 'accounts'
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                )}
              >
                模型账号
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('roles')}
                className={cn(
                  'px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase transition-colors',
                  activeTab === 'roles'
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                )}
              >
                角色素材
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('skills')}
                className={cn(
                  'px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase transition-colors',
                  activeTab === 'skills'
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                )}
              >
                技能
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('team-packs')}
                className={cn(
                  'px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase transition-colors',
                  activeTab === 'team-packs'
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                )}
              >
                团队套件
              </button>
            </div>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors" aria-label="关闭">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin">
        {activeTab === 'accounts' ? (<>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-[hsl(var(--text-tertiary))]">
              每个账号可添加模型。配置全局共享，所有项目通用。
            </div>
            <button
              type="button"
              onClick={() => { setEditingAccount(null); setIsDialogOpen(true); }}
              className="shrink-0 h-8 px-3 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[11px] font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
            >
              <Plus className="w-3.5 h-3.5" />
              新增账号
            </button>
          </div>

          {accounts.length === 0 ? (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-8 text-center">
              <div className="text-[13px] font-semibold text-[hsl(var(--text-secondary))]">还没有账号</div>
              <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-2">
                点击「新增账号」添加 API Key 或 OAuth 认证，连接你的模型提供商。
              </div>
            </div>
          ) : (
            accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onEdit={() => { setEditingAccount(account); setIsDialogOpen(true); }}
                onDelete={() => removeAccount(account.id)}
                verifying={verifyingId === account.id}
                onVerify={() => handleVerify(account.id)}
              />
            ))
          )}

          <div className="text-[10px] text-[hsl(var(--text-tertiary))] pt-2">
            点击卡片编辑 →
          </div>
        </>) : activeTab === 'roles' ? (
          <RoleCardListPage onClose={() => setOpen(false)} />
        ) : activeTab === 'skills' ? (
          <SkillLibrary />
        ) : (
          <TeamPacksTab />
        )}
        </div>
      </div>

      <AccountDialog
        key={editingAccount?.id ?? 'create'}
        open={isDialogOpen}
        initial={editingAccount}
        onClose={() => { setIsDialogOpen(false); setEditingAccount(null); }}
        onSubmit={handleAccountSubmit}
      />
      <RoleCardDetailDrawer />
      <RoleCardEditor />
    </>
  );
}
