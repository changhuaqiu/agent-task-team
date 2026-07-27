'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  type TaskStatus,
  useTaskHubStore,
  resolveAgentEngine,
} from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { StatusBadge } from './StatusBadge';
import { TerminalView } from './TerminalView';
import { RoleCardBadge } from '@/components/role-card/RoleCardBadge';
import { TaskGraphTimeline } from './TaskGraphTimeline';
import { TaskGraphActionsPanel } from './TaskGraphActionsPanel';
import { useTaskGraph } from './useTaskGraph';
import { cn } from '@/lib/utils';
import { EmojiPickerButton } from '@/components/ui/EmojiPickerButton';
import {
  X,
  Link2,
  FileText,
  GitPullRequest,
  FileWarning,
  ExternalLink,
  Play,
  Eye,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Clock,
  Trash2,
  Terminal as TerminalIcon,
} from 'lucide-react';

const artifactIcons = {
  file: FileText,
  pr: GitPullRequest,
  log: FileWarning,
  link: ExternalLink,
};

/* ---- Quick-action buttons per status transition ---- */
const statusActions: {
  target: TaskStatus;
  label: string;
  icon: typeof Play;
  className: string;
}[] = [
  {
    target: 'in_progress',
    label: '开始',
    icon: Play,
    className:
      'bg-[hsl(var(--status-progress-bg))] text-[hsl(var(--status-progress))] border-[hsl(var(--status-progress-border))] hover:bg-[hsl(var(--status-progress))] hover:text-white',
  },
  {
    target: 'in_review',
    label: '提交评审',
    icon: Eye,
    className:
      'bg-[hsl(var(--status-review-bg))] text-[hsl(var(--status-review))] border-[hsl(var(--status-review-border))] hover:bg-[hsl(var(--status-review))] hover:text-white',
  },
  {
    target: 'done',
    label: '通过',
    icon: CheckCircle2,
    className:
      'bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done))] border-[hsl(var(--status-done-border))] hover:bg-[hsl(var(--status-done))] hover:text-white',
  },
  {
    target: 'rejected',
    label: '拒绝',
    icon: XCircle,
    className:
      'bg-[hsl(var(--status-rejected-bg))] text-[hsl(var(--status-rejected))] border-[hsl(var(--status-rejected-border))] hover:bg-[hsl(var(--status-rejected))] hover:text-white',
  },
  {
    target: 'blocked',
    label: '阻塞',
    icon: ShieldAlert,
    className:
      'bg-[hsl(var(--status-blocked-bg))] text-[hsl(var(--status-blocked))] border-[hsl(var(--status-blocked-border))] hover:bg-[hsl(var(--status-blocked))] hover:text-white',
  },
  {
    target: 'pending',
    label: '重置',
    icon: Clock,
    className:
      'bg-[hsl(var(--status-pending-bg))] text-[hsl(var(--status-pending))] border-[hsl(var(--status-pending-border))] hover:bg-[hsl(var(--status-pending))] hover:text-white',
  },
];

export function TaskDetailPanel() {
  const {
    selectedTaskId,
    setSelectedTaskId,
    tasks,
    updateTaskStatus,
    updateTask,
    removeTask,
    roleCards,
    getEffectiveRoster,
    simulateCliExecution,
    daemonRuntimes,
    enableMockRunner,
    accounts,
    agentStatus,
  } = useTaskHubStore(useShallow((s) => ({
    selectedTaskId: s.selectedTaskId,
    setSelectedTaskId: s.setSelectedTaskId,
    tasks: s.tasks,
    updateTaskStatus: s.updateTaskStatus,
    updateTask: s.updateTask,
    removeTask: s.removeTask,
    roleCards: s.roleCards,
    getEffectiveRoster: s.getEffectiveRoster,
    simulateCliExecution: s.simulateCliExecution,
    daemonRuntimes: s.daemonRuntimes,
    enableMockRunner: s.enableMockRunner,
    accounts: s.accounts,
    agentStatus: s.agentStatus,
  })));
  const panelRef = useRef<HTMLDivElement>(null);
  const descEditRef = useRef<HTMLTextAreaElement>(null);
  const reviewNoteRef = useRef<HTMLTextAreaElement>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const task = tasks.find((t) => t.id === selectedTaskId);
  const { graph, isLoading: graphLoading, error: graphError, refresh: refreshGraph } = useTaskGraph(task?.conversationId);
  const agent = task ? getEffectiveRoster().find((a) => a.id === task.agentId) : null;
  const agentRunStatus = agent ? agentStatus[agent.id] : undefined;
  const isRunning = agentRunStatus === 'busy' || agentRunStatus === 'background';
  const isBackgroundRunning = agentRunStatus === 'background';

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedTaskId(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setSelectedTaskId]);

  const resolvedBinding = agent ? resolveAgentEngine(agent, accounts) : null;
  const resolvedEngine = resolvedBinding?.engine ?? agent?.cliEngine ?? 'opencode';
  const engineAvailable = daemonRuntimes.some((r) => r.engine === resolvedEngine && r.available)
    || (resolvedEngine === 'mock' && enableMockRunner);

  const handleDescEmoji = useCallback((emoji: string) => {
    const textarea = descEditRef.current;
    if (!textarea) {
      setEditValue((prev) => prev + emoji);
      return;
    }
    const start = textarea.selectionStart ?? editValue.length;
    const end = textarea.selectionEnd ?? start;
    const next = editValue.slice(0, start) + emoji + editValue.slice(end);
    setEditValue(next);
    requestAnimationFrame(() => {
      const pos = start + emoji.length;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    });
  }, [editValue]);

  const handleReviewNoteEmoji = useCallback((emoji: string) => {
    if (!task) return;
    const textarea = reviewNoteRef.current;
    const current = task.reviewNote ?? '';
    if (!textarea) {
      updateTaskStatus(task.id, task.status, current + emoji);
      return;
    }
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? start;
    const next = current.slice(0, start) + emoji + current.slice(end);
    updateTaskStatus(task.id, task.status, next);
    requestAnimationFrame(() => {
      const pos = start + emoji.length;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    });
  }, [editValue, task, updateTaskStatus]);

  if (!task) return null;

  // Dependency resolution
  const depTasks = task.dependencies
    .map((depId) => tasks.find((t) => t.id === depId))
    .filter(Boolean);

  // Filter actions to show only relevant transitions
  const availableActions = statusActions.filter(
    (a) => a.target !== task.status
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40 animate-fade-in"
        onClick={() => setSelectedTaskId(null)}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          'fixed top-0 right-0 h-full border-l border-[hsl(var(--border))]',
          'bg-[hsl(var(--bg-elevated))] shadow-[var(--shadow-lg)] z-50 flex flex-col animate-slide-in-r',
          'w-full max-w-[90vw] md:max-w-[450px]'
        )}
        role="dialog"
        aria-label={`任务详情：${task.title}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] font-mono font-bold text-[hsl(var(--text-tertiary))] tracking-wider">
              {task.id}
            </span>
            <StatusBadge status={task.status} size="md" showIcon />
          </div>
          <button
            type="button"
            onClick={() => setSelectedTaskId(null)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
            aria-label="关闭面板"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5 scrollbar-thin">
          {/* Title */}
          {editingField === 'title' ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => {
                updateTask(task.id, { title: editValue });
                setEditingField(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  updateTask(task.id, { title: editValue });
                  setEditingField(null);
                }
                if (e.key === 'Escape') setEditingField(null);
              }}
              className="text-lg font-medium text-[hsl(var(--text-primary))] bg-transparent border-b border-[hsl(var(--accent))] outline-none w-full"
            />
          ) : (
            <h2
              className="text-lg font-medium leading-tight text-[hsl(var(--text-primary))] cursor-pointer hover:bg-[hsl(var(--bg-muted))] rounded-sm px-1 -mx-1"
              onClick={() => { setEditingField('title'); setEditValue(task.title); }}
            >
              {task.title}
            </h2>
          )}

          {/* Description */}
          {editingField === 'description' ? (
            <div className="relative">
              <textarea
                ref={descEditRef}
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => {
                  updateTask(task.id, { description: editValue });
                  setEditingField(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditingField(null);
                }}
                rows={3}
                className="text-sm leading-relaxed text-[hsl(var(--text-secondary))] bg-transparent border border-[hsl(var(--border))] rounded-sm p-2 pr-10 outline-none w-full resize-y"
              />
              <div className="absolute top-1.5 right-1.5">
                <EmojiPickerButton onEmojiSelect={handleDescEmoji} placement="bottom-end" />
              </div>
            </div>
          ) : (
            <p
              className="text-sm leading-relaxed text-[hsl(var(--text-secondary))] cursor-pointer hover:bg-[hsl(var(--bg-muted))] rounded-sm px-2 py-1 -mx-2"
              onClick={() => { setEditingField('description'); setEditValue(task.description); }}
            >
              {task.description || '点击添加描述...'}
            </p>
          )}

          {/* Assignee */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
              负责人
            </label>
            {editingField === 'agent' ? (
              <div className="flex flex-col gap-1">
                {getEffectiveRoster().map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      updateTask(task.id, { agentId: a.id });
                      setEditingField(null);
                    }}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-sm text-left transition-colors',
                      'hover:bg-[hsl(var(--bg-card-hover))]',
                      a.id === task.agentId && 'bg-[hsl(var(--bg-muted))] border border-[hsl(var(--accent))]'
                    )}
                  >
                    <span className="text-sm">{a.emoji}</span>
                    <span className="text-sm font-medium text-[hsl(var(--text-primary))]">{a.name}</span>
                    <span className="text-xs text-[hsl(var(--text-tertiary))]">{a.roleLabel}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { updateTask(task.id, { agentId: '' }); setEditingField(null); }}
                  className="text-xs text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] px-3 py-1"
                >
                  清除分配
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingField('agent')}
                className="flex items-center gap-2 px-3 py-2 rounded-sm bg-[hsl(var(--bg-muted))] w-full text-left hover:bg-[hsl(var(--bg-card-hover))] transition-colors"
              >
                <span className="text-sm">{agent?.emoji ?? '🤖'}</span>
                <span className="text-sm font-medium text-[hsl(var(--text-primary))]">
                  {agent?.name ?? 'Unassigned'}
                </span>
                {agent?.roleCardId ? (() => {
                  const rc = roleCards.find((c) => c.id === agent.roleCardId);
                  return rc ? <RoleCardBadge card={rc} size="sm" /> : null;
                })() : (
                  agent && <span className="text-xs text-[hsl(var(--text-tertiary))]">{agent.roleLabel}</span>
                )}
              </button>
            )}
          </div>

          {/* Review/Block Note */}
          {(task.status === 'rejected' || task.status === 'blocked') && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                {task.status === 'rejected' ? '拒绝原因' : '阻塞原因'}
              </label>
              <div className="relative">
                <textarea
                  ref={reviewNoteRef}
                  value={task.reviewNote ?? ''}
                  onChange={(e) => {
                    updateTaskStatus(task.id, task.status, e.target.value);
                  }}
                  placeholder="填写原因..."
                  rows={2}
                  className="text-sm leading-relaxed bg-[hsl(var(--status-rejected-bg))] border border-[hsl(var(--status-rejected-border))] rounded-sm p-3 pr-10 outline-none w-full resize-y text-[hsl(var(--status-rejected))]"
                />
                <div className="absolute top-2.5 right-2.5">
                  <EmojiPickerButton onEmojiSelect={handleReviewNoteEmoji} placement="bottom-end" />
                </div>
              </div>
            </div>
          )}

          {/* Dependencies */}
          {depTasks.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                依赖
              </label>
              <div className="space-y-1.5">
                {depTasks.map((dep) =>
                  dep ? (
                    <button
                      key={dep.id}
                      type="button"
                      onClick={() => setSelectedTaskId(dep.id)}
                      className="flex items-center gap-2 w-full p-2.5 rounded-[var(--radius-sm)] bg-[hsl(var(--bg-muted))] hover:bg-[hsl(var(--bg-card-hover))] transition-colors text-left"
                    >
                      <Link2 className="w-3.5 h-3.5 text-[hsl(var(--text-tertiary))]" />
                      <span className="text-[11px] font-mono text-[hsl(var(--text-tertiary))]">
                        {dep.id}
                      </span>
                      <span className="text-[12px] text-[hsl(var(--text-primary))] truncate flex-1">
                        {dep.title}
                      </span>
                      <StatusBadge status={dep.status} />
                    </button>
                  ) : null
                )}
              </div>
            </div>
          )}

          {/* Artifacts */}
          {task.artifacts.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                产出物
              </label>
              <div className="space-y-1.5">
                {task.artifacts.map((art, i) => {
                  const Icon = artifactIcons[art.type];
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 p-2.5 rounded-[var(--radius-sm)] bg-[hsl(var(--bg-muted))]"
                    >
                      <Icon className="w-3.5 h-3.5 text-[hsl(var(--text-tertiary))]" />
                      <span className="text-[12px] text-[hsl(var(--text-primary))] flex-1">
                        {art.label}
                      </span>
                      {art.url && (
                        <ExternalLink className="w-3 h-3 text-[hsl(var(--text-tertiary))]" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {graphError && (
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))] p-2 text-xs text-[hsl(var(--status-rejected))]">
              {graphError}
            </div>
          )}

          <TaskGraphTimeline
            graph={graph}
            taskId={task.id}
            className={graphLoading ? 'opacity-60' : undefined}
          />

          <TaskGraphActionsPanel
            revision={graph?.revision ?? 0}
            task={{
              id: task.id,
              conversationId: task.conversationId,
              title: task.title,
              status: task.status,
              agentId: task.agentId,
            }}
            onChanged={refreshGraph}
          />

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <span className="block font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))] mb-0.5">
                创建时间
              </span>
              <span className="text-[hsl(var(--text-secondary))]">
                {new Date(task.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div>
              <span className="block font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))] mb-0.5">
                更新时间
              </span>
              <span className="text-[hsl(var(--text-secondary))]">
                {new Date(task.updatedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="p-4 border-t border-[hsl(var(--border))] space-y-3">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
            流转到
          </label>
          <div className="flex flex-wrap gap-2">
            {availableActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.target}
                  type="button"
                  onClick={() => updateTaskStatus(task.id, action.target)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border text-[11px] font-semibold transition-all duration-200',
                    action.className
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {action.label}
                </button>
              );
            })}
            {engineAvailable && task.status === 'in_progress' && (
              <button
                type="button"
                onClick={() => simulateCliExecution(task.id, `任务：${task.title}。请给出简短的进度更新。`, undefined)}
                disabled={isRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-primary))] text-[11px] font-semibold transition-all duration-200 hover:bg-[hsl(var(--bg-card-hover))] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <TerminalIcon className="w-3.5 h-3.5" />
                {isBackgroundRunning ? '等待子任务返回…' : (isRunning ? '智能体忙碌中…' : `运行 ${resolvedEngine}`)}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              removeTask(task.id);
              setSelectedTaskId(null);
              void refreshGraph();
            }}
            className="flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--status-blocked))] hover:underline mt-1"
          >
            <Trash2 className="w-3 h-3" />
            删除任务
          </button>
        </div>

        {/* Terminal View (Lower Half) */}
        {agent && (
        <div className="h-64 shrink-0 flex flex-col bg-[#111111] border-t-2 border-[hsl(var(--border))]">
          <div className="px-3 py-1.5 flex items-center justify-between border-b-2 border-[#333]">
            <span className="text-[10px] font-bold text-[#888] uppercase tracking-widest">
              {agent.name} 的控制台
            </span>
            {isRunning && (
              <span className="text-[10px] font-bold text-[hsl(var(--status-progress))] uppercase tracking-widest animate-pulse">
                {isBackgroundRunning ? '后台执行中' : '忙碌'}
              </span>
            )}
          </div>
          <div className="flex-1 relative overflow-hidden">
            <TerminalView agentId={agent.id} />
          </div>
        </div>
        )}
      </div>
    </>
  );
}
