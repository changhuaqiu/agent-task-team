'use client';

import { Activity, AlertTriangle, Brain, LoaderCircle } from 'lucide-react';
import type { AgentOperationSummary } from '@/lib/agent-response-presentation';
import { cn } from '@/lib/utils';
import { MarkdownContent } from './MarkdownContent';

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}
export function AgentThinkingDisclosure({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  if (!text) return null;
  return (
    <details
      data-testid="agent-thinking-disclosure"
      className="group/thinking mb-2 rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted)/0.7)] px-2.5 py-2"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] text-[hsl(var(--text-secondary))] marker:hidden">
        <Brain className={cn('size-3.5 shrink-0', isStreaming && 'text-[hsl(var(--accent))]')} />
        <span className="shrink-0 font-semibold">{isStreaming ? '正在思考' : '思考过程'}</span>
        <span className="min-w-0 flex-1 truncate text-[hsl(var(--text-tertiary))]">{preview(text)}</span>
      </summary>
      <div className="mt-2 border-t border-[hsl(var(--border-subtle))] pt-2 text-[11px] leading-5 text-[hsl(var(--text-secondary))]">
        <MarkdownContent content={text} />
      </div>
    </details>
  );
}

export function AgentOperationReceipt({
  summary,
  onOpenDetails,
}: {
  summary: AgentOperationSummary;
  onOpenDetails?: () => void;
}) {
  const label = summary.isActive
    ? `正在处理 · ${summary.operationCount} 个操作`
    : `已处理 ${summary.operationCount} 个操作`;
  const Icon = summary.errorCount > 0
    ? AlertTriangle
    : summary.isActive
      ? LoaderCircle
      : Activity;

  return (
    <button
      type="button"
      data-testid="agent-operation-receipt"
      onClick={onOpenDetails}
      disabled={!onOpenDetails}
      aria-label={`${label}${summary.errorCount ? ` · ${summary.errorCount} 个执行问题` : ''}${onOpenDetails ? ' · 查看运行详情' : ''}`}
      className={cn(
        'mt-2 inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors',
        summary.errorCount > 0
          ? 'border-[hsl(var(--status-blocked-border))] bg-[hsl(var(--status-blocked-bg))] text-[hsl(var(--status-blocked))]'
          : 'border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))]',
        onOpenDetails && 'hover:border-[hsl(var(--border))] hover:text-[hsl(var(--text-secondary))]',
      )}
    >
      <Icon className={cn('size-3 shrink-0', summary.isActive && summary.errorCount === 0 && 'animate-spin')} />
      <span className="truncate">{label}</span>
      {summary.errorCount > 0 && <span className="shrink-0">· {summary.errorCount} 个执行问题</span>}
    </button>
  );
}
