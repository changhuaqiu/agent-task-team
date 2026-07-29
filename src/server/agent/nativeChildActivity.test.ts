import { describe, expect, it } from 'vitest';
import { NativeChildActivityTracker } from './nativeChildActivity';

describe('NativeChildActivityTracker', () => {
  it('returns to running only after the matching terminal result', () => {
    const tracker = new NativeChildActivityTracker();

    expect(tracker.update({
      type: 'tool_use',
      content: '',
      tool: { name: 'Task', callId: 'task-1' },
    })).toEqual({ status: 'awaiting_children', reason: 'tool:Task' });
    expect(tracker.update({
      type: 'tool_result',
      content: '',
      tool: { name: 'Task', callId: 'task-1', status: 'in_progress' },
    })).toBeUndefined();
    expect(tracker.hasPendingCalls).toBe(true);
    expect(tracker.update({
      type: 'tool_result',
      content: 'done',
      tool: { name: 'Task', callId: 'task-1', status: 'completed' },
    })).toEqual({ status: 'running', reason: 'tool_complete:Task' });
    expect(tracker.hasPendingCalls).toBe(false);
  });

  it('waits for every concurrent native child call', () => {
    const tracker = new NativeChildActivityTracker();
    tracker.update({
      type: 'tool_use',
      content: '',
      tool: { name: 'Agent', callId: 'agent-1' },
    });
    expect(tracker.update({
      type: 'tool_use',
      content: '',
      tool: { name: 'Task', callId: 'task-2' },
    })).toBeUndefined();
    expect(tracker.update({
      type: 'tool_result',
      content: 'done',
      tool: { name: 'Agent', callId: 'agent-1', status: 'completed' },
    })).toBeUndefined();
    expect(tracker.hasPendingCalls).toBe(true);
    expect(tracker.update({
      type: 'tool_result',
      content: 'failed',
      tool: { name: 'Task', callId: 'task-2', status: 'failed' },
    })?.status).toBe('running');
    expect(tracker.hasPendingCalls).toBe(false);
  });
});
