// src/components/project/ProjectTreeItemActions.tsx
import { Trash2 } from 'lucide-react';

export function ProjectTreeItemActions({ onDelete }: { onDelete: () => void }) {
  return (
    <div className="absolute top-1/2 -translate-y-1/2 right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-[var(--duration-fast)]">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="p-1 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--status-blocked))] hover:bg-[hsl(var(--bg-card-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]"
        title="删除交付"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
