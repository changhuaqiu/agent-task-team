'use client';

import { useState, useEffect, useRef } from 'react';
import { useTaskHubStore, selectActiveAgents, type TaskStatus } from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { X, Plus } from 'lucide-react';

export function NewTaskDialog() {
  const isOpen = useTaskHubStore((s) => s.isNewTaskDialogOpen);
  const setOpen = useTaskHubStore((s) => s.setNewTaskDialogOpen);
  const addTask = useTaskHubStore((s) => s.addTask);
  const activeAgents = useTaskHubStore(useShallow(selectActiveAgents));
  const tasks = useTaskHubStore((s) => s.tasks);
  const titleRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId] = useState(activeAgents[0]?.id ?? '');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);

  // Reset form when opened
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setStatus('pending');
      setAgentId(activeAgents[0]?.id || '');
      setSelectedDeps([]);
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }, [isOpen, activeAgents]);

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

    // Reset
    setTitle('');
    setDescription('');
    setStatus('pending');
    setSelectedDeps([]);
    setOpen(false);
  };

  const toggleDep = (taskId: string) => {
    setSelectedDeps((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId]
    );
  };

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
              New Task
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                Title *
              </label>
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Implement login API"
                className="w-full px-3 py-2 text-[13px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] outline-none focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/0.15)] transition-all"
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the task and acceptance criteria..."
                rows={3}
                className="w-full px-3 py-2 text-[13px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] outline-none focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/0.15)] transition-all resize-none"
              />
            </div>

            {/* Assignee + Status row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                  Assign To
                </label>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] outline-none focus:border-[hsl(var(--accent))] transition-all"
                >
                  {activeAgents.length > 0 && activeAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.emoji} {agent.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                  className="w-full px-3 py-2 text-[13px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] outline-none focus:border-[hsl(var(--accent))] transition-all"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
            </div>

            {/* Dependencies */}
            {tasks.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                  Dependencies (optional)
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
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-[hsl(var(--border))]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2 text-[12px] font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-muted))] rounded-[var(--radius-md)] transition-colors"
            >
              Cancel
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
              Create Task
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
