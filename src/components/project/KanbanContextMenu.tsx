'use client';

import { useEffect, useRef } from 'react';
import {
  Play,
  Eye,
  CheckCircle2,
  ShieldAlert,
  UserPlus,
  GitBranch,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Task, type TaskStatus } from '@/store/taskHubStore';
import { AGENT_ROSTER } from '@/store/agentStore';

// --- Status transition map ---

const statusTransitions: Record<
  TaskStatus,
  { target: TaskStatus; label: string; icon: typeof Play }[]
> = {
  pending: [
    { target: 'in_progress', label: '开始', icon: Play },
    { target: 'blocked', label: '阻塞', icon: ShieldAlert },
  ],
  in_progress: [
    { target: 'in_review', label: '提交评审', icon: Eye },
    { target: 'blocked', label: '阻塞', icon: ShieldAlert },
  ],
  in_review: [
    { target: 'done', label: '通过', icon: CheckCircle2 },
    { target: 'blocked', label: '阻塞', icon: ShieldAlert },
  ],
  done: [],
  rejected: [{ target: 'pending', label: '重置', icon: Play }],
  blocked: [
    { target: 'pending', label: '重置', icon: Play },
    { target: 'in_progress', label: '开始', icon: Play },
  ],
};

// --- Props ---

interface KanbanContextMenuProps {
  x: number;
  y: number;
  task: Task;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onAssign: (taskId: string, agentId: string) => void;
  onEdit: (taskId: string) => void;
  onViewDeps: (taskId: string) => void;
  onClose: () => void;
}

// --- Component ---

export function KanbanContextMenu({
  x,
  y,
  task,
  onStatusChange,
  onAssign,
  onEdit,
  onViewDeps,
  onClose,
}: KanbanContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const transitions = statusTransitions[task.status] ?? [];
  const hasDeps = task.dependencies && task.dependencies.length > 0;

  // Close on outside click or Escape
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] rounded-md shadow-md py-1 min-w-[180px]"
      style={{ left: x, top: y }}
    >
      {/* Status transition actions */}
      {transitions.length > 0 && (
        <>
          {transitions.map(({ target, label, icon: Icon }) => (
            <button
              key={target}
              type="button"
              className={cn(
                'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[hsl(var(--text-primary))]',
                'hover:bg-[hsl(var(--bg-muted))] transition-colors text-left'
              )}
              onClick={() => {
                onStatusChange(task.id, target);
                onClose();
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
          <div className="my-1 border-t border-[hsl(var(--border-subtle))]" />
        </>
      )}

      {/* Assign to submenu */}
      <div className="group relative">
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[hsl(var(--text-primary))]',
            'hover:bg-[hsl(var(--bg-muted))] transition-colors text-left'
          )}
        >
          <UserPlus className="w-3.5 h-3.5" />
          分配给...
        </button>

        {/* Submenu */}
        <div
          className={cn(
            'absolute left-full top-0 bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))]',
            'rounded-md shadow-md py-1 min-w-[160px] hidden group-hover:block'
          )}
        >
          {AGENT_ROSTER.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={cn(
                'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors',
                task.agentId === agent.id
                  ? 'text-[hsl(var(--accent))]'
                  : 'text-[hsl(var(--text-primary))]',
                'hover:bg-[hsl(var(--bg-muted))]'
              )}
              onClick={() => {
                onAssign(task.id, agent.id);
                onClose();
              }}
            >
              <span className="w-3.5 h-3.5 flex items-center justify-center text-xs">
                {agent.emoji}
              </span>
              {agent.name}
            </button>
          ))}
        </div>
      </div>

      {/* View Dependencies (conditional) */}
      {hasDeps && (
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[hsl(var(--text-primary))]',
            'hover:bg-[hsl(var(--bg-muted))] transition-colors text-left'
          )}
          onClick={() => {
            onViewDeps(task.id);
            onClose();
          }}
        >
          <GitBranch className="w-3.5 h-3.5" />
          查看依赖
        </button>
      )}

      {/* Separator before Edit */}
      <div className="my-1 border-t border-[hsl(var(--border-subtle))]" />

      {/* Edit Task */}
      <button
        type="button"
        className={cn(
          'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[hsl(var(--text-primary))]',
          'hover:bg-[hsl(var(--bg-muted))] transition-colors text-left'
        )}
        onClick={() => {
          onEdit(task.id);
          onClose();
        }}
      >
        <Pencil className="w-3.5 h-3.5" />
        编辑任务
      </button>
    </div>
  );
}
