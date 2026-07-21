import { describe, expect, it, vi } from 'vitest';
import {
  allowsProductionCollaborationEffects,
  evaluationSafeTextSink,
} from './runtime-isolation';

describe('evaluation runtime isolation', () => {
  it('does not persist held-out text or allow production collaboration effects', () => {
    const create = vi.fn(() => 'production-message');
    const append = vi.fn(() => true);
    const evaluation = {
      executionId: 'execution-1',
      caseId: 'case-1',
      applicationSnapshotId: 'snapshot-1',
      targetManifestDigest: 'digest-1',
      applicationManifest: {},
    };
    const sink = evaluationSafeTextSink(evaluation, { create, append });

    expect(sink.create('held-out @agent output')).toBe('evaluation:execution-1');
    expect(sink.append('evaluation:execution-1', 'more output')).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(allowsProductionCollaborationEffects(evaluation)).toBe(false);
  });

  it('delegates ordinary production output to the real message sink', () => {
    const create = vi.fn(() => 'production-message');
    const append = vi.fn(() => true);
    const sink = evaluationSafeTextSink(undefined, { create, append });

    expect(sink.create('production output')).toBe('production-message');
    expect(sink.append('production-message', 'more output')).toBe(true);
    expect(create).toHaveBeenCalledWith('production output');
    expect(append).toHaveBeenCalledWith('production-message', 'more output');
    expect(allowsProductionCollaborationEffects(undefined)).toBe(true);
  });
});
