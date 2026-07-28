import { describe, expect, it } from 'vitest';
import type { RuntimeAccountInput, TeamRuntime } from '@/lib/team-runtime';
import type { InvocationRow } from '../repositories/invocation-repo';
import {
  executionProfileChanged,
  resolveFailureAwareRuntimeProfile,
} from './runtime-profile-recovery';

const accounts: RuntimeAccountInput[] = [
  { id: 'opencode-account', provider: 'opencode', enabled: true },
  { id: 'codex-account', provider: 'openai', enabled: true },
  { id: 'global-claude-account', provider: 'anthropic', enabled: true },
];

const runtime: TeamRuntime = {
  conversationId: 'conv-1',
  roster: [{
    id: 'luigi',
    displayName: 'Luigi',
    source: 'team-pack-role',
    accountIds: ['opencode-account', 'codex-account'],
    skills: [],
  }],
  communicationPolicy: {
    canSend: () => true,
    explainBlock: () => undefined,
  },
  workflowPolicy: {
    assignInitialTask: () => null,
    getNextAgent: () => null,
  },
};

function invocation(overrides: Partial<InvocationRow>): InvocationRow {
  return {
    id: 'inv-1',
    conversation_id: 'conv-1',
    task_id: 'task-1',
    agent_id: 'luigi',
    session_id: 'session-1',
    status: 'terminated',
    outcome: 'failed',
    engine: 'opencode',
    account_id: 'opencode-account',
    cli_session_id: null,
    prompt: '',
    exit_code: 0,
    reason_code: 'acp_empty_completion',
    usage: null,
    error_message: null,
    dispatch_status: null,
    token_usage: null,
    lease_expiry: null,
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}

function resolve(invocations: InvocationRow[], activeSessionId = 'session-1') {
  return resolveFailureAwareRuntimeProfile({
    runtime,
    agentId: 'luigi',
    accounts,
    invocations,
    taskId: 'task-1',
    activeSessionId,
  });
}

describe('resolveFailureAwareRuntimeProfile', () => {
  it('moves to the next configured account after an empty ACP completion', () => {
    expect(resolve([invocation({})])?.execution).toEqual({
      engine: 'codex',
      accountId: 'codex-account',
    });
  });

  it('keeps the successful account sticky in the active logical session', () => {
    const successfulCodex = invocation({
      id: 'inv-2',
      status: 'terminated',
      outcome: 'completed',
      engine: 'codex',
      account_id: 'codex-account',
      reason_code: null,
      created_at: '2026-07-29T00:01:00.000Z',
    });
    expect(resolve([invocation({}), successfulCodex])?.execution).toEqual({
      engine: 'codex',
      accountId: 'codex-account',
    });
  });

  it('keeps an active session successful account sticky across tasks', () => {
    const successfulCodex = invocation({
      id: 'inv-2',
      task_id: 'task-before',
      status: 'terminated',
      outcome: 'completed',
      engine: 'codex',
      account_id: 'codex-account',
      reason_code: null,
    });
    expect(resolve([successfulCodex])?.execution).toEqual({
      engine: 'codex',
      accountId: 'codex-account',
    });
  });

  it('does not rotate after a tool call completed without final text', () => {
    const toolSilent = invocation({
      reason_code: 'acp_tool_completion_missing',
    });
    expect(resolve([toolSilent])?.execution).toEqual({
      engine: 'opencode',
      accountId: 'opencode-account',
    });
  });

  it('fails closed after every configured account returns an empty completion', () => {
    const failedCodex = invocation({
      id: 'inv-2',
      session_id: 'session-2',
      engine: 'codex',
      account_id: 'codex-account',
      created_at: '2026-07-29T00:01:00.000Z',
    });
    expect(resolve([invocation({}), failedCodex], 'session-2')).toBeNull();
  });

  it('never borrows a globally enabled account not assigned to the role', () => {
    const failedCodex = invocation({
      id: 'inv-2',
      engine: 'codex',
      account_id: 'codex-account',
      created_at: '2026-07-29T00:01:00.000Z',
    });
    const profile = resolve([invocation({}), failedCodex]);
    expect(profile).toBeNull();
  });
});

describe('executionProfileChanged', () => {
  it('detects an account and engine transition', () => {
    expect(executionProfileChanged(invocation({}), {
      engine: 'codex',
      accountId: 'codex-account',
    })).toBe(true);
  });

  it('does not rotate an unchanged execution profile', () => {
    expect(executionProfileChanged(invocation({}), {
      engine: 'opencode',
      accountId: 'opencode-account',
    })).toBe(false);
  });

  it('detects a runtime transition within the same engine and account', () => {
    expect(executionProfileChanged(invocation({
      runtime_id: 'opencode-local',
    }), {
      engine: 'opencode',
      runtimeId: 'opencode-bridge',
      accountId: 'opencode-account',
    })).toBe(true);
  });
});
