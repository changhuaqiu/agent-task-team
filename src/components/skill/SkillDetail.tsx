'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Loader2, FileText, Trash2, AlertTriangle, Package } from 'lucide-react';

interface SkillFile {
  path: string;
  content: string;
}

export interface SkillDetailData {
  id: string;
  name: string;
  description: string | null;
  content: string;
  files: SkillFile[];
  is_preset: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface SkillDetailProps {
  skill: SkillDetailData | null;
  loading: boolean;
  onDelete: (id: string) => Promise<void>;
}

export function SkillDetail({ skill, loading, onDelete }: SkillDetailProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-[hsl(var(--text-tertiary))] animate-spin" />
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[hsl(var(--text-tertiary))]">
        <Package className="w-10 h-10 opacity-40" />
        <p className="text-[13px] font-medium">Select a skill to view details</p>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await onDelete(skill.id);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const supportingFiles = (skill.files ?? []).filter(
    (f) => f.path !== 'SKILL.md'
  );

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold text-[hsl(var(--text-primary))] truncate">
            {skill.name}
          </h2>
          {skill.description && (
            <p className="text-[12px] text-[hsl(var(--text-secondary))] mt-1">
              {skill.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            {skill.is_preset === 1 && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-[var(--radius-sm)] bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))] border border-[hsl(var(--accent))]">
                Preset
              </span>
            )}
            <span className="text-[10px] text-[hsl(var(--text-tertiary))]">
              v{skill.version}
            </span>
          </div>
        </div>

        {/* Delete button — hidden for preset skills */}
        {skill.is_preset !== 1 && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-[var(--radius-md)] border transition-all',
              confirmDelete
                ? 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/20'
                : 'bg-[hsl(var(--bg-muted))] border-[hsl(var(--border))] text-[hsl(var(--text-tertiary))] hover:text-red-500 hover:border-red-500/30'
            )}
          >
            {deleting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : confirmDelete ? (
              <AlertTriangle className="w-3 h-3" />
            ) : (
              <Trash2 className="w-3 h-3" />
            )}
            {confirmDelete ? 'Confirm Delete' : 'Delete'}
          </button>
        )}
      </div>

      {/* SKILL.md content */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
          SKILL.md
        </label>
        <pre className="px-4 py-3 text-[12px] leading-relaxed font-mono bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[var(--radius-md)] text-[hsl(var(--text-secondary))] whitespace-pre-wrap break-words overflow-x-auto max-h-[360px] overflow-y-auto scrollbar-thin">
          {skill.content || '(empty)'}
        </pre>
      </div>

      {/* Supporting files */}
      {supportingFiles.length > 0 && (
        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
            Supporting Files ({supportingFiles.length})
          </label>
          <div className="space-y-2">
            {supportingFiles.map((file) => (
              <div
                key={file.path}
                className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] overflow-hidden"
              >
                {/* File header */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))]">
                  <FileText className="w-3.5 h-3.5 text-[hsl(var(--text-tertiary))]" />
                  <span className="text-[11px] font-mono font-medium text-[hsl(var(--text-primary))] truncate">
                    {file.path}
                  </span>
                </div>
                {/* File preview — truncated */}
                <pre className="px-3 py-2 text-[11px] font-mono text-[hsl(var(--text-tertiary))] whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto scrollbar-thin">
                  {file.content.length > 500
                    ? file.content.slice(0, 500) + '\n... (truncated)'
                    : file.content}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
