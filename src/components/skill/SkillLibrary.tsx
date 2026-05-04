'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import { Plus, FileText, Loader2, Package } from 'lucide-react';
import { SkillImportDialog } from './SkillImportDialog';
import { SkillDetail, type SkillDetailData } from './SkillDetail';

export function SkillLibrary() {
  const skillsMap = useTaskHubStore((s) => s.skillsMap);
  const loadSkills = useTaskHubStore((s) => s.loadSkills);
  const importSkills = useTaskHubStore((s) => s.importSkills);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [listLoading, setListLoading] = useState(true);

  // Load skills on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadSkills();
      if (!cancelled) setListLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadSkills]);

  // Load detail when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);

    (async () => {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(selectedId)}`);
        if (!res.ok) throw new Error('Failed to load skill');
        const data = await res.json();
        if (!cancelled) setDetail(data);
      } catch (err) {
        console.error('[SkillLibrary] Failed to load detail:', err);
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedId]);

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    setSelectedId(null);
    setDetail(null);
    await loadSkills();
  }, [loadSkills]);

  const handleImportComplete = useCallback(async () => {
    await loadSkills();
  }, [loadSkills]);

  const skillEntries = Object.entries(skillsMap);

  return (
    <div className="flex h-full rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] overflow-hidden">
      {/* Left panel — skill list */}
      <div className="w-[180px] flex-shrink-0 border-r border-[hsl(var(--border))] flex flex-col">
        {/* List header */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-[hsl(var(--border))]">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
            Skills ({skillEntries.length})
          </span>
          <button
            onClick={() => setImportOpen(true)}
            className="p-1.5 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-soft))] transition-colors"
            title="Import skill"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* List items */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {listLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 text-[hsl(var(--text-tertiary))] animate-spin" />
            </div>
          ) : skillEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 px-3 text-center">
              <Package className="w-6 h-6 text-[hsl(var(--text-tertiary))] opacity-40" />
              <p className="text-[11px] text-[hsl(var(--text-tertiary))]">No skills yet</p>
              <button
                onClick={() => setImportOpen(true)}
                className="text-[11px] font-medium text-[hsl(var(--accent))] hover:underline"
              >
                Import your first skill
              </button>
            </div>
          ) : (
            skillEntries.map(([id, skill]) => (
              <button
                key={id}
                onClick={() => setSelectedId(id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors border-b border-[hsl(var(--border-subtle))]',
                  selectedId === id
                    ? 'bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                    : 'text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))]'
                )}
              >
                <FileText className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                <span className="text-[12px] font-medium truncate">{skill.name}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel — detail */}
      <SkillDetail
        skill={detail}
        loading={detailLoading}
        onDelete={handleDelete}
      />

      {/* Import dialog */}
      <SkillImportDialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          handleImportComplete();
        }}
      />
    </div>
  );
}
