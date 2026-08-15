'use client';

import { useState } from 'react';
import type { TokenUsage, TokenUsageSummary } from '@/store/types';

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface TokenSummaryCardProps {
  summary: TokenUsageSummary;
}

function TokenSummaryCard({ summary }: TokenSummaryCardProps) {
  const modelEntries = Object.entries(summary.byModel);
  const hasMultipleModels = modelEntries.length > 1;
  const totalTokens =
    summary.totalInputTokens +
    summary.totalOutputTokens +
    summary.totalCacheReadTokens +
    summary.totalCacheWriteTokens;

  return (
    <div className="rounded-[4px] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-3 py-1.5 bg-[hsl(var(--bg-muted))] border-b border-[hsl(var(--border-subtle))] flex items-center justify-between">
        <span className="text-[11px] font-bold text-[hsl(var(--text-secondary))]">Token 用量</span>
        <span className="text-[12px] font-bold font-mono text-[hsl(var(--text-primary))] tabular-nums">
          {formatTokenCount(totalTokens)}
        </span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        <TokenRow label="Input" value={summary.totalInputTokens} color="text-[hsl(var(--accent))]" />
        <TokenRow label="Output" value={summary.totalOutputTokens} color="text-[hsl(var(--status-progress))]" />
        <TokenRow label="Cache Read" value={summary.totalCacheReadTokens} color="text-[hsl(var(--status-done))]" />
        <TokenRow label="Cache Write" value={summary.totalCacheWriteTokens} color="text-[hsl(var(--status-pending))]" />
      </div>
      {hasMultipleModels && (
        <div className="px-3 py-2 border-t border-[hsl(var(--border-subtle))]">
          <span className="text-[9px] font-bold text-[hsl(var(--text-tertiary))] uppercase tracking-wider">By Model</span>
          <div className="mt-1 space-y-1">
            {modelEntries.map(([model, stats]) => (
              <div key={model} className="flex items-center gap-2 text-[10px]">
                <span className="text-[hsl(var(--text-secondary))] truncate flex-1 font-mono">{model}</span>
                <span className="text-[hsl(var(--text-tertiary))] font-mono tabular-nums">
                  {formatTokenCount(stats.input + stats.output + stats.cacheRead + stats.cacheWrite)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TokenRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-[hsl(var(--text-tertiary))]">{label}</span>
      <span className={`text-[11px] font-mono font-bold tabular-nums ${color}`}>
        {formatTokenCount(value)}
      </span>
    </div>
  );
}

interface TokenBadgeProps {
  usage: TokenUsage;
}

export function TokenBadge({ usage }: TokenBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const total = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;

  if (total === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1 text-[10px] font-mono text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-secondary))] px-1.5 py-0.5 rounded-[2px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border-subtle))] transition-colors"
      >
        🔤 {formatTokenCount(total)}
      </button>
      {expanded && (
        <div className="absolute bottom-full left-0 mb-1 z-20 min-w-[180px]">
          <TokenSummaryCard
            summary={{
              totalInputTokens: usage.inputTokens,
              totalOutputTokens: usage.outputTokens,
              totalCacheReadTokens: usage.cacheReadTokens,
              totalCacheWriteTokens: usage.cacheWriteTokens,
              byModel: {
                [usage.model]: {
                  input: usage.inputTokens,
                  output: usage.outputTokens,
                  cacheRead: usage.cacheReadTokens,
                  cacheWrite: usage.cacheWriteTokens,
                },
              },
            }}
          />
        </div>
      )}
    </div>
  );
}
