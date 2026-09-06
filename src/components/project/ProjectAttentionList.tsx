'use client';

import { AlertCircle } from 'lucide-react';
import type { ProjectAttentionItem } from '@/lib/project-attention';

export function ProjectAttentionList({ items, onOpen }: {
  items: ProjectAttentionItem[];
  onOpen: (item: ProjectAttentionItem) => void;
}) {
  if (!items.length) return null;
  return <section aria-label="当前需要处理" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
    <h4 className="flex items-center gap-2 text-sm font-semibold"><AlertCircle className="size-4 text-amber-600" />当前需要处理 · {items.length}</h4>
    <div className="mt-3 space-y-3">{items.map((item) => <div key={item.id} className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{item.title}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[hsl(var(--text-secondary))]">{item.reason}</p><time className="mt-1 block text-xs text-[hsl(var(--text-tertiary))]">{new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}</time></div>
      <button type="button" onClick={() => onOpen(item)} className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--bg-card))]" aria-label={`查看并处理：${item.title}`}>查看并处理</button>
    </div>)}</div>
  </section>;
}
