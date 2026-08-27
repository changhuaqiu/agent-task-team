export type RuntimeNodeKind = 'browser' | 'daemon' | 'remote' | 'worktree';

const RUNTIME_NODE_KINDS: ReadonlySet<string> = new Set([
  'browser',
  'daemon',
  'remote',
  'worktree',
]);

export function isRuntimeNodeKind(value: unknown): value is RuntimeNodeKind {
  return typeof value === 'string' && RUNTIME_NODE_KINDS.has(value);
}

export type RuntimeNodeStatus = 'reachable' | 'stale' | 'unreachable' | 'suspended';

export type RuntimeTrustLevel = 'local' | 'paired' | 'verified' | 'trusted' | 'privileged';

export type AgentBindingStatus = 'idle' | 'busy' | 'unreachable' | 'misconfigured' | 'suspended';

export type DispatchSource = 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';

export type DispatchIntent = 'answer' | 'implement' | 'review' | 'verify' | 'plan' | 'delegate';

export type ExecutionEnvelopeStatus =
  | 'drafted'
  | 'validated'
  | 'routed'
  | 'sent'
  | 'acknowledged'
  | 'rejected'
  | 'expired';

export interface ExecutionEnvelopePayload {
  prompt?: string;
  handoffPacketId?: string;
  sourceMessageId?: string;
  contextRefs: string[];
}
