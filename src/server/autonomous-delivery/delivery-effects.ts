import type { DurableEffect, DurableEffectOutbox } from '../platform-events/durable-effect-outbox';
import type { AutonomousDeliveryRepository } from './repository';
import { autonomousDeliveryRepo } from './repository';
import {
  GitHubProviderActionAdapter,
  ProviderActionError,
  type ProviderActionPort,
} from './provider-actions';

export const DELIVERY_EFFECT_TYPES = {
  githubIntegrate: 'delivery.github.integrate',
} as const;

interface DeliveryIntegrationEffectPayload {
  runId: string;
}

interface RegisterDeliveryEffectsOptions {
  provider?: ProviderActionPort;
  deliveries?: AutonomousDeliveryRepository;
}

function integrationPayload(effect: DurableEffect): DeliveryIntegrationEffectPayload {
  const payload = effect.payload as Partial<DeliveryIntegrationEffectPayload>;
  if (!payload.runId?.trim()) throw new Error('delivery_integration_run_id_required');
  return { runId: payload.runId };
}

export function registerDeliveryEffectAdapters(
  outbox: DurableEffectOutbox,
  options: RegisterDeliveryEffectsOptions = {},
): void {
  const provider = options.provider ?? new GitHubProviderActionAdapter();
  const deliveries = options.deliveries ?? autonomousDeliveryRepo;
  outbox.register({
    type: DELIVERY_EFFECT_TYPES.githubIntegrate,
    execution: 'idempotent',
    maxAttempts: 5,
    timeoutMs: 60_000,
    async execute(effect, context) {
      if (context.signal.aborted) {
        throw context.signal.reason ?? new Error('delivery_integration_aborted');
      }
      const { runId } = integrationPayload(effect);
      const snapshot = deliveries.getSnapshot(runId);
      if (!snapshot) throw new Error(`delivery_run_missing:${runId}`);
      const receipts = await provider.integrate(snapshot);
      for (const receipt of receipts) {
        deliveries.recordReceipt({ runId, receipt });
      }
      const merged = receipts.some((receipt) =>
        receipt.kind === 'provider.github.pull_request.merged'
        && receipt.status === 'succeeded'
      );
      if (!merged) {
        throw new ProviderActionError(
          'transient_provider',
          'GitHub merge has been requested but is not complete yet',
          true,
        );
      }
    },
  });
}
