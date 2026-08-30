'use client';

import { useState } from 'react';
import { ChevronDown, GitBranch, ShieldAlert } from 'lucide-react';
import {
  compareDispatchReceipts,
  useTaskHubStore,
  type A2APossessionView,
  type DispatchReceipt,
  type InternalEvent,
} from '@/store/taskHubStore';
import type { Agent } from '@/store/agentStore';
import { cn } from '@/lib/utils';

const EMPTY_DISPATCH_RECEIPTS: DispatchReceipt[] = [];
const EMPTY_INTERNAL_EVENTS: InternalEvent[] = [];

function agentLabel(agentId: string | undefined, roster: Agent[]) {
  if (!agentId) return '待定';
  if (agentId === 'user' || agentId === 'human') return '用户';
  const agent = roster.find((item) => item.id === agentId);
  return agent ? `${agent.emoji} ${agent.name}` : agentId;
}

function statusLabel(status: A2APossessionView['handoffs'][number]['status']) {
  switch (status) {
    case 'drafted':
      return '已生成交接草案';
    case 'validated':
      return '交接已校验';
    case 'offered':
      return '已发起交接';
    case 'accepted':
      return '已接纳';
    case 'starting':
      return '启动中';
    case 'started':
      return '已接球';
    case 'blocked':
      return '交接被阻止';
    case 'rejected':
      return '交接被拒绝';
    case 'error':
      return '交接失败';
    case 'timeout':
      return '交接超时';
    case 'completed':
      return '已完成';
    default:
      return status;
  }
}

function receiptPhaseLabel(phase: DispatchReceipt['phase']) {
  switch (phase) {
    case 'requested':
      return '已请求';
    case 'sent':
      return '已送达';
    case 'acknowledged':
      return '已确认接纳';
    case 'rejected':
      return '未接纳';
    default:
      return phase;
  }
}

const RECEIPT_REASON_LABELS: Record<string, string> = {
  a2a_no_available_agent: '当前没有可接手的 Agent',
  runtime_start_failed: 'Agent 启动失败',
  runtime_model_unavailable: '所选模型当前不可用，请检查 Agent 的账号与模型',
  acp_empty_completion: 'Agent 没有返回结果，请检查账号和模型后重试',
  acp_tool_completion_missing: 'Agent 完成了操作，但没有提交最终结果',
  runtime_node_missing: 'Agent 运行环境不可用',
  runtime_unreachable: 'Agent 暂时无法连接',
  runtime_profile_missing: 'Agent 未配置运行环境',
  runtime_transport_lost: 'Agent 连接已中断',
  dependency_unavailable: '依赖服务暂时不可用',
  human_decision_requested: '等待你的决定',
  agent_reported_blocked: 'Agent 报告无法继续',
  cancelled: '本次运行已取消',
};

function receiptReasonLabel(reasonCode: string | undefined) {
  if (!reasonCode) return undefined;
  return RECEIPT_REASON_LABELS[reasonCode] ?? 'Agent 暂时未能接手';
}

const INTERNAL_REASON_CODE = /^[a-z][a-z0-9]*(?:[_:.-][a-z0-9]+)+$/;

function handoffReasonLabel(reason: string | undefined) {
  if (!reason) return undefined;
  if (!INTERNAL_REASON_CODE.test(reason)) return reason;
  if (RECEIPT_REASON_LABELS[reason]) return RECEIPT_REASON_LABELS[reason];
  if (reason.startsWith('runtime_')) return 'Agent 运行环境暂时不可用';
  if (reason.startsWith('human_')) return '等待你的处理';
  if (reason.startsWith('agent_')) return 'Agent 暂时无法继续';
  return '本次交接未能完成';
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function A2APossessionStrip({ conversationId }: { conversationId: string }) {
  return <ConversationPossessionStrip key={conversationId} conversationId={conversationId} />;
}

function ConversationPossessionStrip({ conversationId }: { conversationId: string }) {
  const [expanded, setExpanded] = useState(false);
  const a2a = useTaskHubStore((state) => state.a2aByConversation[conversationId]);
  const dispatchReceipts = useTaskHubStore(
    (state) => state.dispatchReceiptsByConversation[conversationId] ?? EMPTY_DISPATCH_RECEIPTS,
  );
  const events = useTaskHubStore(
    (state) => state.eventsByConversation[conversationId] ?? EMPTY_INTERNAL_EVENTS,
  );
  const roster = useTaskHubStore((state) => state.agentRoster);
  const latestRuntimeTerminal = events
    .filter((event) => event.type === 'run.finished')
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  const runtimeFailures = (() => {
    if (
      !latestRuntimeTerminal?.payload
      || typeof latestRuntimeTerminal.payload !== 'object'
    ) return [];
    const payload = latestRuntimeTerminal.payload as Record<string, unknown>;
    if (typeof payload.code !== 'number' || payload.code === 0 || typeof payload.agentId !== 'string') return [];
    return [{
      kind: 'failure' as const,
      id: latestRuntimeTerminal.id,
      timestamp: latestRuntimeTerminal.timestamp,
      failure: {
        agentId: payload.agentId,
        taskId: typeof payload.taskId === 'string' ? payload.taskId : undefined,
        reasonCode: typeof payload.reasonCode === 'string' ? payload.reasonCode : undefined,
      },
    }];
  })();

  const records = [
    ...(a2a?.handoffs ?? []).map((handoff) => ({
      kind: 'handoff' as const,
      id: handoff.id,
      timestamp: handoff.timestamp,
      handoff,
    })),
    ...dispatchReceipts.map((receipt) => ({
      kind: 'receipt' as const,
      id: receipt.receiptId,
      timestamp: receipt.createdAt,
      receipt,
    })),
    ...runtimeFailures,
  ].sort((left, right) => {
    const timestampOrder = Date.parse(right.timestamp) - Date.parse(left.timestamp);
    if (timestampOrder !== 0) return timestampOrder;
    if (left.kind === 'receipt' && right.kind === 'receipt') {
      return compareDispatchReceipts(right.receipt, left.receipt);
    }
    if (left.kind !== right.kind) return left.kind === 'receipt' ? -1 : 1;
    return right.id.localeCompare(left.id);
  });
  const latestRecord = records[0];
  if (!latestRecord) return null;

  const latest = latestRecord.kind === 'handoff' ? latestRecord.handoff : undefined;
  const latestReceipt = latestRecord.kind === 'receipt' ? latestRecord.receipt : undefined;
  const latestFailure = latestRecord.kind === 'failure' ? latestRecord.failure : undefined;
  const holder = latestFailure
    ? agentLabel(latestFailure.agentId, roster)
    : latestReceipt
    ? agentLabel(latestReceipt.targetAgentId, roster)
    : (a2a?.currentHolderIds.map((agentId) => agentLabel(agentId, roster)).join('、') || 'Agent');
  const from = agentLabel(latest?.fromAgentId, roster);
  const to = agentLabel(latest?.toAgentId, roster);
  const isBlocked = latest
    ? latest.status === 'blocked'
      || latest.status === 'timeout'
      || latest.status === 'rejected'
      || latest.status === 'error'
    : latestReceipt?.phase === 'rejected' || Boolean(latestFailure);
  const recordCount = records.length;

  return (
    <div
      className={cn(
        'relative z-20 shrink-0 border-b px-3 text-[10px]',
        isBlocked
          ? 'border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300'
          : 'border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] text-[hsl(var(--text-secondary))]',
      )}
      role="status"
      aria-live="polite"
      data-testid="a2a-status-bar"
    >
      <div className="flex h-8 min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {isBlocked
            ? <ShieldAlert className="size-3.5 shrink-0" />
            : <GitBranch className="size-3.5 shrink-0 text-[hsl(var(--text-tertiary))]" />}
          <span className="truncate font-medium" data-testid="a2a-status-summary">
            {latest
              ? `${from} → ${to} · ${statusLabel(latest.status)}`
              : latestFailure
                ? `${holder} · 运行失败`
                : `${holder} · ${receiptPhaseLabel(latestReceipt!.phase)}`}
          </span>
        </div>
        {recordCount > 1 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[9px] text-[hsl(var(--text-tertiary))] transition-colors hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-primary))]"
            aria-expanded={expanded}
            aria-label="查看 Agent 交接记录"
          >
            查看记录
            <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>
      {(handoffReasonLabel(latest?.reason) || receiptReasonLabel(latestReceipt?.reasonCode ?? latestFailure?.reasonCode)) && isBlocked && (
        <div className="border-t border-amber-400/20 py-1.5 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
          {handoffReasonLabel(latest?.reason) || receiptReasonLabel(latestReceipt?.reasonCode ?? latestFailure?.reasonCode)}
        </div>
      )}
      {expanded && recordCount > 1 && (
        <div
          className="absolute left-1/2 top-full z-50 mt-2 max-h-72 w-[min(560px,calc(100%-24px))] -translate-x-1/2 overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-2.5 shadow-xl"
          data-testid="a2a-record-popover"
        >
          <div className="mb-2 px-2 text-[10px] font-semibold text-[hsl(var(--text-secondary))]">Agent 交接记录</div>
          <div className="flex flex-col gap-1">
            {records.map((record, index) => {
              const handoff = record.kind === 'handoff' ? record.handoff : undefined;
              const receipt = record.kind === 'receipt' ? record.receipt : undefined;
              const failure = record.kind === 'failure' ? record.failure : undefined;
              const blocked = handoff
                ? handoff.status === 'blocked'
                  || handoff.status === 'timeout'
                  || handoff.status === 'rejected'
                  || handoff.status === 'error'
                : receipt?.phase === 'rejected' || Boolean(failure);
              const reason = handoffReasonLabel(handoff?.reason)
                ?? receiptReasonLabel(receipt?.reasonCode ?? failure?.reasonCode);
              return (
                <div
                  key={`${record.kind}:${record.id}`}
                  className="grid grid-cols-[52px_1fr] gap-2 rounded-lg px-2 py-1.5 hover:bg-[hsl(var(--bg-muted))]"
                >
                  <div className="text-[9px] font-bold tabular-nums text-[hsl(var(--text-tertiary))]">
                    {formatTime(record.timestamp)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={cn(
                        'text-[10px] font-bold',
                        blocked ? 'text-amber-500' : index === 0 ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--text-secondary))]'
                      )}>
                        {handoff
                          ? statusLabel(handoff.status)
                          : failure
                            ? '运行失败'
                            : `派发回执: ${receiptPhaseLabel(receipt!.phase)}`}
                      </span>
                      <span className="text-[10px] text-[hsl(var(--text-secondary))] truncate">
                        {handoff
                          ? `${agentLabel(handoff.fromAgentId, roster)} → ${agentLabel(handoff.toAgentId, roster)}`
                          : failure
                            ? `${agentLabel(failure.agentId, roster)}${failure.taskId ? ` / ${failure.taskId}` : ''}`
                            : `${agentLabel(receipt!.targetAgentId, roster)}${receipt!.taskId ? ` / ${receipt!.taskId}` : ''}`}
                      </span>
                    </div>
                    {reason && blocked && (
                      <div className="mt-0.5 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
                        {reason}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
