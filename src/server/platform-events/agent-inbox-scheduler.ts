import type {
  AgentActivationCommand,
  InvocationSubmitOptions,
  InvocationSubmission,
} from '../invocation-pipeline/types';
import { AgentInbox } from './agent-inbox';

export interface AgentInboxSchedulerOptions {
  inbox?: AgentInbox;
  submit: (
    trigger: AgentActivationCommand,
    options?: InvocationSubmitOptions,
  ) => InvocationSubmission;
  intervalMs?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxClaimsPerTick?: number;
  leaseMs?: number;
  heartbeatMs?: number;
  maxStartAttempts?: number;
}

export class AgentInboxScheduler {
  private readonly inbox: AgentInbox;
  private readonly intervalMs: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly maxClaimsPerTick: number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly maxStartAttempts: number;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly admissions = new Set<Promise<void>>();
  private readonly admissionHeartbeats = new Map<string, ReturnType<typeof setInterval>>();
  private readonly admissionControllers = new Map<string, AbortController>();
  private stopped = true;
  private generation = 0;

  constructor(private readonly options: AgentInboxSchedulerOptions) {
    this.inbox = options.inbox ?? new AgentInbox();
    this.intervalMs = options.intervalMs ?? 250;
    this.retryDelayMs = options.retryDelayMs ?? 5_000;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 300_000;
    this.maxClaimsPerTick = options.maxClaimsPerTick ?? 50;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.heartbeatMs = options.heartbeatMs ?? Math.max(1_000, Math.floor(this.leaseMs / 3));
    this.maxStartAttempts = options.maxStartAttempts ?? 10;
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
    for (const heartbeat of this.admissionHeartbeats.values()) clearInterval(heartbeat);
    this.admissionHeartbeats.clear();
    for (const controller of this.admissionControllers.values()) controller.abort();
    this.admissionControllers.clear();
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
      this.inbox.releaseExpiredClaims(this.maxStartAttempts);
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
          correlationId: item.command.correlationId,
          causationId: item.command.causationId,
          workId: item.command.workId,
          executionMode: item.command.executionMode,
          executionSubject: item.command.executionSubject,
          taskId: item.command.taskId,
          deliveryRunId: item.command.deliveryRunId,
          fromAgentId: item.command.fromAgentId,
          chainId: item.command.chainId,
          passId: item.command.passId,
          possessionId: item.command.possessionId,
          possessionRevision: item.command.possessionRevision,
          a2aHandoff: item.command.a2aHandoff,
          contextScenario: item.command.contextScenario,
          wakeup: item.command.wakeup,
          replyTo: item.command.replyTo,
          evaluation: item.command.evaluation,
          legacyProposal: item.command.legacyProposal,
          inboxItemId: item.id,
          runtimeOwnerToken: item.leaseToken,
        };
        const controller = new AbortController();
        const submission = this.options.submit(trigger, {
          signal: controller.signal,
          canAcknowledge: () => this.inbox.ownsClaim(item.id, item.leaseToken!),
          commitRuntimeStart: (_envelopeId, acknowledgeEnvelope, context) => (
            this.inbox.admitWithClaimFence(
              item.id,
              item.leaseToken!,
              acknowledgeEnvelope,
              context,
            )
          ),
        });
        if (submission.disposition === 'deferred') {
          controller.abort();
          if (item.attemptCount >= this.maxStartAttempts) {
            this.inbox.expire(item.id, item.leaseToken, 'agent_busy_retry_exhausted');
          } else {
            this.inbox.release(
              item.id,
              item.leaseToken,
              this.retryBackoffMs(item.attemptCount),
              'agent_busy',
            );
          }
          continue;
        }
        this.trackAdmission(
          item.id,
          item.leaseToken,
          item.attemptCount,
          submission.started,
          controller,
        );
      }
    } catch (error) {
      console.error('[agent-inbox] scheduler tick failed:', error);
    }
  }

  private retryBackoffMs(attemptCount: number): number {
    const exponent = Math.max(0, Math.min(attemptCount - 1, 20));
    return Math.min(this.maxRetryDelayMs, this.retryDelayMs * (2 ** exponent));
  }

  private trackAdmission(
    itemId: string,
    leaseToken: string,
    attemptCount: number,
    started: InvocationSubmission['started'],
    controller: AbortController,
  ): void {
    const admission = this.admitAfterRuntimeStart(
      itemId,
      leaseToken,
      attemptCount,
      started,
      controller,
    )
      .catch((error) => {
        console.error('[agent-inbox] Runtime admission failed:', error);
      })
      .finally(() => {
        this.admissions.delete(admission);
      });
    this.admissions.add(admission);
  }

  private async admitAfterRuntimeStart(
    itemId: string,
    leaseToken: string,
    attemptCount: number,
    started: InvocationSubmission['started'],
    controller: AbortController,
  ): Promise<void> {
    const admissionKey = `${itemId}:${leaseToken}`;
    const heartbeat = setInterval(() => {
      if (!this.inbox.renew(itemId, leaseToken, this.leaseMs)) controller.abort();
    }, this.heartbeatMs);
    heartbeat.unref?.();
    this.admissionHeartbeats.set(admissionKey, heartbeat);
    this.admissionControllers.set(admissionKey, controller);
    try {
      const outcome = await started;
      const runtimeStartFailureCount = this.inbox.get(itemId)?.runtimeStartFailureCount
        ?? this.maxStartAttempts;
      const runtimeStartFailed = outcome.status === 'failed'
        && outcome.reasonCode === 'runtime_start_failed';
      if (outcome.status === 'accepted') {
        // Production admission is committed atomically with Envelope ACK.
        // Deterministic test runtimes may resolve `started` without an Envelope.
        if (this.inbox.ownsClaim(itemId, leaseToken)) this.inbox.admit(itemId, leaseToken);
      } else if (attemptCount >= this.maxStartAttempts) {
        this.inbox.expire(
          itemId,
          leaseToken,
          `${outcome.reasonCode}_retry_exhausted`,
          runtimeStartFailed,
        );
      } else if (outcome.status === 'deferred') {
        this.inbox.release(
          itemId,
          leaseToken,
          this.retryBackoffMs(attemptCount),
          outcome.reasonCode,
        );
      } else if (
        runtimeStartFailed
        && runtimeStartFailureCount + 1 < this.maxStartAttempts
      ) {
        this.inbox.release(
          itemId,
          leaseToken,
          this.retryBackoffMs(attemptCount),
          outcome.reasonCode,
          true,
        );
      } else {
        this.inbox.expire(
          itemId,
          leaseToken,
          outcome.reasonCode,
          runtimeStartFailed,
        );
      }
    } finally {
      clearInterval(heartbeat);
      if (this.admissionHeartbeats.get(admissionKey) === heartbeat) {
        this.admissionHeartbeats.delete(admissionKey);
      }
      if (this.admissionControllers.get(admissionKey) === controller) {
        this.admissionControllers.delete(admissionKey);
      }
    }
  }
}
