'use client';

// SpanCallTree：单次 agent turn 内的 span 调用树 + 时间甘特图。
//
// 设计依据：ACP 协议只产生两层 span（turn 根 → context/plan/tool/message 子），
// 所有子 span 的 parent 都指向根。本组件忠实呈现这两层，并用 span 的
// started_at / durationMs 还原工具的并行与串行（区间重叠 = 并行），
// 而非虚构协议没有的深层嵌套。
//
// 数据来源：/api/observability 返回的 trace.spans[]（含 parent_span_id、
// started_at、durationMs、parsedAttributes）。payload 懒加载由消费者负责。

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

export interface SpanNode {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: string;
  status: string;
  started_at: string;
  durationMs?: number;
  parsedAttributes?: Record<string, unknown>;
}

interface SpanCallTreeProps {
  spans: SpanNode[];
  /** 用于计算甘特条绝对时间区间的锚点（一般是 trace 的 root started_at）。 */
  rootStartedAt: string;
  /** trace 总时长，用于归一化甘特条宽度。 */
  totalMs: number;
  /** 当前选中的 span（用于高亮 + 下钻）。 */
  selectedSpanId?: string;
  /** 点击 span 行触发下钻。 */
  onSelectSpan?: (spanId: string) => void;
}

// --- span kind 颜色（与现有 ProjectObservabilityPanel/Drawer 保持一致）---
function kindColor(kind: string, status: string): string {
  if (status === 'error') return 'bg-rose-500';
  if (kind === 'tool') return 'bg-amber-500';
  if (kind === 'context') return 'bg-violet-400';
  if (kind === 'workflow') return 'bg-slate-400';
  if (kind === 'message') return 'bg-cyan-500';
  return 'bg-violet-500'; // agent / root
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '进行中';
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function toolName(span: SpanNode): string {
  return String(span.parsedAttributes?.['gen_ai.tool.name'] ?? span.name);
}

// --- 建树：把扁平 spans 组成 root → children 的两层结构 ---

interface TreeNode {
  span: SpanNode;
  children: TreeNode[];
}

function buildTree(spans: SpanNode[]): TreeNode | null {
  if (spans.length === 0) return null;
  // root：无 parent 且 kind=agent；退化取最早一条
  const ordered = [...spans].sort(
    (a, b) => a.started_at.localeCompare(b.started_at) || a.span_id.localeCompare(b.span_id),
  );
  const rootSpan = ordered.find((s) => !s.parent_span_id && s.kind === 'agent') ?? ordered[0];
  const children = ordered
    .filter((s) => s.span_id !== rootSpan.span_id)
    .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.span_id.localeCompare(b.span_id));
  return { span: rootSpan, children: children.map((span) => ({ span, children: [] })) };
}

export function SpanCallTree({
  spans,
  rootStartedAt,
  totalMs,
  selectedSpanId,
  onSelectSpan,
}: SpanCallTreeProps) {
  const tree = useMemo(() => buildTree(spans), [spans]);
  const rootStart = useMemo(() => new Date(rootStartedAt).getTime(), [rootStartedAt]);
  const span = Math.max(1, totalMs);

  // 计算每个 span 的甘特条 left% / width%
  const gantt = useMemo(() => {
    const map = new Map<string, { leftPct: number; widthPct: number }>();
    for (const s of spans) {
      const offset = Math.max(0, new Date(s.started_at).getTime() - rootStart);
      const dur = s.durationMs ?? 1;
      map.set(s.span_id, {
        leftPct: Math.min(100, (offset / span) * 100),
        widthPct: Math.max(2, Math.min(100 - (offset / span) * 100, (dur / span) * 100)),
      });
    }
    return map;
  }, [spans, rootStart, span]);

  if (!tree) {
    return <div className="rounded-md border border-dashed border-[hsl(var(--border))] p-3 text-center text-[9px] text-[hsl(var(--text-tertiary))]">本次执行无可观测 span</div>;
  }

  // 检测工具并行（同 kind=tool 的相邻区间重叠）
  const toolSpans = tree.children.filter((c) => c.span.kind === 'tool');
  const hasParallelTools = toolSpans.some((c) => {
    const g = gantt.get(c.span.span_id);
    if (!g) return false;
    return toolSpans.some((other) => {
      if (other.span.span_id === c.span.span_id) return false;
      const og = gantt.get(other.span.span_id);
      if (!og) return false;
      // 区间重叠
      return g.leftPct < og.leftPct + og.widthPct && og.leftPct < g.leftPct + g.widthPct;
    });
  });

  const renderRow = (node: TreeNode, depth: number) => {
    const g = gantt.get(node.span.span_id);
    const isSelected = selectedSpanId === node.span.span_id;
    const isRunning = node.span.durationMs === undefined;
    return (
      <button
        key={node.span.span_id}
        type="button"
        onClick={() => onSelectSpan?.(node.span.span_id)}
        title={`${node.span.kind} · ${toolName(node.span)}`}
        className={cn(
          'grid w-full grid-cols-[140px_1fr_52px] items-center gap-2 rounded px-1.5 py-1 text-left text-[9px] transition-colors',
          isSelected ? 'bg-[hsl(var(--accent-soft))]' : 'hover:bg-[hsl(var(--bg-card-hover))]',
        )}
      >
        {/* 树列：缩进 + 图标点 + 名称 */}
        <span className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 10 }}>
          <span className={cn('inline-block size-1.5 shrink-0 rounded-full', kindColor(node.span.kind, node.span.status))} />
          <span className="truncate text-[hsl(var(--text-secondary))]">
            {node.span.kind === 'tool' ? toolName(node.span) : node.span.name}
          </span>
        </span>
        {/* 甘特列 */}
        <span className="relative h-2 overflow-hidden rounded bg-[hsl(var(--bg-muted))]">
          {g && (
            <span
              className={cn('absolute h-2 rounded', kindColor(node.span.kind, node.span.status), isRunning && 'animate-pulse')}
              style={{ left: `${g.leftPct}%`, width: `${g.widthPct}%` }}
            />
          )}
        </span>
        {/* 时长列 */}
        <span className="text-right tabular-nums text-[hsl(var(--text-tertiary))]">{formatDuration(node.span.durationMs)}</span>
      </button>
    );
  };

  return (
    <div className="space-y-0.5">
      {/* 时间轴表头 */}
      <div className="grid grid-cols-[140px_1fr_52px] items-center gap-2 px-1.5 pb-1 text-[8px] text-[hsl(var(--text-tertiary))]">
        <span>调用</span>
        <span className="relative">
          <span className="flex justify-between">
            <span>0ms</span>
            <span>{formatDuration(span)}</span>
          </span>
        </span>
        <span />
      </div>

      {/* 根 span */}
      {renderRow(tree, 0)}

      {/* 子 span */}
      {tree.children.map((child) => renderRow(child, 1))}

      {/* 并行提示 */}
      {hasParallelTools && (
        <div className="px-1.5 pt-1 text-[8px] text-[hsl(var(--text-tertiary))]">
          ↳ 存在区间重叠的工具调用 = 并行执行
        </div>
      )}
    </div>
  );
}
