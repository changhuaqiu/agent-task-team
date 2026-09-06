'use client';

import { useRef, useState } from 'react';
import { GitMerge, PauseCircle, PlayCircle, Send, Split, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { workspaceCommandGateway } from '@/lib/workspace-command';

export interface TaskGraphActionTask {
  id: string;
  conversationId: string;
  projectPath: string;
  title: string;
  status: string;
  agentId: string;
}

interface TaskGraphActionsPanelProps {
  task: TaskGraphActionTask;
  revision: number;
  onChanged?: () => void | Promise<void>;
  className?: string;
  agents?: Array<{ id: string; name: string }>;
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `task-graph-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function TaskGraphActionsPanel({
  task,
  revision,
  onChanged,
  className,
  agents = [],
}: TaskGraphActionsPanelProps) {
  const [splitText, setSplitText] = useState('');
  const [ownerAgentId, setOwnerAgentId] = useState(task.agentId);
  const [mergeSourceText, setMergeSourceText] = useState(task.id);
  const [mergeTargetTitle, setMergeTargetTitle] = useState(`${task.title} 集成`);
  const [error, setError] = useState<string | null>(null);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const commandIntents = useRef(new Map<string, { idempotencyKey: string; issuedAt: string }>());

  async function run(body: Record<string, unknown>) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setReceiptMessage(null);
    try {
      const intentSignature = JSON.stringify({ body, revision, deliveryId: task.conversationId });
      const intent = commandIntents.current.get(intentSignature) ?? {
        idempotencyKey: newIdempotencyKey(),
        issuedAt: new Date().toISOString(),
      };
      commandIntents.current.set(intentSignature, intent);
      const { action, ...input } = body;
      if (typeof action !== 'string') throw new Error('缺少任务操作类型');
      const receipt = await workspaceCommandGateway.submit({
        type: 'task.graph.apply',
        deliveryId: task.conversationId,
        projectPath: task.projectPath,
        actor: { type: 'user', id: 'webui:local-user' },
        issuedAt: intent.issuedAt,
        expectedRevision: revision,
        idempotencyKey: intent.idempotencyKey,
        action: action as 'createRootTask' | 'splitTask' | 'mergeTasks' | 'reopenTask' | 'blockTask' | 'resumeTask' | 'assignTask' | 'cancelTask',
        input,
      });
      if (receipt.status !== 'accepted') throw new Error(receipt.userMessage ?? '任务操作被拒绝');
      commandIntents.current.delete(intentSignature);
      setError(null);
      setReceiptMessage(action === 'resumeTask' ? '恢复请求已接纳；系统会重新检查依赖与权限，尚不代表执行成功。' : '操作已接纳，正在更新任务。');
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const buttonClass = 'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50';

  return (
    <section className={cn('space-y-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] p-3', className)}>
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
          任务操作
        </label>
        {isSubmitting && <span className="text-[10px] text-[hsl(var(--text-tertiary))]">处理中…</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {task.status === 'blocked' ? (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => run({ action: 'resumeTask', taskId: task.id })}
            className={cn(buttonClass, 'border-lime-400/50 bg-lime-500/10 text-lime-700')}
          >
            <PlayCircle className="h-3.5 w-3.5" />
            检查后重试
          </button>
        ) : null}
      </div>
      {task.status === 'blocked' && <p className="text-xs leading-5 text-[hsl(var(--text-secondary))]">先解决上方原因，再重试。权限被拒绝时，重试不会替你授权；可向负责人补充说明或调整执行方案。</p>}
      <details className="pt-2"><summary className="cursor-pointer text-xs font-medium">更多任务操作</summary><div className="mt-3 space-y-3">
      {task.status !== 'blocked' && (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => run({ action: 'blockTask', taskId: task.id, reason: '用户手动标记阻塞' })}
            className={cn(buttonClass, 'border-amber-400/60 bg-amber-500/10 text-amber-700')}
          >
            <PauseCircle className="h-3.5 w-3.5" />
            标记阻塞
          </button>
        )}
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            if (!window.confirm(`确认取消「${task.title}」？这个操作会保留历史，但任务会退出当前流。`)) return;
            void run({ action: 'cancelTask', taskId: task.id, reason: '用户取消任务', confirmed: true });
          }}
          className={cn(buttonClass, 'border-gray-400/50 bg-gray-500/10 text-gray-600')}
        >
          <XCircle className="h-3.5 w-3.5" />
          取消任务
        </button>

      <div className="space-y-1.5">
        <label htmlFor={`assign-${task.id}`} className="text-[10px] font-medium text-[hsl(var(--text-secondary))]">
          改派给
        </label>
        <select id={`assign-${task.id}`} aria-label="改派给" value={ownerAgentId} onChange={(event) => setOwnerAgentId(event.target.value)} className="field">
          <option value="">选择负责人</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          {ownerAgentId && !agents.some((agent) => agent.id === ownerAgentId) && <option value={ownerAgentId}>{ownerAgentId}（原负责人）</option>}
        </select>
        <button
          type="button"
          disabled={isSubmitting || ownerAgentId.trim().length === 0 || ownerAgentId.trim() === task.agentId}
          onClick={() => {
            if (!window.confirm(`确认把「${task.title}」改派给 ${ownerAgentId.trim()}？`)) return;
            void run({
              action: 'assignTask',
              taskId: task.id,
              ownerAgentId: ownerAgentId.trim(),
              confirmed: true,
            });
          }}
          className={cn(buttonClass, 'border-violet-400/50 bg-violet-500/10 text-violet-600')}
        >
          <Send className="h-3.5 w-3.5" />
          改派
        </button>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`split-${task.id}`} className="text-[10px] font-medium text-[hsl(var(--text-secondary))]">
          拆分子任务
        </label>
        <textarea
          id={`split-${task.id}`}
          aria-label="拆分子任务"
          value={splitText}
          onChange={(event) => setSplitText(event.target.value)}
          rows={2}
          placeholder="每行一个子任务，例如：API 合约"
          className="w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-2 py-1.5 text-xs outline-none focus:border-[hsl(var(--accent))]"
        />
        <button
          type="button"
          disabled={isSubmitting || splitText.trim().length === 0}
          onClick={() => run({
            action: 'splitTask',
            parentTaskId: task.id,
            children: splitText
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((title) => ({ title, ownerAgentId: task.agentId })),
          })}
          className={cn(buttonClass, 'border-blue-400/50 bg-blue-500/10 text-blue-600')}
        >
          <Split className="h-3.5 w-3.5" />
          拆分
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-medium text-[hsl(var(--text-secondary))]">
          合并任务
        </label>
        <input
          aria-label="合并来源任务"
          value={mergeSourceText}
          onChange={(event) => setMergeSourceText(event.target.value)}
          placeholder="来源任务 ID，用逗号分隔"
          className="w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-2 py-1.5 text-xs outline-none focus:border-[hsl(var(--accent))]"
        />
        <input
          aria-label="合并目标标题"
          value={mergeTargetTitle}
          onChange={(event) => setMergeTargetTitle(event.target.value)}
          placeholder="合并后的任务标题"
          className="w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-2 py-1.5 text-xs outline-none focus:border-[hsl(var(--accent))]"
        />
        <button
          type="button"
          disabled={isSubmitting || mergeSourceText.trim().length === 0 || mergeTargetTitle.trim().length === 0}
          onClick={() => {
            if (!window.confirm('确认合并这些任务？源任务会保留历史并标记为已合并。')) return;
            void run({
              action: 'mergeTasks',
              sourceTaskIds: mergeSourceText.split(',').map((item) => item.trim()).filter(Boolean),
              target: { title: mergeTargetTitle.trim(), ownerAgentId: task.agentId },
              confirmed: true,
            });
          }}
          className={cn(buttonClass, 'border-cyan-400/50 bg-cyan-500/10 text-cyan-600')}
        >
          <GitMerge className="h-3.5 w-3.5" />
          合并
        </button>
      </div>

      </div></details>
      {receiptMessage && <p role="status" className="text-xs leading-5">{receiptMessage}</p>}
      {error && (
        <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))] p-2 text-xs text-[hsl(var(--status-rejected))]">
          {error}
        </div>
      )}
    </section>
  );
}
