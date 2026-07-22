import { agentBindingRepo } from '../repositories/agent-binding-repo';
import { executionEnvelopeRepo, type ExecutionEnvelopeRow } from '../repositories/execution-envelope-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { runtimeNodeRepo } from '../repositories/runtime-node-repo';
import type {
  AgentBindingStatus,
  DispatchIntent,
  DispatchSource,
  ExecutionEnvelopePayload,
  RuntimeNodeKind,
  RuntimeTrustLevel,
} from '../repositories/control-plane-types';

export interface EnsureRuntimeNodeInput {
  id: string;
  kind: RuntimeNodeKind;
  label: string;
  endpoint?: string;
  capabilities?: string[];
  trustLevel?: RuntimeTrustLevel;
}

export interface DispatchGatewayRequest {
  source: DispatchSource;
  intent: DispatchIntent;
  conversationId: string;
  taskId?: string;
  chainId?: string;
  passId?: string;
  fromNodeId: string;
  fromAgentId?: string;
  toNodeId: string;
  toAgentId: string;
  runtimeId: string;
  payload?: ExecutionEnvelopePayload;
  ttlMs?: number;
}

export class DispatchGateway {
  ensureRuntimeNode(input: EnsureRuntimeNodeInput): void {
    runtimeNodeRepo.register(input);
    proofLogRepo.append({
      eventType: 'runtime.registered',
      nodeId: input.id,
      metadata: {
        kind: input.kind,
        label: input.label,
        capabilities: input.capabilities ?? [],
      },
    });
  }

  heartbeat(nodeId: string): void {
    const node = runtimeNodeRepo.heartbeat(nodeId);
    if (!node) return;
    proofLogRepo.append({
      eventType: 'runtime.heartbeat',
      nodeId,
      metadata: { status: node.status },
    });
  }

  markMissedHeartbeat(nodeId: string): void {
    const before = runtimeNodeRepo.getById(nodeId);
    const after = runtimeNodeRepo.recordMiss(nodeId);
    if (!after) return;
    if (!before || before.status !== after.status) {
      proofLogRepo.append({
        eventType: after.status === 'unreachable' ? 'runtime.unreachable' : 'runtime.stale',
        nodeId,
        reasonCode: after.status,
        metadata: { missedHeartbeats: after.missed_heartbeats },
      });
    }
  }

  requestDispatch(input: DispatchGatewayRequest): ExecutionEnvelopeRow {
    const targetNode = runtimeNodeRepo.getById(input.toNodeId);
    const sourceNode = runtimeNodeRepo.getById(input.fromNodeId);
    const secretHit = detectSecret(input.payload);

    const envelope = executionEnvelopeRepo.create({
      source: input.source,
      intent: input.intent,
      conversationId: input.conversationId,
      taskId: input.taskId,
      chainId: input.chainId,
      passId: input.passId,
      fromNodeId: input.fromNodeId,
      fromAgentId: input.fromAgentId,
      toNodeId: input.toNodeId,
      toAgentId: input.toAgentId,
      payload: secretHit ? { prompt: '[BLOCKED: secret]', contextRefs: input.payload?.contextRefs ?? [] } : input.payload,
      ttlMs: input.ttlMs,
    });

    proofLogRepo.append({
      eventType: 'dispatch.requested',
      conversationId: input.conversationId,
      taskId: input.taskId,
      chainId: input.chainId,
      passId: input.passId,
      envelopeId: envelope.id,
      nodeId: input.toNodeId,
      agentId: input.toAgentId,
      actorId: input.fromAgentId ?? input.fromNodeId,
      metadata: {
        source: input.source,
        intent: input.intent,
        fromNodeId: input.fromNodeId,
        sourceNodeKnown: Boolean(sourceNode),
        targetNodeKnown: Boolean(targetNode),
      },
    });

    agentBindingRepo.upsert({
      conversationId: input.conversationId,
      agentId: input.toAgentId,
      nodeId: input.toNodeId,
      runtimeId: input.runtimeId,
    });

    if (secretHit) {
      proofLogRepo.append({
        eventType: 'policy.secret.blocked',
        conversationId: input.conversationId,
        taskId: input.taskId,
        chainId: input.chainId,
        passId: input.passId,
        envelopeId: envelope.id,
        nodeId: input.toNodeId,
        agentId: input.toAgentId,
        reasonCode: secretHit,
      });
      return this.block(envelope.id, `secret_detected:${secretHit}`);
    }

    if (!targetNode) {
      return this.block(envelope.id, 'runtime_node_missing');
    }
    if (targetNode.status === 'unreachable' || targetNode.status === 'suspended') {
      return this.block(envelope.id, `runtime_${targetNode.status}`);
    }

    executionEnvelopeRepo.updateStatus(envelope.id, 'routed');
    proofLogRepo.append({
      eventType: 'dispatch.routed',
      conversationId: input.conversationId,
      taskId: input.taskId,
      chainId: input.chainId,
      passId: input.passId,
      envelopeId: envelope.id,
      nodeId: input.toNodeId,
      agentId: input.toAgentId,
      metadata: { runtimeId: input.runtimeId },
    });
    return executionEnvelopeRepo.getById(envelope.id)!;
  }

  markSent(envelopeId: string): ExecutionEnvelopeRow | undefined {
    const envelope = executionEnvelopeRepo.sendIfRoutedAndLive(envelopeId);
    if (!envelope) return undefined;
    proofLogRepo.append(this.eventFromEnvelope(envelope, 'dispatch.sent'));
    return envelope;
  }

  markStarted(envelopeId: string): ExecutionEnvelopeRow | undefined {
    const envelope = executionEnvelopeRepo.startIfSentAndLive(envelopeId);
    if (!envelope) return undefined;
    agentBindingRepo.markStarted(envelope.conversation_id, envelope.to_agent_id, envelope.id);
    proofLogRepo.append(this.eventFromEnvelope(envelope, 'dispatch.started'));
    return envelope;
  }

  bindExecutor(
    envelopeId: string,
    executorRef: NonNullable<ExecutionEnvelopePayload['executorRef']>,
  ): ExecutionEnvelopeRow | undefined {
    return executionEnvelopeRepo.bindExecutor(envelopeId, executorRef);
  }

  markCompleted(envelopeId: string): ExecutionEnvelopeRow | undefined {
    const envelope = executionEnvelopeRepo.completeIfStarted(envelopeId);
    if (!envelope) return undefined;
    proofLogRepo.append(this.eventFromEnvelope(envelope, 'dispatch.completed'));
    return envelope;
  }

  markFailed(
    envelopeId: string,
    reasonCode: string,
    bindingStatus: AgentBindingStatus = 'idle',
    invocation?: { id: string; errorMessage?: string },
  ): ExecutionEnvelopeRow | undefined {
    const envelope = executionEnvelopeRepo.failIfNonTerminal(envelopeId, reasonCode, {
      bindingStatus,
      invocationId: invocation?.id,
      invocationErrorMessage: invocation?.errorMessage,
    });
    if (!envelope) return undefined;
    proofLogRepo.append(this.eventFromEnvelope(envelope, 'dispatch.failed', reasonCode));
    return envelope;
  }

  private block(envelopeId: string, reasonCode: string): ExecutionEnvelopeRow {
    const envelope = executionEnvelopeRepo.updateStatus(envelopeId, 'blocked', reasonCode)!;
    agentBindingRepo.markError(envelope.conversation_id, envelope.to_agent_id, 'unreachable', reasonCode);
    proofLogRepo.append(this.eventFromEnvelope(envelope, 'dispatch.blocked', reasonCode));
    return envelope;
  }

  private eventFromEnvelope(envelope: ExecutionEnvelopeRow, eventType: string, reasonCode?: string) {
    return {
      eventType,
      conversationId: envelope.conversation_id,
      taskId: envelope.task_id ?? undefined,
      chainId: envelope.chain_id ?? undefined,
      passId: envelope.pass_id ?? undefined,
      envelopeId: envelope.id,
      nodeId: envelope.to_node_id,
      agentId: envelope.to_agent_id,
      actorId: envelope.from_agent_id ?? envelope.from_node_id,
      reasonCode,
    };
  }
}

function detectSecret(payload?: ExecutionEnvelopePayload): string | undefined {
  const text = JSON.stringify(payload ?? {});
  const patterns: Array<[string, RegExp]> = [
    ['private_key', /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i],
    ['bearer_token', /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
    ['github_token', /gh[pousr]_[A-Za-z0-9_]{20,}/],
    // OpenAI keys may appear after JSON/string delimiters, but never in the
    // middle of an identifier such as "task-notification-publisher".
    ['openai_key', /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/],
    ['aws_access_key', /AKIA[0-9A-Z]{16}/],
    ['database_url', /(postgres|mysql|mongodb):\/\/[^\\s"'<>]+/i],
    ['api_key_assignment', /(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}/i],
  ];
  return patterns.find(([, pattern]) => pattern.test(text))?.[0];
}
