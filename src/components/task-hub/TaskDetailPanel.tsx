'use client';

import { useEffect, useRef } from 'react';
import {
  type TaskStatus,
  useTaskHubStore,
  resolveAgentEngine,
  AGENT_ROSTER,
} from '@/store/taskHubStore';
import { StatusBadge } from './StatusBadge';
import { TerminalView } from './TerminalView';
import { RoleCardBadge } from '@/components/role-card/RoleCardBadge';
import { cn } from '@/lib/utils';
import {
  X,
  Link2,
  FileText,
  GitPullRequest,
  FileWarning,
  ExternalLink,
  MessageSquareWarning,
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
  const selectedTaskId = useTaskHubStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  const tasks = useTaskHubStore((s) => s.tasks);
  const updateTaskStatus = useTaskHubStore((s) => s.updateTaskStatus);
  const removeTask = useTaskHubStore((s) => s.removeTask);
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const panelRef = useRef<HTMLDivElement>(null);

  const task = tasks.find((t) => t.id === selectedTaskId);
  const agent = task ? AGENT_ROSTER.find((a) => a.id === task.agentId) : null;

  const simulateCliExecution = useTaskHubStore((s) => s.simulateCliExecution);
  const isRunning = useTaskHubStore((s) => agent ? s.agentStatus[agent.id] === 'busy' : false);
  const daemonRuntimes = useTaskHubStore((s) => s.daemonRuntimes);
  const enableMockRunner = useTaskHubStore((s) => s.enableMockRunner);
  const accounts = useTaskHubStore((s) => s.accounts);

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

  if (!task || !agent) return null;

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
        className="fixed top-0 right-0 h-full w-full max-w-[450px] bg-[hsl(var(--bg-elevated))] border-l border-[hsl(var(--border))] shadow-[var(--shadow-lg)] z-50 flex flex-col animate-slide-in-r"
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
            className="p-1.5 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
            aria-label="关闭面板"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
          {/* Title */}
          <h2 className="text-[18px] font-bold leading-tight text-[hsl(var(--text-primary))]">
            {task.title}
          </h2>

          {/* Description */}
          <p className="text-[13px] leading-relaxed text-[hsl(var(--text-secondary))]">
            {task.description}
          </p>

          {/* Assignee */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
              负责人
            </label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[hsl(var(--bg-muted))]">
              <span className="text-sm">{agent.emoji}</span>
              <span className="text-[13px] font-medium text-[hsl(var(--text-primary))]">
                {agent.name}
              </span>
              {agent.roleCardId ? (
                <RoleCardBadge card={roleCards.find((c) => c.id === agent.roleCardId)!} size="sm" />
              ) : (
                <span className="text-[11px] text-[hsl(var(--text-tertiary))]">
                  {agent.roleLabel}
                </span>
              )}
            </div>
          </div>

          {/* Review Note */}
          {task.reviewNote && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                评审反馈
              </label>
              <div className="flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-[hsl(var(--status-rejected-bg))] border border-[hsl(var(--status-rejected-border))]">
                <MessageSquareWarning className="w-4 h-4 shrink-0 mt-0.5 text-[hsl(var(--status-rejected))]" />
                <p className="text-[12px] leading-relaxed text-[hsl(var(--status-rejected))]">
                  {task.reviewNote}
                </p>
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
                onClick={() => simulateCliExecution(task.id, `任务：${task.title}。请给出简短的进度更新。`, `agent-${agent.id}`)}
                disabled={isRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-primary))] text-[11px] font-semibold transition-all duration-200 hover:bg-[hsl(var(--bg-card-hover))] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <TerminalIcon className="w-3.5 h-3.5" />
                {isRunning ? '智能体忙碌中…' : `运行 ${resolvedEngine}`}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              removeTask(task.id);
              setSelectedTaskId(null);
            }}
            className="flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--status-blocked))] hover:underline mt-1"
          >
            <Trash2 className="w-3 h-3" />
            删除任务
          </button>
        </div>

        {/* Terminal View (Lower Half) */}
        <div className="h-64 shrink-0 flex flex-col bg-[#111111] border-t-2 border-[hsl(var(--border))]">
          <div className="px-3 py-1.5 flex items-center justify-between border-b-2 border-[#333]">
            <span className="text-[10px] font-bold text-[#888] uppercase tracking-widest">
              {agent.name} 的控制台
            </span>
            {isRunning && (
              <span className="text-[10px] font-bold text-[hsl(var(--status-progress))] uppercase tracking-widest animate-pulse">
                忙碌
              </span>
            )}
          </div>
          <div className="flex-1 relative overflow-hidden">
            <TerminalView agentId={agent.id} />
          </div>
        </div>
      </div>
    </>
  );
}
