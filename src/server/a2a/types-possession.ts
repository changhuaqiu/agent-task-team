export type PossessionHolderType = 'user' | 'agent' | 'system';

export type PossessionChainStatus = 'active' | 'completed' | 'aborted' | 'timeout';

export type PossessionStatus =
  | 'open'
  | 'handoff_drafted'
  | 'handoff_offered'
  | 'handoff_accepted'
  | 'handoff_started'
  | 'completed'
  | 'aborted'
  | 'timeout';

export type PassStatus =
  | 'drafted'
  | 'validated'
  | 'offered'
  | 'accepted'
  | 'starting'
  | 'started'
  | 'completed'
  | 'blocked'
  | 'rejected'
  | 'timeout'
  | 'error';

export type PassIntent =
  | 'delegate'
  | 'review'
  | 'answer'
  | 'verify'
  | 'implement'
  | 'plan'
  | 'reject'
  | 'escalate'
  | 'coord'
  | 'handoff_test';

export type PassBlockPhase =
  | 'holder'
  | 'intent'
  | 'roster'
  | 'policy'
  | 'budget'
  | 'dedup'
  | 'offer'
  | 'start'
  | 'run'
  | 'idle';

export interface A2APossessionChain {
  id: string;
  conversationId: string;
  rootTriggerType: 'user_turn' | 'scheduled' | 'system';
  rootTriggerId: string;
  status: PossessionChainStatus;
  currentHolderId: string;
  createdAt: string;
  completedAt?: string;
  config: Record<string, unknown>;
}

export interface A2APossession {
  id: string;
  chainId: string;
  holderId: string;
  holderType: PossessionHolderType;
  status: PossessionStatus;
  startedAt: string;
  completedAt?: string;
  summary?: string;
}

export interface A2APass {
  id: string;
  chainId: string;
  fromPossessionId: string;
  fromHolderId: string;
  toAgentId: string;
  status: PassStatus;
  intent: PassIntent;
  reason?: string;
  phase?: PassBlockPhase;
  handoffPacketId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface A2AHandoffPacket {
  id: string;
  chainId: string;
  passId: string;
  fromHolderId: string;
  toAgentId: string;
  title: string;
  requestedAction: string;
  possessionSummary: string;
  relevantDecisions: string[];
  evidenceRefs: Array<{ label: string; path?: string; taskId?: string; url?: string }>;
  constraints: string[];
  openQuestions: string[];
  forbiddenBehaviors: string[];
  sourceMessageIds: string[];
  createdAt: string;
}
