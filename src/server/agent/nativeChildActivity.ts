import type { AgentEvent } from './types';

export type NativeChildActivityTransition = {
  status: 'awaiting_children' | 'running';
  reason: string;
};

export function isTerminalToolResult(event: AgentEvent): boolean {
  return event.type === 'tool_result'
    && event.tool?.status !== 'pending'
    && event.tool?.status !== 'in_progress';
}

function isNativeChildTool(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === 'agent' || normalized === 'task';
}

function callKey(event: AgentEvent): string | undefined {
  if (!event.tool?.name || !isNativeChildTool(event.tool.name)) return undefined;
  return event.tool.callId || `legacy:${event.tool.name.trim().toLowerCase()}`;
}

/**
 * Projects runtime-native Agent/Task tool lifecycles into platform activity.
 * The runtime adapter still owns and drains the actual child agents.
 */
export class NativeChildActivityTracker {
  private readonly activeCalls = new Set<string>();

  get hasPendingCalls(): boolean {
    return this.activeCalls.size > 0;
  }

  update(event: AgentEvent): NativeChildActivityTransition | undefined {
    const key = callKey(event);
    if (!key) return undefined;

    if (event.type === 'tool_use') {
      const wasEmpty = this.activeCalls.size === 0;
      this.activeCalls.add(key);
      return wasEmpty
        ? { status: 'awaiting_children', reason: `tool:${event.tool?.name || 'child'}` }
        : undefined;
    }

    if (!isTerminalToolResult(event)) return undefined;
    const removed = this.activeCalls.delete(key);
    return removed && this.activeCalls.size === 0
      ? { status: 'running', reason: `tool_complete:${event.tool?.name || 'child'}` }
      : undefined;
  }
}
