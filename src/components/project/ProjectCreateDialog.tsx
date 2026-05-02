'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import { FolderPicker } from '@/components/ui/FolderPicker';

export function ProjectCreateDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createConversation = useTaskHubStore((s) => s.createConversation);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [autoBreakdown, setAutoBreakdown] = useState(true);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCreate = () => {
    const trimmedTitle = title.trim();
    const trimmedGoal = goal.trim();
    if (!trimmedTitle || !trimmedGoal) return;
    createConversation({ title: trimmedTitle, goal: trimmedGoal, projectPath: projectPath || undefined, autoBreakdown });
    setTitle('');
    setGoal('');
    setProjectPath('');
    setAutoBreakdown(true);
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-[560px] rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-[var(--shadow-lg)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
            <div>
              <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                新建项目
              </div>
              <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))] mt-1">
                先定义需求，再进入对话与拆解
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                项目标题
              </label>
              <input
                ref={titleRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：支付链路重构"
                className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[13px] font-medium outline-none focus:border-[hsl(var(--accent))]"
              />
            </div>

            <div className="space-y-1.5">
              <FolderPicker value={projectPath} onChange={setProjectPath} />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                目标 / 验收标准
              </label>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="写清楚这条需求想达成什么、验收怎么判断。"
                rows={4}
                className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[13px] font-medium outline-none resize-none focus:border-[hsl(var(--accent))]"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={autoBreakdown}
                onClick={() => setAutoBreakdown(!autoBreakdown)}
                className={cn(
                  'w-4 h-4 rounded-[2px] border-2 flex items-center justify-center transition-all',
                  autoBreakdown
                    ? 'bg-[hsl(var(--accent))] border-[hsl(var(--accent))] text-white'
                    : 'bg-[hsl(var(--bg-muted))] border-[hsl(var(--border))]'
                )}
              >
                {autoBreakdown && <span className="text-[10px]">✓</span>}
              </button>
              <span className="text-[11px] text-[hsl(var(--text-secondary))]">
                自动拆解任务（由 ⚔️ Jean 分析）
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 px-5 py-4 border-t border-[hsl(var(--border))]">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] bg-[hsl(var(--bg-muted))] text-[12px] font-semibold text-[hsl(var(--text-secondary))]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!title.trim() || !goal.trim()}
              className={cn(
                'inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] text-[12px] font-semibold',
                'bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] hover:opacity-90',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              {autoBreakdown ? '创建并拆解' : '创建项目'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

