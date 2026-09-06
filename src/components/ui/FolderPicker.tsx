'use client';

import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { ChevronRight, Folder, FolderOpen, Home } from 'lucide-react';

interface DirEntry { name: string; path: string; hasChildren: boolean }
interface FolderPickerProps { value: string; onChange: (path: string) => void }

export function folderBreadcrumbs(value: string) {
  const normalized = value.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const prefix = normalized.startsWith('//') ? '//' : normalized.startsWith('/') ? '/' : '';
  return segments.map((label, index) => ({
    label, path: prefix + segments.slice(0, index + 1).join('/') + (/^[a-z]:$/i.test(label) ? '/' : ''),
  }));
}

export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const pathId = useId();
  const [currentPath, setCurrentPath] = useState('');
  const [draftPath, setDraftPath] = useState(value);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const fetchDir = useCallback(async (dirPath: string) => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/fs/list?path=' + encodeURIComponent(dirPath));
      if (!res.ok) throw new Error(res.status === 403 ? '只能浏览当前用户目录内的文件夹。' : '无法读取此目录，请检查路径与访问权限。');
      const data = await res.json();
      if (generation.current !== request) return;
      setChildren(data.children || []);
      setCurrentPath(data.path);
      setDraftPath(data.path);
    } catch (cause) {
      if (generation.current !== request) return;
      setError(cause instanceof Error ? cause.message : '目录读取失败，请重试。');
      setCurrentPath('');
      setChildren([]);
    } finally { if (generation.current === request) setLoading(false); }
  }, []);

  useEffect(() => {
    // A new external selected directory starts a fresh asynchronous listing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchDir(value || '');
    // Request-generation counter, not a DOM ref; invalidates pending responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { generation.current++; };
  }, [value, fetchDir]);

  return <div className="space-y-2">
    <label htmlFor={pathId} className="text-xs font-semibold text-[hsl(var(--text-secondary))]">项目目录</label>
    <div className="flex gap-2">
      <input id={pathId} value={draftPath} onChange={(event) => setDraftPath(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void fetchDir(draftPath.trim()); } }}
        placeholder="粘贴目录路径，或在下方选择" className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-xs" />
      <button type="button" onClick={() => void fetchDir(draftPath.trim())} className="rounded-lg border px-3 text-xs">浏览</button>
    </div>
    {value && <div className="flex items-center gap-2 rounded-lg border border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))] px-3 py-2 text-xs">
      <FolderOpen className="size-4 shrink-0" /><span className="min-w-0 flex-1 break-all">已选择：{value}</span>
      <button type="button" onClick={() => onChange('')} className="shrink-0 px-2 py-1">清除</button>
    </div>}
    <nav aria-label="目录路径" className="flex flex-wrap items-center gap-1 text-xs">
      <button type="button" aria-label="返回用户目录" onClick={() => void fetchDir('')} className="rounded p-1.5"><Home className="size-4" /></button>
      {folderBreadcrumbs(currentPath).map((crumb) => <span key={crumb.path} className="flex items-center gap-1">
        <span>/</span><button type="button" onClick={() => void fetchDir(crumb.path)} className="rounded px-1 py-1.5">{crumb.label}</button>
      </span>)}
    </nav>
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    <div aria-busy={loading} className="max-h-44 overflow-y-auto rounded-lg border bg-[hsl(var(--bg-muted))]">
      {loading ? <p role="status" className="p-3 text-xs">加载中…</p> : children.length === 0 ? <p className="p-3 text-xs">{error ? '未读取到目录' : '此目录下没有可浏览的子目录'}</p> : children.map((entry) =>
        <div key={entry.path} className="flex items-center border-b last:border-b-0">
          <button type="button" aria-label={'选择目录：' + entry.name} onClick={() => onChange(entry.path)}
            className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[hsl(var(--bg-card-hover))]">
            <Folder className="size-4 shrink-0" /><span className="break-all">{entry.name}</span>
          </button>
          <button type="button" aria-label={'浏览目录：' + entry.name} onClick={() => void fetchDir(entry.path)}
            className="shrink-0 rounded px-3 py-2 hover:bg-[hsl(var(--bg-card-hover))]"><ChevronRight className="size-4" /></button>
        </div>)}
    </div>
    <button type="button" disabled={loading || !currentPath || Boolean(error)} onClick={() => onChange(currentPath)}
      className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40">使用当前目录</button>
  </div>;
}
