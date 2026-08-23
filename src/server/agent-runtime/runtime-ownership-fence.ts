import { getDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';

export class RuntimeOwnershipLostError extends Error {
  readonly reasonCode = 'runtime_ownership_lost';
}

export function isRuntimeOwnershipLost(error: unknown): error is RuntimeOwnershipLostError {
  return error instanceof RuntimeOwnershipLostError;
}

/** Linearizes any durable Runtime side effect against Invocation takeover. */
export class RuntimeOwnershipFence {
  constructor(private readonly input: {
    invocationId: string;
    runtimeOwnerToken: string;
    onOwnershipLost?: () => void;
  }) {}

  commit<T>(effect: () => T): T {
    return getDb().transaction(() => {
      if (!invocationRepo.ownsRuntimeLease(
        this.input.invocationId,
        this.input.runtimeOwnerToken,
      )) {
        this.input.onOwnershipLost?.();
        throw new RuntimeOwnershipLostError('runtime_effect_fence_lost');
      }
      return effect();
    }).immediate();
  }
}
