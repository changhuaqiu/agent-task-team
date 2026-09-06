import type { NextApiRequest, NextApiResponse } from 'next';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { messageRepo } from '@/server/repositories/message-repo';
import { sessionRepo } from '@/server/repositories/session-repo';
import { skillRepo } from '@/server/repositories/skill-repo';
import { A2AReadModelProjection } from '@/server/a2a/projection';
import { autonomousDeliveryRepo } from '@/server/autonomous-delivery/repository';
import { projectRepo } from '@/server/repositories/project-repo';
import { PlatformEventLog } from '@/server/platform-events';
import { executionEnvelopeRepo } from '@/server/repositories/execution-envelope-repo';
import { getDb } from '@/server/db';

export const STATE_MESSAGE_LIMIT = 200;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const autonomousConversationIds = new Set(autonomousDeliveryRepo.listConversationIds());
    // Normal workstreams also have a durable root: the accepted work.created
    // fact. Timestamp ties between root/children must not change work identity.
    const rootFacts = getDb().prepare(`
      SELECT event.project_id conversation_id,event.subject_id task_id
      FROM platform_event event JOIN task ON task.id=event.subject_id
      WHERE event.type='work.created' AND event.subject_type='work'
        AND task.conversation_id=event.project_id
      ORDER BY event.recorded_at,event.id
    `).all() as Array<{ conversation_id: string; task_id: string }>;
    const roots = new Map<string, string>();
    for (const fact of rootFacts) if (!roots.has(fact.conversation_id)) roots.set(fact.conversation_id, fact.task_id);
    const conversations = conversationRepo.list().map((conversation) => {
      const delivery = autonomousConversationIds.has(conversation.id)
        ? autonomousDeliveryRepo.getLatestByConversation(conversation.id)
        : undefined;
      return {
        ...conversation,
        autonomous: Boolean(delivery),
        root_task_id: delivery?.run.root_task_id ?? roots.get(conversation.id) ?? null,
      };
    });
    const tasks = taskRepo.list();

    // Keep bootstrap bounded. The selected conversation reconciles a larger
    // durable window after the workspace becomes interactive.
    const recentMessages: Record<string, unknown[]> = {};
    const eventLog = new PlatformEventLog();
    for (const conv of conversations) {
      const messages = messageRepo.getLatestByConversation(
        conv.id,
        { limit: STATE_MESSAGE_LIMIT },
      );
      const facts = eventLog.listDomainByProject(conv.id, STATE_MESSAGE_LIMIT)
        .filter((event) => ['work.created', 'review.created', 'review.decision_recorded'].includes(event.type))
        .map((event) => {
          const payload = event.payload && typeof event.payload === 'object'
            ? event.payload as Record<string, unknown>
            : {};
          const title = typeof payload.title === 'string' ? payload.title : undefined;
          const status = typeof payload.status === 'string' ? payload.status : undefined;
          const content = event.type === 'work.created'
            ? `工作“${title ?? event.subject?.id ?? '未命名'}”已创建`
            : event.type === 'review.created'
              ? `评审“${title ?? event.subject?.id ?? '未命名'}”已发起`
              : `评审已记录结论：${status ?? '已更新'}`;
          return {
            id: `fact-${event.eventId}`,
            conversation_id: conv.id,
            task_id: event.subject?.type === 'work' ? event.subject.id : null,
            sender_type: 'system', sender_id: 'command-kernel', content,
            content_type: 'command_fact', mentions: null, intent: 'task_status',
            metadata: JSON.stringify({
              factType: event.type,
              commandId: event.correlationId,
              eventId: event.eventId,
              subject: event.subject,
              title,
              status,
              revision: event.aggregate.version,
            }),
            visibility: 'public', invocation_id: null, created_at: event.recordedAt,
          };
        });
      recentMessages[conv.id] = [...messages, ...facts]
        .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
        .slice(-STATE_MESSAGE_LIMIT);
    }

    // Load active sessions
    const activeSessions = sessionRepo.listAllActive();

    const a2aSnapshots = new A2AReadModelProjection().list(
      conversations.map((conversation) => conversation.id),
    );
    const dispatchReceipts = conversations.flatMap((conversation) => {
      const visibleMessageIds = new Set(
        (recentMessages[conversation.id] ?? [])
          .map((message) => (message as { id?: unknown }).id)
          .filter((id): id is string => typeof id === 'string'),
      );
      const terminalEnvelopes = executionEnvelopeRepo.listTerminalForHydration(conversation.id, {
        visibleSourceMessageIds: [...visibleMessageIds],
        fallbackLimit: STATE_MESSAGE_LIMIT,
      }).map((envelope) => ({
          envelope,
          payload: JSON.parse(envelope.payload) as { sourceMessageId?: unknown },
        }));
      return terminalEnvelopes
        .sort((left, right) => left.envelope.updated_at.localeCompare(right.envelope.updated_at))
        .map(({ envelope, payload }) => {
          return {
            projectId: conversation.id,
            receiptId: `${envelope.id}:${envelope.status}`,
            conversationId: conversation.id,
            ...(typeof payload.sourceMessageId === 'string' ? { sourceMessageId: payload.sourceMessageId } : {}),
            ...(envelope.task_id ? { taskId: envelope.task_id } : {}),
            targetAgentId: envelope.to_agent_id,
            source: envelope.source,
            phase: envelope.status,
            ...(envelope.chain_id ? { chainId: envelope.chain_id } : {}),
            ...(envelope.pass_id ? { passId: envelope.pass_id } : {}),
            ...(envelope.reason_code ? { reasonCode: envelope.reason_code } : {}),
            createdAt: envelope.updated_at,
          };
        });
    });

    res.status(200).json({
      projects: projectRepo.list(),
      conversations,
      tasks,
      recentMessages,
      activeSessions,
      a2aSnapshots,
      dispatchReceipts,
      skills: skillRepo.list(),
      agentSkillIds: skillRepo.getAllAgentSkillIds(),
    });
  } catch (error) {
    console.error('[api/state] Error:', error);
    res.status(500).json({ error: 'Failed to load state' });
  }
}
