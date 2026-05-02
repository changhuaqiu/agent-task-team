'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, Folder, FolderOpen, Home } from 'lucide-react';

interface DirEntry {
  name: string;
  path: string;
  hasChildren: boolean;
}

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
}

export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState(value || '');
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      setChildren(data.children || []);
      setCurrentPath(data.path || dirPath);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDir(value || '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = (dirPath: string) => {
    fetchDir(dirPath);
  };

  const selectPath = (dirPath: string) => {
    onChange(dirPath);
  };

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
        项目目录
      </label>

      {value && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[4px] bg-[hsl(var(--accent-soft))] border-2 border-[hsl(var(--accent))] text-[12px] font-medium text-[hsl(var(--accent))]">
          <FolderOpen className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{value}</span>
          <button
            type="button"
            onClick={() => onChange('')}
            className="ml-auto text-[10px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))]"
          >
            清除
          </button>
        </div>
      )}

      <div className="flex items-center gap-0.5 flex-wrap text-[10px] text-[hsl(var(--text-tertiary))]">
        <button
          type="button"
          onClick={() => navigateTo('')}
          className="hover:text-[hsl(var(--text-primary))] transition-colors"
        >
          <Home className="w-3 h-3 inline" />
        </button>
        {breadcrumbs.map((seg, i) => {
          const partial = '/' + breadcrumbs.slice(0, i + 1).join('/');
          return (
            <span key={partial} className="flex items-center gap-0.5">
              <span>/</span>
              <button
                type="button"
                onClick={() => navigateTo(partial)}
                className="hover:text-[hsl(var(--text-primary))] transition-colors truncate max-w-[80px]"
              >
                {seg}
              </button>
            </span>
          );
        })}
      </div>

      <div className="max-h-[180px] overflow-y-auto rounded-[4px] border-2 border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] scrollbar-thin">
        {loading ? (
          <div className="px-3 py-2 text-[11px] text-[hsl(var(--text-tertiary))]">加载中…</div>
        ) : children.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-[hsl(var(--text-tertiary))]">空目录</div>
        ) : (
          children.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-[hsl(var(--bg-card-hover))] transition-colors cursor-pointer border-b border-[hsl(var(--border-subtle))] last:border-b-0"
            >
              <Folder className="w-3.5 h-3.5 text-[hsl(var(--text-tertiary))] shrink-0" />
              <span
                className="text-[12px] text-[hsl(var(--text-primary))] truncate flex-1"
                onClick={() => selectPath(entry.path)}
              >
                {entry.name}
              </span>
              {entry.hasChildren && (
                <button
                  type="button"
                  onClick={() => navigateTo(entry.path)}
                  className="p-0.5 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] transition-colors"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}