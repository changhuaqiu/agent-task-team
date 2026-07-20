import type {
  ContextArtifact,
  ContextContributor,
  ContextFragment,
  ContextOmission,
  ContextQuery,
} from './context-contracts';
import type { ContextArchetype, ContextCluster } from './injectionPolicy';

const CONTEXT_CLUSTERS = new Set<ContextCluster>([
  'identity', 'protocol', 'capability', 'situation', 'focus', 'dialog',
]);
const CONTEXT_ARCHETYPES = new Set<ContextArchetype>(['planner', 'reviewer', 'worker']);
const GLOBAL_CLUSTERS = new Set<ContextCluster>(['identity', 'protocol', 'capability']);
const GLOBAL_SUBJECTS = new Set(['agent', 'team']);

interface OrderedFragment {
  fragment: ContextArtifact;
  order: number;
}

export interface ContextCollection {
  artifacts: ContextArtifact[];
  omissions: ContextOmission[];
  requiredFragmentIds: string[];
  requiredContributorIds: string[];
}

function omission(
  fragment: Partial<ContextFragment> & Pick<ContextFragment, 'id' | 'producer'>,
  reason: ContextOmission['reason'],
  detail?: string,
): ContextOmission {
  return {
    fragmentId: fragment.id,
    producer: fragment.producer,
    reason,
    detail,
    required: fragment.required === true,
  };
}

function isValidDate(value: string | undefined): boolean {
  return Boolean(value) && Number.isFinite(Date.parse(value!));
}

function validateFragment(fragment: unknown): string | undefined {
  if (!fragment || typeof fragment !== 'object') return 'fragment must be an object';
  const value = fragment as Partial<ContextFragment>;
  if (typeof value.id !== 'string' || !value.id.trim()) return 'id is required';
  if (typeof value.kind !== 'string' || !value.kind.trim()) return 'kind is required';
  if (!CONTEXT_CLUSTERS.has(value.cluster as ContextCluster)) return 'cluster is invalid';
  if (typeof value.producer !== 'string' || !value.producer.trim()) return 'producer is required';
  if (typeof value.version !== 'string' || !value.version.trim()) return 'version is required';
  if (!value.scope || (value.scope.kind !== 'project' && value.scope.kind !== 'global')) {
    return 'scope is invalid';
  }
  if (value.scope.kind === 'project' && (!value.scope.projectId || typeof value.scope.projectId !== 'string')) {
    return 'project scope is invalid';
  }
  if (value.scope.kind === 'global' && (!value.scope.key || typeof value.scope.key !== 'string')) {
    return 'global scope is invalid';
  }
  if (!value.subject || !['agent', 'task', 'project', 'team', 'goal', 'artifact'].includes(value.subject.kind)) {
    return 'subject is invalid';
  }
  if (typeof value.subject.id !== 'string' || !value.subject.id.trim()) return 'subject id is required';
  if (!value.visibility || !['team', 'agent', 'role'].includes(value.visibility.kind)) {
    return 'visibility is invalid';
  }
  if (value.visibility.kind === 'agent'
    && (typeof value.visibility.agentId !== 'string' || !value.visibility.agentId.trim())) {
    return 'visibility agent is invalid';
  }
  if (value.visibility.kind === 'role'
    && (!Array.isArray(value.visibility.archetypes)
      || value.visibility.archetypes.length === 0
      || value.visibility.archetypes.some(item => !CONTEXT_ARCHETYPES.has(item)))) {
    return 'visibility roles are invalid';
  }
  if (typeof value.content === 'string' && !value.content.trim()) return 'content is empty';
  if (
    !value.content
    || (typeof value.content !== 'string'
      && (typeof value.content !== 'object'
        || typeof value.content.artifactRef !== 'string'
        || !value.content.artifactRef.trim()))
  ) {
    return 'artifactRef is required';
  }
  if (!isValidDate(value.freshness?.observedAt)) return 'observedAt must be an ISO date';
  if (value.freshness?.expiresAt && !isValidDate(value.freshness.expiresAt)) {
    return 'expiresAt must be an ISO date';
  }
  if (!Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.some(item => typeof item !== 'string')) {
    return 'evidenceRefs must be a string array';
  }
  return undefined;
}

function visibilityAllows(fragment: ContextArtifact, query: ContextQuery): boolean {
  if (fragment.visibility.kind === 'team') return true;
  if (fragment.visibility.kind === 'agent') {
    return fragment.visibility.agentId === query.agentId;
  }
  return fragment.visibility.archetypes.includes(query.archetype);
}

function shouldReplace(current: ContextArtifact, candidate: ContextArtifact): boolean {
  const currentObservedAt = Date.parse(current.freshness.observedAt);
  const candidateObservedAt = Date.parse(candidate.freshness.observedAt);
  if (candidateObservedAt !== currentObservedAt) return candidateObservedAt > currentObservedAt;
  if (candidate.version !== current.version) return candidate.version.localeCompare(current.version) > 0;
  return candidate.producer.localeCompare(current.producer) > 0;
}

function normalizeFragment(fragment: ContextFragment): ContextArtifact {
  const eventKinds = new Set([
    'legacy.userMessage',
    'legacy.a2a',
    'legacy.teamLog',
  ]);
  const versionedKinds = new Set([
    'legacy.task',
    'legacy.skill',
    'delivery.goal',
    'delivery.policy',
  ]);
  const lifecycle = fragment.freshness.expiresAt
    ? 'ephemeral'
    : eventKinds.has(fragment.kind)
      ? 'event'
    : versionedKinds.has(fragment.kind) || fragment.kind.startsWith('legacy.skill:')
      ? 'versioned'
    : fragment.cluster === 'identity'
      ? 'static'
      : fragment.cluster === 'dialog'
        ? 'snapshot'
        : fragment.cluster === 'situation' || fragment.cluster === 'focus'
          ? 'snapshot'
          : 'versioned';
  const channel = fragment.cluster === 'capability'
    ? 'tools'
    : fragment.cluster === 'identity'
      ? 'system'
      : typeof fragment.content === 'string'
        ? 'message'
        : 'reference';
  const deliveryMode = lifecycle === 'static'
    ? 'bootstrap'
    : lifecycle === 'event'
      ? 'delta'
      : channel === 'reference'
        ? 'jit'
        : lifecycle === 'versioned'
          ? 'on_change'
          : 'always';
  const consistency = fragment.kind === 'legacy.a2a' || fragment.kind.includes('handoff')
      ? 'causal'
      : fragment.subject.kind === 'task' || fragment.subject.kind === 'goal'
        ? 'strong'
        : 'eventual';
  const importanceByCluster: Record<ContextCluster, number> = {
    identity: 0.9,
    protocol: 0.8,
    capability: 0.6,
    situation: 0.6,
    focus: 0.8,
    dialog: 0.3,
  };
  const legacyOwnerByKind: Record<string, string> = {
    'legacy.userMessage': 'message-log',
    'legacy.history': 'message-log',
    'legacy.teamLog': 'team-log',
    'legacy.task': 'task-graph',
    'legacy.a2a': 'a2a',
    'legacy.team': 'team-runtime',
    'legacy.teamPack': 'team-runtime',
    'legacy.project': 'project-state',
    'legacy.projectStatus': 'task-graph',
    'legacy.system': 'role-card',
    'legacy.role': 'role-card',
    'legacy.protocol': 'platform-protocol',
    'legacy.collaboration': 'platform-protocol',
    'legacy.behavior': 'platform-protocol',
    'legacy.tool': 'tool-registry',
  };
  const sourceOwner = fragment.kind.startsWith('legacy.skill:')
    ? 'skill-runtime'
    : legacyOwnerByKind[fragment.kind] ?? fragment.producer;

  return {
    ...fragment,
    semantic: { kind: fragment.kind, cluster: fragment.cluster },
    source: {
      provider: fragment.producer,
      owner: sourceOwner,
      revision: fragment.version,
      observedAt: fragment.freshness.observedAt,
    },
    lifecycle: {
      class: lifecycle,
      ...(fragment.freshness.expiresAt ? { expiresAt: fragment.freshness.expiresAt } : {}),
    },
    consistency,
    delivery: {
      mode: deliveryMode,
      channel,
      required: fragment.required === true,
      importance: importanceByCluster[fragment.cluster],
    },
  };
}

export async function collectContextFragments(
  query: ContextQuery,
  seedFragments: ContextFragment[],
  contributors: ContextContributor[],
): Promise<ContextCollection> {
  const settled = await Promise.allSettled(
    contributors.map(contributor => Promise.resolve().then(() => contributor.contribute(query))),
  );
  const omissions: ContextOmission[] = [];
  const candidates: Array<{
    fragment: unknown;
    contributorId?: string;
    contributorRequired: boolean;
  }> = seedFragments.map(fragment => ({
    fragment,
    contributorRequired: false,
  }));
  const requiredFragmentIds = new Set<string>(
    seedFragments.filter(fragment => fragment.required).map(fragment => fragment.id),
  );
  // Query requirements are authoritative even when a contributor was not
  // registered. Starting from the query prevents a missing registration from
  // silently degrading into "no requirement".
  const requiredContributorIds = new Set<string>(query.requiredContributorIds);

  settled.forEach((result, index) => {
    const contributor = contributors[index];
    const contributorRequired = contributor.required === true
      || query.requiredContributorIds.includes(contributor.id);
    if (contributorRequired) requiredContributorIds.add(contributor.id);
    if (result.status === 'fulfilled') {
      if (!Array.isArray(result.value)) {
        omissions.push({
          fragmentId: `contributor:${contributor.id}`,
          producer: contributor.id,
          reason: 'invalid_fragment',
          detail: 'contributor result must be an array',
          required: contributorRequired,
        });
        return;
      }
      if (contributorRequired && result.value.length === 0) {
        omissions.push({
          fragmentId: `contributor:${contributor.id}`,
          producer: contributor.id,
          reason: 'required_contributor_empty',
          detail: 'required contributor returned no fragments',
          required: true,
        });
      }
      candidates.push(...result.value.map(fragment => ({
        fragment,
        contributorId: contributor.id,
        contributorRequired,
      })));
      return;
    }
    omissions.push({
      fragmentId: `contributor:${contributor.id}`,
      producer: contributor.id,
      reason: 'contributor_failed',
      detail: 'contributor execution failed',
      required: contributorRequired,
    });
  });

  const deduplicated = new Map<string, OrderedFragment>();
  const contributorValidFragmentCounts = new Map<string, number>();
  const now = Date.parse(query.now);

  candidates.forEach((candidate, order) => {
    const unsafeCandidate = candidate.fragment as Record<string, unknown> | null;
    if (unsafeCandidate?.required === true) {
      requiredFragmentIds.add(
        typeof unsafeCandidate.id === 'string' && unsafeCandidate.id.trim()
          ? unsafeCandidate.id
          : `invalid:${order}`,
      );
    }
    const invalidReason = validateFragment(candidate.fragment);
    if (invalidReason) {
      const unsafe = unsafeCandidate;
      omissions.push({
        fragmentId: typeof unsafe?.id === 'string' ? unsafe.id : `invalid:${order}`,
        producer: typeof unsafe?.producer === 'string'
          ? unsafe.producer
          : candidate.contributorId ?? 'unknown',
        reason: 'invalid_fragment',
        detail: invalidReason,
        required: unsafe?.required === true || candidate.contributorRequired,
      });
      return;
    }
    const input = candidate.fragment as ContextFragment;
    if (candidate.contributorId && input.producer !== candidate.contributorId) {
      omissions.push({
        fragmentId: input.id,
        producer: candidate.contributorId,
        reason: 'invalid_fragment',
        detail: 'fragment producer must match registered contributor id',
        required: input.required === true || candidate.contributorRequired,
      });
      return;
    }
    if (input.required) requiredFragmentIds.add(input.id);
    const fragment = normalizeFragment(input);
    if (fragment.scope.kind === 'project' && fragment.scope.projectId !== query.conversationId) {
      omissions.push(omission(fragment, 'project_scope_mismatch', fragment.scope.projectId));
      return;
    }
    if (
      fragment.scope.kind === 'global'
      && (!GLOBAL_CLUSTERS.has(fragment.cluster) || !GLOBAL_SUBJECTS.has(fragment.subject.kind))
    ) {
      omissions.push(omission(fragment, 'global_scope_not_allowed', `${fragment.cluster}:${fragment.subject.kind}`));
      return;
    }
    if (!visibilityAllows(fragment, query)) {
      omissions.push(omission(fragment, 'visibility_denied'));
      return;
    }
    if (fragment.freshness.expiresAt && Date.parse(fragment.freshness.expiresAt) <= now) {
      omissions.push(omission(fragment, 'expired', fragment.freshness.expiresAt));
      return;
    }
    if (candidate.contributorId) {
      contributorValidFragmentCounts.set(
        candidate.contributorId,
        (contributorValidFragmentCounts.get(candidate.contributorId) ?? 0) + 1,
      );
    }

    const current = deduplicated.get(fragment.id);
    if (!current) {
      deduplicated.set(fragment.id, { fragment, order });
      return;
    }

    if (shouldReplace(current.fragment, fragment)) {
      omissions.push({
        ...omission(current.fragment, 'duplicate_replaced', `kept ${fragment.version}`),
        required: false,
      });
      deduplicated.set(fragment.id, {
        fragment: {
          ...fragment,
          required: current.fragment.required || fragment.required,
          delivery: {
            ...fragment.delivery,
            required: current.fragment.delivery.required || fragment.delivery.required,
          },
        },
        order: current.order,
      });
    } else {
      omissions.push({
        ...omission(fragment, 'duplicate_replaced', `kept ${current.fragment.version}`),
        required: false,
      });
      if (fragment.required && !current.fragment.required) {
        deduplicated.set(fragment.id, {
          ...current,
          fragment: {
            ...current.fragment,
            required: true,
            delivery: { ...current.fragment.delivery, required: true },
          },
        });
      }
    }
  });

  for (const contributorId of requiredContributorIds) {
    if ((contributorValidFragmentCounts.get(contributorId) ?? 0) > 0) continue;
    if (omissions.some(item => item.fragmentId === `contributor:${contributorId}`)) continue;
    omissions.push({
      fragmentId: `contributor:${contributorId}`,
      producer: contributorId,
      reason: 'required_contributor_empty',
      detail: 'required contributor produced no usable fragments',
      required: true,
    });
  }

  return {
    artifacts: [...deduplicated.values()]
      .sort((left, right) => left.order - right.order)
      .map(item => item.fragment),
    omissions,
    requiredFragmentIds: [...requiredFragmentIds],
    requiredContributorIds: [...requiredContributorIds],
  };
}
