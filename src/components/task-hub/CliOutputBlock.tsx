'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Loader2, Check, AlertTriangle, Wrench } from 'lucide-react';
import type { ToolEvent } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';

interface CliOutputBlockProps {
  events: ToolEvent[];
  isStreaming: boolean;
  streamText?: string;
}

function ToolRow({ event, isLast }: { event: ToolEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (event.type === 'error') {
    return (
      <div className="flex items-start gap-2 px-3 py-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-px" />
        <span className="text-[11px] text-red-400 break-all font-mono">{event.detail || event.label}</span>
      </div>
    );
  }

  if (event.type === 'tool_result') {
    return (
      <div className="flex items-start gap-2 px-3 py-1.5">
        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-px" />
        <span className="text-[11px] text-emerald-400/80 break-all font-mono truncate">{event.label}: {event.detail ? event.detail.slice(0, 120) : '(done)'}</span>
      </div>
    );
  }

  const isActive = event.type === 'tool_use' && isLast;
  const label = extractLabel(event.label);
  const primaryArg = extractPrimaryArg(event.detail);

  return (
    <button
      type="button"
      onClick={() => setExpanded(!expanded)}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-[5px] text-left transition-colors font-mono text-[11px]',
        isActive && 'rounded',
      )}
      style={isActive ? {
        backgroundColor: 'rgba(139, 92, 246, 0.15)',
        borderLeft: '2px solid #8B5CF6',
      } : undefined}
    >
      {isActive ? (
        <Loader2 className="w-3.5 h-3.5 text-violet-400 shrink-0 animate-spin" />
      ) : (
        <Check className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" />
      )}
      <Wrench className={cn('w-3 h-3 shrink-0', isActive ? 'text-violet-300' : 'text-[#E2E8F0]')} />
      <span className={cn('font-medium truncate', isActive ? 'text-violet-300' : 'text-[#E2E8F0]')}>
        {label}
      </span>
      {primaryArg && (
        <span className={cn('truncate flex-1', isActive ? 'text-violet-400/70' : 'text-[#64748B]')}>
          {primaryArg}
        </span>
      )}
      {event.detail && (
        <ChevronRight
          className="w-3 h-3 text-[#64748B] shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
        />
      )}
    </button>
  );
}

function extractLabel(label: string): string {
  const match = label.match(/->\s*(.+)$/);
  return match ? match[1].trim() : label;
}

function extractPrimaryArg(detail?: string): string | null {
  if (!detail) return null;
  try {
    const obj = JSON.parse(detail);
    return obj.file_path || obj.command || obj.pattern || obj.url || obj.query || obj.path || null;
  } catch {
    const pathMatch = detail.match(/"file_path"\s*:\s*"([^"]+)"/);
    if (pathMatch) return pathMatch[1];
    const cmdMatch = detail.match(/"command"\s*:\s*"([^"]+)"/);
    if (cmdMatch) return cmdMatch[1];
    return null;
  }
}

export function CliOutputBlock({ events, isStreaming, streamText }: CliOutputBlockProps) {
  const [expanded, setExpanded] = useState(true);
  const [bodyExpanded, setBodyExpanded] = useState(true);
  const [userInteracted, setUserInteracted] = useState(false);
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
      setBodyExpanded(true);
      setUserInteracted(false);
    } else if (prevStreamingRef.current && !isStreaming && !userInteracted) {
      setExpanded(false);
      setBodyExpanded(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, userInteracted]);

  const toolUseEvents = events.filter((e) => e.type === 'tool_use' || e.type === 'tool_result');
  const toolCount = toolUseEvents.length;
  const activeTool = isStreaming ? toolUseEvents[toolUseEvents.length - 1] : undefined;
  const needsCollapse = events.length > 5;

  const handleToggle = () => {
    setUserInteracted(true);
    setExpanded(!expanded);
  };

  const handleBodyToggle = () => {
    setUserInteracted(true);
    setBodyExpanded(!bodyExpanded);
  };

  return (
    <div
      className="mt-2 mb-1 overflow-hidden"
      style={{ backgroundColor: '#1A1625', borderRadius: 10 }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-2 text-[11px] font-mono transition-colors hover:brightness-110"
        style={{ padding: '8px 12px', color: '#94A3B8', backgroundColor: '#1A1625' }}
      >
        <span style={{ color: '#8B5CF6' }}>
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <span className="font-medium">CLI Output</span>
        <span className="text-[#475569]">·</span>
        <span className={isStreaming ? 'text-violet-400 font-semibold' : 'text-[#22D3EE] font-semibold'}>
          {isStreaming ? 'streaming' : 'done'}
        </span>
        <span className="text-[#475569]">·</span>
        <span>{toolCount} tools</span>
        {activeTool && (
          <>
            <span className="text-[#475569]">·</span>
            <span className="text-violet-300 truncate">{extractLabel(activeTool.label)}</span>
          </>
        )}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div style={{ backgroundColor: '#1F1A2E' }}>
          <div style={{ height: 1, backgroundColor: '#334155' }} />
          <div
            className="space-y-0.5 overflow-hidden transition-[max-height] duration-200"
            style={{ padding: '4px 8px', maxHeight: bodyExpanded ? 'none' : 200 }}
          >
            {events.map((event, i) => (
              <ToolRow
                key={event.id}
                event={event}
                isLast={i === events.length - 1 && isStreaming}
              />
            ))}
          </div>
          {/* Stream text — show agent's text output inside CLI block during streaming */}
          {streamText && isStreaming && (
            <>
              <div style={{ height: 1, backgroundColor: '#334155', margin: '4px 8px' }} />
              <div style={{ padding: '4px 12px 8px', maxHeight: 120 }} className="overflow-hidden">
                <span className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider">stdout</span>
                <div className="text-[11px] text-[#E2E8F0] whitespace-pre-wrap break-words font-mono leading-relaxed mt-1">
                  {streamText}
                </div>
              </div>
            </>
          )}
          {needsCollapse && !bodyExpanded && (
            <button
              type="button"
              onClick={handleBodyToggle}
              className="w-full text-[9px] text-[#64748B] hover:text-[#94A3B8] py-1 text-center transition-colors"
            >
              ▼ 展开全部 ({events.length} 条)
            </button>
          )}
          {needsCollapse && bodyExpanded && !isStreaming && (
            <button
              type="button"
              onClick={handleBodyToggle}
              className="w-full text-[9px] text-[#64748B] hover:text-[#94A3B8] py-1 text-center transition-colors"
            >
              ▲ 收起
            </button>
          )}
        </div>
      )}
    </div>
  );
}
