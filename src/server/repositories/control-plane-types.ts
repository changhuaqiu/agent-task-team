export type RuntimeNodeKind = 'browser' | 'daemon' | 'bridge' | 'remote' | 'worktree';

export type RuntimeNodeStatus = 'reachable' | 'stale' | 'unreachable' | 'suspended';

export type RuntimeTrustLevel = 'local' | 'paired' | 'verified' | 'trusted' | 'privileged';

export type AgentBindingStatus = 'idle' | 'busy' | 'unreachable' | 'misconfigured' | 'suspended';

export type DispatchSource = 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';

export type DispatchIntent = 'answer' | 'implement' | 'review' | 'verify' | 'plan' | 'delegate';

export type ExecutionEnvelopeStatus =
  | 'drafted'
  | 'validated'
  | 'blocked'
  | 'queued'
  | 'routed'
  | 'sent'
  | 'started'
  | 'failed'
  | 'completed'
  | 'expired';

export interface ExecutionEnvelopePayload {
  prompt?: string;
  handoffPacketId?: string;
  contextRefs: string[];
  executorKind?: 'daemon_process' | 'bridge_proxy' | 'tmux_pane';
  executorOwnerNodeId?: string;
  executorRef?: {
    invocationId: string;
    scopeId: string;
    worktreeId?: string;
    tmuxServerId?: string;
    paneId?: string;
  };
}
