'use client';

import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  Globe,
  Loader2,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { ToolEvent } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';

interface CliOutputBlockProps {
  events: ToolEvent[];
  isStreaming: boolean;
  streamText?: string;
}

type ToolTone = 'active' | 'done' | 'error' | 'idle';

function extractLabel(label: string): string {
  const match = label.match(/->\s*(.+)$/);
  return match ? match[1].trim() : label;
}

function parseDetail(detail?: string): unknown {
  if (!detail) return undefined;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

function stringifyDetail(detail?: string): string {
  const parsed = parseDetail(detail);
  if (parsed === undefined) return '';
  if (typeof parsed === 'string') return parsed;
  return JSON.stringify(parsed, null, 2);
}

function extractPrimaryArg(detail?: string): string | null {
  const parsed = parseDetail(detail);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const value =
      obj.file_path ??
      obj.path ??
      obj.command ??
      obj.pattern ??
      obj.query ??
      obj.url ??
      obj.repo_full_name ??
      obj.repository_full_name;
    return typeof value === 'string' ? value : null;
  }

  if (!detail) return null;
  const pathMatch = detail.match(/"(?:file_path|path)"\s*:\s*"([^"]+)"/);
  if (pathMatch) return pathMatch[1];
  const cmdMatch = detail.match(/"command"\s*:\s*"([^"]+)"/);
  if (cmdMatch) return cmdMatch[1];
  return detail.length > 72 ? `${detail.slice(0, 72)}...` : detail;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function getToolTone(event: ToolEvent, isLast: boolean): ToolTone {
  if (event.type === 'error') return 'error';
  if (event.type === 'tool_use' && isLast) return 'active';
  if (event.type === 'tool_result') return 'done';
  return 'idle';
}

function ToolGlyph({ label, tone }: { label: string; tone: ToolTone }) {
  const normalized = label.toLowerCase();
  const className = cn(
    'w-3.5 h-3.5 shrink-0',
    tone === 'active' && 'text-[hsl(var(--status-pending))]',
    tone === 'done' && 'text-[hsl(var(--status-done))]',
    tone === 'error' && 'text-[hsl(var(--status-blocked))]',
    tone === 'idle' && 'text-[hsl(var(--text-tertiary))]',
  );

  if (tone === 'active') return <Loader2 className={cn(className, 'animate-spin')} />;
  if (tone === 'error') return <AlertTriangle className={className} />;
  if (normalized.includes('grep') || normalized.includes('search') || normalized.includes('find')) return <Search className={className} />;
  if (normalized.includes('fetch') || normalized.includes('url') || normalized.includes('web')) return <Globe className={className} />;
  if (normalized.includes('read') || normalized.includes('write') || normalized.includes('edit') || normalized.includes('file')) return <FileText className={className} />;
  if (normalized.includes('exec') || normalized.includes('command') || normalized.includes('bash')) return <Terminal className={className} />;
  if (normalized.includes('code') || normalized.includes('patch')) return <Code2 className={className} />;
  if (tone === 'done') return <Check className={className} />;
  return <Wrench className={className} />;
}

function ToolRow({ event, isLast }: { event: ToolEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const label = extractLabel(event.label);
  const tone = getToolTone(event, isLast);
  const primaryArg = extractPrimaryArg(event.detail);
  const detailText = stringifyDetail(event.detail);
  const canExpand = Boolean(detailText);

  return (
    <div
      className={cn(
        'group relative rounded-lg border transition-colors',
        tone === 'active' && 'border-[hsl(var(--status-pending-border))] bg-[hsl(var(--status-pending-bg))]',
        tone === 'done' && 'border-[hsl(var(--status-done-border))] bg-[hsl(var(--status-done-bg))]',
        tone === 'error' && 'border-[hsl(var(--status-blocked-border))] bg-[hsl(var(--status-blocked-bg))]',
        tone === 'idle' && 'border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]',
      )}
    >
      <button
        type="button"
        onClick={() => canExpand && setExpanded(!expanded)}
        className="w-full px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <ToolGlyph label={label} tone={tone} />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[11px] font-semibold',
              tone === 'active' && 'text-[hsl(var(--text-primary))]',
              tone === 'done' && 'text-[hsl(var(--text-primary))]',
              tone === 'error' && 'text-[hsl(var(--text-primary))]',
              tone === 'idle' && 'text-[hsl(var(--text-primary))]',
            )}
          >
            {label}
          </span>
          <span className="text-[9px] font-mono text-[hsl(var(--text-tertiary))]">{formatTime(event.timestamp)}</span>
          {canExpand && (
            <ChevronRight
              className="w-3 h-3 shrink-0 text-[hsl(var(--text-tertiary))] transition-transform"
              style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
            />
          )}
        </div>

        {primaryArg && (
          <div className="mt-1 truncate pl-5 font-mono text-[10px] text-[hsl(var(--text-secondary))]">
            {primaryArg}
          </div>
        )}
      </button>

      {expanded && canExpand && (
        <div className="mx-3 mb-3 rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] p-2">
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[hsl(var(--text-secondary))]">
            {detailText}
          </pre>
        </div>
      )}
    </div>
  );
}

export function CliOutputBlock({ events, isStreaming, streamText }: CliOutputBlockProps) {
  const [expandedPreference, setExpandedPreference] = useState<boolean | null>(null);
  const [bodyExpandedPreference, setBodyExpandedPreference] = useState<boolean | null>(null);
  const expanded = expandedPreference ?? isStreaming;
  const bodyExpanded = bodyExpandedPreference ?? isStreaming;

  const toolEvents = events.filter((e) => e.type === 'tool_use' || e.type === 'tool_result');
  const errorCount = events.filter((e) => e.type === 'error').length;
  const activeTool = isStreaming ? toolEvents[toolEvents.length - 1] : undefined;
  const needsCollapse = events.length > 5;
  const visibleEvents = bodyExpanded ? events : events.slice(-5);

  const handleToggle = () => {
    setExpandedPreference(!expanded);
  };

  const handleBodyToggle = () => {
    setBodyExpandedPreference(!bodyExpanded);
  };

  return (
    <div className="mt-2 mb-1 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-[var(--shadow-md)]">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full bg-[linear-gradient(135deg,hsl(var(--bg-card)),hsl(var(--bg-muted)))] px-3 py-2.5 text-left transition hover:bg-[hsl(var(--bg-card-hover))]"
      >
        <div className="flex items-center gap-2">
          <span className="text-[hsl(var(--text-tertiary))]">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md border',
              isStreaming
                ? 'border-[hsl(var(--status-pending-border))] bg-[hsl(var(--status-pending-bg))]'
                : 'border-[hsl(var(--status-done-border))] bg-[hsl(var(--status-done-bg))]',
            )}
          >
            {isStreaming ? (
              <Activity className="w-3.5 h-3.5 animate-pulse text-[hsl(var(--status-pending))]" />
            ) : (
              <Terminal className="w-3.5 h-3.5 text-[hsl(var(--status-done))]" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-wide text-[hsl(var(--text-primary))]">CLI Trace</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                  isStreaming
                    ? 'bg-[hsl(var(--status-pending-bg))] text-[hsl(var(--status-pending))]'
                    : 'bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done))]',
                )}
              >
                {isStreaming ? '运行中' : '已完成'}
              </span>
              {errorCount > 0 && (
                <span className="rounded-full bg-[hsl(var(--status-blocked-bg))] px-1.5 py-0.5 text-[9px] font-bold text-[hsl(var(--status-blocked))]">
                  {errorCount} 错误
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-[hsl(var(--text-tertiary))]">
              {events.length} 条事件
              {activeTool ? ` · 当前：${extractLabel(activeTool.label)}` : toolEvents.length > 0 ? ` · ${toolEvents.length} 个工具事件` : ''}
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[hsl(var(--border-subtle))] bg-[linear-gradient(180deg,hsl(var(--bg-muted)),hsl(var(--bg-card)))]">
          <div className="space-y-2 p-2.5">
            {visibleEvents.map((event) => (
              <ToolRow
                key={event.id}
                event={event}
                isLast={event.id === events[events.length - 1]?.id && isStreaming}
              />
            ))}
          </div>

          {streamText && isStreaming && (
            <div className="mx-2.5 mb-2.5 rounded-lg border border-[hsl(var(--status-pending-border))] bg-[hsl(var(--status-pending-bg))] p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--status-pending))] animate-pulse" />
                <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--text-tertiary))]">Live Output</span>
              </div>
              <div className="max-h-36 overflow-hidden whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[hsl(var(--text-primary))]">
                {streamText}
              </div>
            </div>
          )}

          {needsCollapse && (
            <button
              type="button"
              onClick={handleBodyToggle}
              className="w-full border-t border-[hsl(var(--border-subtle))] py-1.5 text-center text-[10px] text-[hsl(var(--text-tertiary))] transition hover:bg-[hsl(var(--bg-card-hover))] hover:text-[hsl(var(--text-secondary))]"
            >
              {bodyExpanded ? '收起为最近 5 条' : `展开全部 ${events.length} 条`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
