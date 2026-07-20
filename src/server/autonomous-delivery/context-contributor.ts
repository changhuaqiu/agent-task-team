import type {
  ContextContributor,
  ContextFragment,
  ContextQuery,
} from '@/lib/agent-context/ContextManager';
import { createHash } from 'node:crypto';
import { autonomousDeliveryRepo, type AutonomousDeliveryRepository } from './repository';

function deliveryPolicyText(query: ContextQuery, snapshot: NonNullable<ReturnType<AutonomousDeliveryRepository['getLatestByConversation']>>): string {
  const { authorization, deliveryPolicy, recoveryPolicy } = snapshot.contract;
  return [
    '## 自主交付约束',
    `- 代码修改：${authorization.allowCodeChanges ? '允许' : '禁止'}`,
    `- Push：${authorization.allowPush ? '允许' : '禁止'}`,
    `- 创建 PR：${authorization.allowPullRequest ? '允许' : '禁止'}`,
    `- 自动合并：${authorization.allowAutoMerge ? '允许' : '禁止'}`,
    `- 必须评审：${deliveryPolicy.requireReview ? '是' : '否'}`,
    `- 必须 Web UI E2E：${deliveryPolicy.requireWebE2E ? '是' : '否'}`,
    `- 必须合并：${deliveryPolicy.requireMerge ? '是' : '否'}`,
    `- 恢复预算：每个动作 ${recoveryPolicy.maxAttemptsPerAction} 次，修复循环 ${recoveryPolicy.maxRepairCycles} 次`,
    `- 当前场景：${query.scenario}`,
  ].join('\n');
}

export class AutonomousDeliveryContextContributor implements ContextContributor {
  readonly id = 'autonomous-delivery';

  constructor(private readonly repository: AutonomousDeliveryRepository = autonomousDeliveryRepo) {}

  async contribute(query: ContextQuery): Promise<ContextFragment[]> {
    const snapshot = query.deliveryRunId
      ? this.repository.getSnapshot(query.deliveryRunId)
      : this.repository.getLatestByConversation(query.conversationId);
    if (!snapshot) return [];
    if (snapshot.run.conversation_id !== query.conversationId) return [];
    if (
      !query.deliveryRunId
      && ['completed', 'escalated', 'cancelled'].includes(snapshot.run.status)
    ) return [];

    const observedAt = snapshot.run.updated_at;
    const version = createHash('sha256').update(JSON.stringify({
      run: {
        id: snapshot.run.id,
        status: snapshot.run.status,
        stage: snapshot.run.current_stage,
        repairCycle: snapshot.run.repair_cycle,
        updatedAt: snapshot.run.updated_at,
        escalationCode: snapshot.run.escalation_code,
      },
      contract: {
        goal: snapshot.contract.goal,
        acceptanceCriteria: snapshot.contract.acceptanceCriteria,
        authorization: snapshot.contract.authorization,
        recoveryPolicy: snapshot.contract.recoveryPolicy,
        deliveryPolicy: snapshot.contract.deliveryPolicy,
      },
      receipts: snapshot.receipts
        .map(receipt => ({
          id: receipt.id,
          kind: receipt.kind,
          status: receipt.status,
          observedAt: receipt.observed_at,
          externalId: receipt.external_id,
          payload: receipt.payload_json,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    })).digest('hex');
    const scope = { kind: 'project' as const, projectId: query.conversationId };
    const evidenceRefs = snapshot.receipts.map(receipt => `delivery-receipt:${receipt.id}`);
    const goalContent = [
      '## 自主交付目标',
      snapshot.contract.goal,
      '',
      '### 验收标准',
      ...snapshot.contract.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    ].join('\n');
    const stateContent = [
      '## 自主交付状态',
      `- Run：${snapshot.run.id}`,
      `- 状态：${snapshot.run.status}`,
      `- 阶段：${snapshot.run.current_stage}`,
      `- 修复循环：${snapshot.run.repair_cycle}`,
      snapshot.run.escalation_code ? `- 异常：${snapshot.run.escalation_code}` : '',
      `- 已确认 Receipt：${snapshot.receipts.length}`,
    ].filter(Boolean).join('\n');

    return [
      {
        id: `delivery-goal:${snapshot.run.id}`,
        kind: 'delivery.goal',
        cluster: 'focus',
        scope,
        subject: { kind: 'goal', id: snapshot.run.id },
        producer: this.id,
        version,
        content: goalContent,
        visibility: { kind: 'team' },
        freshness: { observedAt },
        evidenceRefs,
        required: true,
      },
      {
        id: `delivery-policy:${snapshot.run.id}`,
        kind: 'delivery.policy',
        cluster: 'protocol',
        scope,
        subject: { kind: 'goal', id: snapshot.run.id },
        producer: this.id,
        version,
        content: deliveryPolicyText(query, snapshot),
        visibility: { kind: 'team' },
        freshness: { observedAt },
        evidenceRefs: [],
        required: true,
      },
      {
        id: `delivery-state:${snapshot.run.id}`,
        kind: 'delivery.state',
        cluster: 'situation',
        scope,
        subject: { kind: 'goal', id: snapshot.run.id },
        producer: this.id,
        version,
        content: stateContent,
        visibility: { kind: 'team' },
        freshness: { observedAt },
        evidenceRefs,
      },
    ];
  }
}

export const autonomousDeliveryContextContributor = new AutonomousDeliveryContextContributor();
