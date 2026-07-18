'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTaskHubStore, selectActiveAgents, type TaskStatus } from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { X, Plus } from 'lucide-react';
import { RoleRecommendation } from '@/components/role-card/RoleRecommendation';
import { EmojiPickerButton } from '@/components/ui/EmojiPickerButton';

export function NewTaskDialog() {
  const isOpen = useTaskHubStore((s) => s.isNewTaskDialogOpen);
  const setOpen = useTaskHubStore((s) => s.setNewTaskDialogOpen);
  const addTask = useTaskHubStore((s) => s.addTask);
  const activeAgents = useTaskHubStore(useShallow(selectActiveAgents));
  const tasks = useTaskHubStore((s) => s.tasks);
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId] = useState(() => activeAgents[0]?.id ?? '');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Reset the default agent each time the dialog opens, so the selection tracks
  // the current project's roster instead of being frozen at first mount (issue #38).
  useEffect(() => {
    if (!isOpen) return;
    const stillValid = activeAgents.some((a) => a.id === agentId);
    if (!stillValid) {
      setAgentId(activeAgents[0]?.id ?? '');
    }
  }, [isOpen, activeAgents, agentId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    addTask({
      title: title.trim(),
      description: description.trim(),
      status,
      agentId,
      dependencies: selectedDeps,
      artifacts: [],
    });

    setOpen(false);
  };

  const toggleDep = (taskId: string) => {
    setSelectedDeps((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId]
    );
  };

  const handleEmojiInsert = useCallback((emoji: string) => {
    const textarea = descRef.current;
    if (!textarea) {
      setDescription((prev) => prev + emoji);
      return;
    }
    const start = textarea.selectionStart ?? description.length;
    const end = textarea.selectionEnd ?? start;
    const next = description.slice(0, start) + emoji + description.slice(end);
    setDescription(next);
    requestAnimationFrame(() => {
      const pos = start + emoji.length;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    });
  }, [description]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40 animate-fade-in"
        onClick={() => setOpen(false)}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-[480px] bg-[hsl(var(--bg-elevated))] rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] border border-[hsl(var(--border))] animate-slide-in-u"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
            <h2 className="text-[15px] font-bold text-[hsl(var(--text-primary))]">
              新建任务
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                标题 *
              </label>
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：实现登录 API"
                className="w-full px-3 py-2 text-[13px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] outline-none focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/0.15)] transition-all"
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                描述
              </label>
              <div className="relative">
                <textarea
                  ref={descRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述任务内容与验收标准…"
                  rows={3}
                  className="w-full px-3 py-2 text-[13px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] outline-none focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/0.15)] transition-all resize-none"
                />
                <div className="absolute bottom-1.5 right-1.5">
                  <EmojiPickerButton onEmojiSelect={handleEmojiInsert} placement="top-end" />
                </div>
              </div>
            </div>

            {/* Assignee + Status row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                  分配给
                </label>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] outline-none focus:border-[hsl(var(--accent))] transition-all"
                >
                  {activeAgents.length > 0 && activeAgents.map((agent) => {
                    const card = roleCards.find((c) => c.id === agent.roleCardId);
                    return (
                      <option key={agent.id} value={agent.id}>
                        {agent.emoji} {agent.name}{card ? ` — ${card.displayName}` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                  状态
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                  className="w-full px-3 py-2 text-[13px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] outline-none focus:border-[hsl(var(--accent))] transition-all"
                >
                  <option value="pending">待处理</option>
                  <option value="in_progress">进行中</option>
                  <option value="blocked">已阻塞</option>
                </select>
              </div>
            </div>

            {/* Dependencies */}
            {tasks.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                  依赖（可选）
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto scrollbar-thin">
                  {tasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleDep(t.id)}
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] border text-[11px] font-medium transition-all',
                        selectedDeps.includes(t.id)
                          ? 'bg-[hsl(var(--accent-soft))] border-[hsl(var(--accent))] text-[hsl(var(--accent))]'
                          : 'bg-[hsl(var(--bg-muted))] border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--ring))]'
                      )}
                    >
                      <span className="font-mono text-[10px]">{t.id}</span>
                      <span className="truncate max-w-[120px]">{t.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Role Recommendation */}
            <RoleRecommendation
              title={title}
              description={description}
              currentAgentId={agentId}
              onAccept={setAgentId}
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-[hsl(var(--border))]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2 text-[12px] font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-muted))] rounded-[var(--radius-md)] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold rounded-[var(--radius-md)] transition-all duration-200',
                'bg-[hsl(var(--accent))] text-white shadow-sm',
                'hover:opacity-90 active:scale-[0.98]',
                'disabled:opacity-40 disabled:cursor-not-allowed'
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              创建任务
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
