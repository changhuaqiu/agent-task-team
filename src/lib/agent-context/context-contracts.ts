import type { ContextArchetype, ContextCluster } from './injectionPolicy';
import type { ContextScenario } from './scenarioResolver';

export type ContextTrigger = 'user_turn' | 'a2a_handoff' | 'resume';

export type ContextScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'global'; key: string };

export type ContextSubject =
  | { kind: 'agent'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'team'; id: string }
  | { kind: 'goal'; id: string }
  | { kind: 'artifact'; id: string };

export type ContextVisibility =
  | { kind: 'team' }
  | { kind: 'agent'; agentId: string }
  | { kind: 'role'; archetypes: ContextArchetype[] };

export interface ContextFragment {
  id: string;
  kind: string;
  cluster: ContextCluster;
  scope: ContextScope;
  subject: ContextSubject;
  producer: string;
  version: string;
  content: string | { artifactRef: string; summary?: string };
  visibility: ContextVisibility;
  freshness: {
    observedAt: string;
    expiresAt?: string;
  };
  evidenceRefs: string[];
  required?: boolean;
}

/**
 * ContextContributor 的轻量输入会在注册表边界归一化为统一的六维
 * ContextArtifact。这样业务模块只负责提供事实，不需要各自实现生命周期、
 * 一致性与交付策略。
 */
export interface ContextArtifact extends ContextFragment {
  semantic: {
    kind: string;
    cluster: ContextCluster;
  };
  source: {
    provider: string;
    owner: string;
    revision: string;
    observedAt: string;
  };
  lifecycle: {
    class: 'static' | 'versioned' | 'event' | 'snapshot' | 'ephemeral';
    expiresAt?: string;
  };
  consistency: 'strong' | 'causal' | 'eventual';
  delivery: {
    mode: 'bootstrap' | 'on_change' | 'always' | 'delta' | 'jit';
    channel: 'tools' | 'system' | 'message' | 'reference';
    required: boolean;
    importance: number;
  };
}

export interface ContextQuery {
  scenario: ContextScenario;
  trigger: ContextTrigger;
  conversationId: string;
  agentId: string;
  archetype: ContextArchetype;
  taskId?: string;
  deliveryRunId?: string;
  requestText: string;
  budgetTokens: number;
  requiredContributorIds: string[];
  now: string;
}

export interface ContextContributor {
  readonly id: string;
  readonly required?: boolean;
  contribute(query: ContextQuery): Promise<ContextFragment[]>;
}

export type ContextOmissionReason =
  | 'invalid_fragment'
  | 'contributor_failed'
  | 'required_contributor_empty'
  | 'duplicate_replaced'
  | 'project_scope_mismatch'
  | 'global_scope_not_allowed'
  | 'visibility_denied'
  | 'expired'
  | 'scenario_omitted'
  | 'budget_trimmed';

export interface ContextOmission {
  fragmentId: string;
  producer: string;
  reason: ContextOmissionReason;
  detail?: string;
  required: boolean;
}

export class RequiredContextError extends Error {
  readonly code = 'required_context_missing';

  constructor(
    readonly missingRequired: string[],
    readonly omissions: ContextOmission[],
  ) {
    super(`required_context_missing: ${missingRequired.join(',')}`);
    this.name = 'RequiredContextError';
  }
}

export interface ContextSnapshot {
  id: string;
  /** ContextManager 生成的组装快照 id；runtime finalization 后保留用于追溯。 */
  assemblyId?: string;
  query: Omit<ContextQuery, 'requestText'> & { requestDigest: string };
  fragmentRefs: Array<{
    id: string;
    kind: string;
    producer: string;
    version: string;
    evidenceRefs: string[];
    lifecycle: ContextArtifact['lifecycle']['class'];
    consistency: ContextArtifact['consistency'];
    deliveryMode: ContextArtifact['delivery']['mode'];
    scope: ContextScope;
    subject: ContextSubject;
    visibility: ContextVisibility;
    sourceOwner: string;
    deliveryChannel: ContextArtifact['delivery']['channel'];
    importance: number;
  }>;
  capabilities: string[];
  constraints: string[];
  missingRequired: string[];
  omissions: ContextOmission[];
  runtimeInput?: {
    transport: 'acp';
    systemPromptChannel: 'none' | 'instructions' | 'backend' | 'inline';
    promptDigest: string;
    systemPromptDigest?: string;
    combinedDigest: string;
  };
  compiledPrompt: string;
  createdAt: string;
}
