'use client';

import { useState, useEffect, useRef } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import { X, Download, Loader2 } from 'lucide-react';

interface SkillImportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SkillImportDialog({ open, onClose }: SkillImportDialogProps) {
  const importSkills = useTaskHubStore((s) => s.importSkills);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setLoading(true);
    setResult(null);
    try {
      const res = await importSkills(trimmed);
      if (res.error) {
        setResult({ ok: false, message: res.error });
      } else {
        setResult({ ok: true, message: `已成功导入 ${res.imported ?? 0} 个技能` });
        setUrl('');
        setTimeout(() => onClose(), 1200);
      }
    } catch {
      setResult({ ok: false, message: '导入失败，请检查地址后重试。' });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    if (url.trim() && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setUrl('');
    setResult(null);
    setConfirmDiscard(false);
    onClose();
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40 animate-fade-in"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <form
          onSubmit={handleImport}
          className="w-full max-w-[480px] bg-[hsl(var(--bg-elevated))] rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] border border-[hsl(var(--border))] animate-slide-in-u"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
            <h2 className="text-[15px] font-bold text-[hsl(var(--text-primary))]">
              导入技能
            </h2>
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="p-1.5 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                来源地址
              </label>
              <input
                ref={inputRef}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/skills/my-skill"
                className="w-full px-3 py-2 text-[13px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] outline-none focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/0.15)] transition-all"
                disabled={loading}
                required
              />
            </div>

            {/* Feedback */}
            {result && (
              <div
                className={cn(
                  'px-3 py-2 rounded-[var(--radius-md)] text-[12px] font-medium border',
                  result.ok
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
                )}
              >
                {result.message}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-[hsl(var(--border))]">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-[12px] font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-muted))] rounded-[var(--radius-md)] transition-colors disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!url.trim() || loading}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold rounded-[var(--radius-md)] transition-all duration-200',
                'bg-[hsl(var(--accent))] text-white shadow-sm',
                'hover:opacity-90 active:scale-[0.98]',
                'disabled:opacity-40 disabled:cursor-not-allowed'
              )}
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {loading ? '正在导入…' : '导入'}
            </button>
          </div>
        </form>
        {confirmDiscard && (
          <div role="alertdialog" aria-modal="true" aria-labelledby="discard-skill-title" className="absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-xl)] bg-black/30 p-4">
            <div className="w-full max-w-sm rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-xl">
              <h3 id="discard-skill-title" className="text-sm font-semibold">放弃未完成的导入？</h3>
              <p className="mt-2 text-xs leading-5 text-[hsl(var(--text-secondary))]">已填写的技能地址会丢失。</p>
              <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setConfirmDiscard(false)} className="rounded-md px-3 py-2 text-xs">继续编辑</button><button type="button" onClick={handleClose} className="rounded-md bg-rose-600 px-3 py-2 text-xs font-medium text-white">放弃改动</button></div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
