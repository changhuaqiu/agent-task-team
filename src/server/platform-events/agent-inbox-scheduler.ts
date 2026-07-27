import type {
  AgentActivationCommand,
  InvocationSubmission,
} from '../invocation-pipeline/types';
import { AgentInbox } from './agent-inbox';

export interface AgentInboxSchedulerOptions {
  inbox?: AgentInbox;
  submit: (trigger: AgentActivationCommand) => InvocationSubmission;
  intervalMs?: number;
  retryDelayMs?: number;
  maxClaimsPerTick?: number;
  leaseMs?: number;
  heartbeatMs?: number;
}

export class AgentInboxScheduler {
  private readonly inbox: AgentInbox;
  private readonly intervalMs: number;
  private readonly retryDelayMs: number;
  private readonly maxClaimsPerTick: number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly settlements = new Set<Promise<void>>();
  private readonly settlementHeartbeats = new Map<string, ReturnType<typeof setInterval>>();
  private stopped = true;
  private generation = 0;

  constructor(private readonly options: AgentInboxSchedulerOptions) {
    this.inbox = options.inbox ?? new AgentInbox();
    this.intervalMs = options.intervalMs ?? 250;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.maxClaimsPerTick = options.maxClaimsPerTick ?? 20;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.heartbeatMs = options.heartbeatMs ?? Math.max(1_000, Math.floor(this.leaseMs / 3));
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.generation += 1;
    this.schedule(0, this.generation);
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const heartbeat of this.settlementHeartbeats.values()) clearInterval(heartbeat);
    this.settlementHeartbeats.clear();
  }

  private schedule(delayMs: number, generation: number): void {
    if (this.stopped || generation !== this.generation) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().finally(() => this.schedule(this.intervalMs, generation));
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      this.inbox.releaseExpiredClaims();
      for (let index = 0; index < this.maxClaimsPerTick; index += 1) {
        const item = this.inbox.claimNext(this.leaseMs);
        if (!item?.leaseToken) break;
        const trigger: AgentActivationCommand = {
          id: `inbox:${item.id}:${item.attemptCount}`,
          idempotencyKey: item.idempotencyKey,
          source: item.command.source,
          conversationId: item.projectId,
          agentId: item.projectAgentId,
          prompt: item.command.prompt,
          taskId: item.command.taskId,
          deliveryRunId: item.command.deliveryRunId,
          fromAgentId: item.command.fromAgentId,
          chainId: item.command.chainId,
          passId: item.command.passId,
          contextScenario: item.command.contextScenario,
        };
        const submission = this.options.submit(trigger);
        if (submission.disposition === 'deferred') {
          this.inbox.release(item.id, item.leaseToken, this.retryDelayMs, 'agent_busy');
          continue;
        }
        if (submission.disposition === 'duplicate') {
          this.trackSettlement(item.id, item.leaseToken, submission.completion);
          continue;
        }
        this.trackSettlement(item.id, item.leaseToken, submission.completion);
      }
    } catch (error) {
      console.error('[agent-inbox] scheduler tick failed:', error);
    }
  }

  private trackSettlement(
    itemId: string,
    leaseToken: string,
    completion: InvocationSubmission['completion'],
  ): void {
    const settlement = this.settle(itemId, leaseToken, completion)
      .catch((error) => {
        console.error('[agent-inbox] Invocation Pipeline settlement failed:', error);
      })
      .finally(() => {
        this.settlements.delete(settlement);
      });
    this.settlements.add(settlement);
  }

  private async settle(
    itemId: string,
    leaseToken: string,
    completion: InvocationSubmission['completion'],
  ): Promise<void> {
        const settlementKey = `${itemId}:${leaseToken}`;
        const heartbeat = setInterval(() => {
          this.inbox.renew(itemId, leaseToken, this.leaseMs);
        }, this.heartbeatMs);
        heartbeat.unref?.();
        this.settlementHeartbeats.set(settlementKey, heartbeat);
        try {
          const outcome = await completion;
          if (outcome.status === 'accepted') {
            this.inbox.admit(itemId, leaseToken);
          } else if (outcome.status === 'deferred') {
            this.inbox.release(itemId, leaseToken, this.retryDelayMs, outcome.reasonCode);
          } else {
            this.inbox.expire(itemId, leaseToken, outcome.reasonCode);
          }
        } finally {
          clearInterval(heartbeat);
          if (this.settlementHeartbeats.get(settlementKey) === heartbeat) {
            this.settlementHeartbeats.delete(settlementKey);
          }
        }
  }
}
