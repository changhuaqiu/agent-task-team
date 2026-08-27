export type ReferencedObjectKind = 'project' | 'work' | 'review' | 'artifact' | 'channel' | 'agent' | 'release';

export interface ParsedObjectReference {
  kind: ReferencedObjectKind;
  projectId: string;
  objectId: string;
}

const SAFE_ID = /^[a-zA-Z0-9._:-]{1,180}$/;

function requiredSafeId(value: string, label: string): string {
  const normalized = value.trim();
  if (!SAFE_ID.test(normalized) || normalized.startsWith('.') || normalized.includes('..')) {
    throw new Error(`object_reference_invalid_${label}`);
  }
  return normalized;
}

export function buildObjectReference(input: ParsedObjectReference): string {
  const kind = requiredSafeId(input.kind, 'kind');
  const projectId = requiredSafeId(input.projectId, 'project');
  const objectId = requiredSafeId(input.objectId, 'id');
  return `ath://${kind}?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(objectId)}`;
}

export function parseObjectReference(value: string): ParsedObjectReference {
  const url = new URL(value.trim());
  if (url.protocol !== 'ath:' || url.username || url.password || url.port || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('object_reference_invalid_shape');
  }
  const kind = url.hostname as ReferencedObjectKind;
  if (!['project', 'work', 'review', 'artifact', 'channel', 'agent', 'release'].includes(kind)) {
    throw new Error('object_reference_unknown_kind');
  }
  const params = [...url.searchParams.keys()];
  if (params.length !== 2 || !params.includes('project') || !params.includes('id')) {
    throw new Error('object_reference_unknown_parameter');
  }
  return {
    kind,
    projectId: requiredSafeId(url.searchParams.get('project') ?? '', 'project'),
    objectId: requiredSafeId(url.searchParams.get('id') ?? '', 'id'),
  };
}
