'use client';

import { useState } from 'react';
import { useIMEGuard } from '@/hooks/useIMEGuard';
import { cn } from '@/lib/utils';

export function TagEditor({
  tags,
  onChange,
  addLabel,
  placeholder,
  emptyLabel,
  tone = 'accent',
}: {
  tags: string[];
  onChange: (nextTags: string[]) => void;
  addLabel: string;
  placeholder: string;
  emptyLabel: string;
  tone?: 'accent' | 'purple';
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const ime = useIMEGuard();

  const commit = () => {
    const next = draft.trim();
    if (!next) {
      setAdding(false);
      setDraft('');
      return;
    }
    if (!tags.includes(next)) {
      onChange([...tags, next]);
    }
    setDraft('');
  };

  const remove = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && (
          <span className="text-[11px] italic text-[hsl(var(--text-tertiary))]">{emptyLabel}</span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border',
              tone === 'accent'
                ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))]'
            )}
          >
            {tag}
            <button
              type="button"
              onClick={() => remove(tag)}
              className="opacity-60 hover:opacity-100 text-[10px] leading-none"
              aria-label={`移除 ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-medium',
            tone === 'accent'
              ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
              : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))]'
          )}
        >
          {addLabel}
        </button>
      </div>

      {adding && (
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (ime.isComposing()) return;
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
            }}
            placeholder={placeholder}
            className="flex-1 min-w-[200px] h-8 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-medium outline-none focus:border-[hsl(var(--accent))]"
          />
          <button
            type="button"
            onClick={commit}
            className="h-8 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))] text-[11px] font-semibold text-[hsl(var(--accent))]"
          >
            添加
          </button>
        </div>
      )}
    </div>
  );
}
