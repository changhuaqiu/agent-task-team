'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, Plus, RefreshCw, TerminalSquare, Trash2, TriangleAlert, X } from 'lucide-react';
import { loadAgentRuntimeCatalog, type AgentRuntimeCatalogItem } from '@/lib/agent-runtime-catalog-client';

export function SettingsRuntimesTab() {
  const [items, setItems] = useState<AgentRuntimeCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCatalog, setShowCatalog] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [savingCustom, setSavingCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState({ id: '', label: '', command: '', args: '[]' });

  const load = useCallback((force = false) => {
    setLoading(true);
    setError('');
    void loadAgentRuntimeCatalog({ force })
      .then(setItems)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const configured = useMemo(() => items.filter((item) => item.available || item.custom), [items]);
  const needsSetup = useMemo(() => items.filter((item) => !item.available && !item.custom), [items]);

  async function saveCustomRuntime() {
    setSavingCustom(true);
    setError('');
    try {
      const args = JSON.parse(customDraft.args) as unknown;
      if (!Array.isArray(args) || args.some((item) => typeof item !== 'string')) throw new Error('参数必须是字符串数组，例如 ["acp"]');
      const response = await fetch('/api/agent-runtimes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...customDraft, args }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? '自定义 ACP 保存失败');
      setItems(Array.isArray(body.runtimes) ? body.runtimes : []);
      setCustomDraft({ id: '', label: '', command: '', args: '[]' });
      setCustomOpen(false);
      load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '自定义 ACP 保存失败');
    } finally {
      setSavingCustom(false);
    }
  }

  async function removeCustomRuntime(item: AgentRuntimeCatalogItem) {
    if (!item.custom || !window.confirm(`移除自定义运行环境“${item.label}”？已使用它的 Agent 将无法启动，直到重新配置。`)) return;
    setError('');
    try {
      const response = await fetch(`/api/agent-runtimes?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? '移除失败');
      setItems(Array.isArray(body.runtimes) ? body.runtimes : []);
      load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '移除失败');
    }
  }

  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-sm font-semibold text-[hsl(var(--text-primary))]">运行环境</h2><p className="mt-1 text-xs leading-5 text-[hsl(var(--text-secondary))]">这台设备上 Agent 可以使用的执行程序。Agent 的具体选择在 Agents 页面配置。</p></div>
      <button type="button" onClick={() => load(true)} disabled={loading} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-2.5 text-xs text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-muted))] disabled:opacity-50">{loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}重新检查</button>
    </div>

    {error && <div role="alert" className="rounded-md bg-[hsl(var(--status-rejected-bg))] px-3 py-2 text-xs text-[hsl(var(--status-rejected))]">{error}</div>}

    <section className="space-y-2"><div className="flex items-center justify-between"><h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--text-tertiary))]">已配置</h3><span className="text-[10px] text-[hsl(var(--text-tertiary))]">{configured.length} 个</span></div>{configured.map((item) => <RuntimeRow key={item.id} item={item} onRemove={item.custom ? () => void removeCustomRuntime(item) : undefined} />)}{!loading && configured.length === 0 && <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-xs text-[hsl(var(--text-tertiary))]">暂未配置执行程序</div>}</section>

    <div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => setShowCatalog((value) => !value)} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-xs font-medium hover:bg-[hsl(var(--bg-card-hover))]"><Plus className="size-3.5" />{showCatalog ? '收起预置目录' : '添加预置环境'}{!showCatalog && needsSetup.length > 0 && <span className="text-[10px] font-normal text-[hsl(var(--text-tertiary))]">{needsSetup.length} 个</span>}</button><button type="button" onClick={() => { setError(''); setCustomOpen(true); }} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-xs font-medium hover:bg-[hsl(var(--bg-card-hover))]"><TerminalSquare className="size-3.5" />添加自定义 ACP</button></div>
    {showCatalog && <section className="space-y-2"><div><h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--text-tertiary))]">预置目录</h3><p className="mt-1 text-[11px] text-[hsl(var(--text-tertiary))]">完成对应程序安装后重新检查即可使用。</p></div>{needsSetup.map((item) => <RuntimeRow key={item.id} item={item} />)}{needsSetup.length === 0 && <div className="rounded-xl bg-[hsl(var(--bg-app))] px-4 py-6 text-center text-xs text-[hsl(var(--text-tertiary))]">预置执行程序均已可用</div>}</section>}

    <div className="rounded-xl bg-[hsl(var(--bg-app))] p-4"><div className="text-xs font-medium">运行边界</div><p className="mt-1.5 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">可用只表示依赖已发现。Agent 只有在协作连接建立、至少一个执行实例可以接收工作后才会显示为可协作；程序正在运行不等于已经就绪。</p></div>
    {customOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingCustom) setCustomOpen(false); }}><div role="dialog" aria-modal="true" aria-label="添加自定义 ACP" className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-2xl"><header className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] px-5 py-4"><div><h2 className="text-base font-semibold">添加自定义 ACP</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">连接任何实现 Agent Client Protocol 的本地程序。</p></div><button type="button" aria-label="关闭" onClick={() => setCustomOpen(false)} disabled={savingCustom} className="flex size-8 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg-muted))]"><X className="size-4" /></button></header><div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5"><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-xs font-medium">名称</span><input autoFocus value={customDraft.label} onChange={(event) => setCustomDraft({ ...customDraft, label: event.target.value })} placeholder="例如：My ACP Agent" className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 text-xs outline-none" /></label><label className="space-y-1.5"><span className="text-xs font-medium">标识</span><input value={customDraft.id} onChange={(event) => setCustomDraft({ ...customDraft, id: event.target.value.toLowerCase() })} placeholder="my-agent" className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 font-mono text-xs outline-none" /></label></div><label className="block space-y-1.5"><span className="text-xs font-medium">启动命令</span><input value={customDraft.command} onChange={(event) => setCustomDraft({ ...customDraft, command: event.target.value })} placeholder="my-agent-acp" className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 font-mono text-xs outline-none" /></label><label className="block space-y-1.5"><span className="text-xs font-medium">参数（JSON 数组）</span><textarea rows={3} value={customDraft.args} onChange={(event) => setCustomDraft({ ...customDraft, args: event.target.value })} className="w-full resize-y rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 py-2 font-mono text-xs outline-none" /></label><div className="rounded-lg bg-[hsl(var(--bg-muted))] px-3 py-2 text-[10px] leading-5 text-[hsl(var(--text-tertiary))]">Catalog 只保存公开的启动元数据。账号和密钥请在模型账号中配置，不要写入命令参数；服务进程的私密环境不会传给该程序。</div></div><footer className="flex justify-end gap-2 border-t border-[hsl(var(--border-subtle))] px-5 py-4"><button type="button" onClick={() => setCustomOpen(false)} disabled={savingCustom} className="h-9 rounded-lg px-3 text-xs">取消</button><button type="button" onClick={() => void saveCustomRuntime()} disabled={savingCustom} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-4 text-xs font-medium text-[hsl(var(--text-inverse))] disabled:opacity-60">{savingCustom && <Loader2 className="size-3.5 animate-spin" />}保存并检查</button></footer></div></div>}
  </div>;
}

function RuntimeRow({ item, onRemove }: { item: AgentRuntimeCatalogItem; onRemove?: () => void }) {
  return <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-3.5">
    <div className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))]"><TerminalSquare className="size-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><div className="text-sm font-medium">{item.label}{item.custom && <span className="ml-2 rounded bg-[hsl(var(--bg-muted))] px-1.5 py-0.5 text-[9px] font-normal text-[hsl(var(--text-tertiary))]">自定义</span>}</div><div className="flex items-center gap-2"><span className={item.available ? 'inline-flex items-center gap-1 text-xs text-emerald-600' : 'inline-flex items-center gap-1 text-xs text-amber-600'}>{item.available ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5" />}{item.available ? '可使用' : '需要安装'}</span>{onRemove && <button type="button" onClick={onRemove} aria-label={`移除 ${item.label}`} className="flex size-7 items-center justify-center rounded-md text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--status-rejected-bg))] hover:text-[hsl(var(--status-rejected))]"><Trash2 className="size-3.5" /></button>}</div></div><p className="mt-1 text-[11px] text-[hsl(var(--text-tertiary))]">{item.available ? '已通过本机依赖检查' : '尚未发现所需程序'}</p></div></div>
    <details className="group mt-3 border-t border-[hsl(var(--border-subtle))] pt-2"><summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] text-[hsl(var(--text-tertiary))]">诊断详情<ChevronDown className="size-3 transition-transform group-open:rotate-180" /></summary><div className="mt-2 space-y-1 text-[10px] leading-5 text-[hsl(var(--text-tertiary))]"><div>连接方式：{item.delivery === 'native' ? '直接连接' : '兼容适配'}</div><div>已验证能力：{item.capabilities.length} 项</div>{item.executablePath && <div className="break-all font-mono">位置：{item.executablePath}</div>}</div></details>
  </div>;
}
