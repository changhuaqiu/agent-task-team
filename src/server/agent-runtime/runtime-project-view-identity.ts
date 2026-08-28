export interface RuntimeProjectViewIdentityInput {
  invocationId?: string;
  traceId?: string;
  envelopeId?: string;
  projectId: string;
}

/** Keeps every Runtime Project View event on the same Invocation identity chain. */
export function runtimeProjectViewIdentity(input: RuntimeProjectViewIdentityInput): {
  subject?: { type: 'invocation'; id: string };
  correlationId: string;
  causationId: string;
} {
  const fallback = input.invocationId ?? input.envelopeId ?? input.projectId;
  return {
    ...(input.invocationId
      ? { subject: { type: 'invocation' as const, id: input.invocationId } }
      : {}),
    correlationId: input.traceId ?? fallback,
    causationId: input.envelopeId ?? input.invocationId ?? input.projectId,
  };
}
