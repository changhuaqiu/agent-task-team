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
import { Plus, Trash2, Loader2, Zap, X } from 'lucide-react';

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
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-soft))] transition-colors disabled:opacity-50"
            aria-label="测试连接"
            title="测试连接"
          >
            {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--status-rejected))] hover:bg-[hsl(var(--status-rejected-bg))] transition-colors"
            aria-label="删除账号"
          >
            <Trash2 className="w-4 h-4" />
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
                      : 'text-[hsl(var(--text-terti))]',
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

export function SettingsAccountsTab() {
  const accounts = useTaskHubStore((s) => s.accounts);
  const upsertAccount = useTaskHubStore((s) => s.upsertAccount);
  const removeAccount = useTaskHubStore((s) => s.removeAccount);

  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

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

      <AccountDialog
        key={editingAccount?.id ?? 'create'}
        open={isDialogOpen}
        initial={editingAccount}
        onClose={() => { setIsDialogOpen(false); setEditingAccount(null); }}
        onSubmit={handleAccountSubmit}
      />
    </>
  );
}
