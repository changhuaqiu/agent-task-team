import { describe, expect, it } from 'vitest';
import { runtimeProjectViewIdentity } from './runtime-project-view-identity';

describe('runtimeProjectViewIdentity', () => {
  it('keeps fallback failure events scoped to the acquired Invocation', () => {
    expect(runtimeProjectViewIdentity({
      invocationId: 'invocation-1',
      traceId: 'trace-1',
      envelopeId: 'envelope-1',
      projectId: 'project-1',
    })).toEqual({
      subject: { type: 'invocation', id: 'invocation-1' },
      correlationId: 'trace-1',
      causationId: 'envelope-1',
    });
  });

  it('omits a false Invocation subject when setup fails before acquisition', () => {
    expect(runtimeProjectViewIdentity({
      envelopeId: 'envelope-1',
      projectId: 'project-1',
    })).toEqual({
      correlationId: 'envelope-1',
      causationId: 'envelope-1',
    });
  });
});
