import { describe, expect, it } from 'vitest';
import { buildObjectReference, parseObjectReference } from './object-reference';

describe('canonical object references', () => {
  it('round-trips a review identity', () => {
    const reference = buildObjectReference({ kind: 'review', projectId: 'project-alpha', objectId: 'review-123' });
    expect(reference).toBe('ath://review?project=project-alpha&id=review-123');
    expect(parseObjectReference(reference)).toEqual({ kind: 'review', projectId: 'project-alpha', objectId: 'review-123' });
  });

  it('rejects unknown parameters and unsafe identifiers', () => {
    expect(() => parseObjectReference('ath://review?project=alpha&id=review-1&scope=other')).toThrow('object_reference_unknown_parameter');
    expect(() => buildObjectReference({ kind: 'review', projectId: '../other', objectId: 'review-1' })).toThrow('object_reference_invalid_project');
  });
});
