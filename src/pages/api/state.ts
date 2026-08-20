import type { NextApiRequest, NextApiResponse } from 'next';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { messageRepo } from '@/server/repositories/message-repo';
import { sessionRepo } from '@/server/repositories/session-repo';
import { skillRepo } from '@/server/repositories/skill-repo';
import { A2AReadModelProjection } from '@/server/a2a/projection';
import { autonomousDeliveryRepo } from '@/server/autonomous-delivery/repository';

export const STATE_MESSAGE_LIMIT = 200;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const autonomousConversationIds = new Set(autonomousDeliveryRepo.listConversationIds());
    const conversations = conversationRepo.list().map((conversation) => ({
      ...conversation,
      autonomous: autonomousConversationIds.has(conversation.id),
    }));
    const tasks = taskRepo.list();

    // Keep bootstrap bounded. The selected conversation reconciles a larger
    // durable window after the workspace becomes interactive.
    const recentMessages: Record<string, unknown[]> = {};
    for (const conv of conversations) {
      recentMessages[conv.id] = messageRepo.getLatestByConversation(
        conv.id,
        { limit: STATE_MESSAGE_LIMIT },
      );
    }

    // Load active sessions
    const activeSessions = sessionRepo.listAllActive();

    const a2aSnapshots = new A2AReadModelProjection().list(
      conversations.map((conversation) => conversation.id),
    );

    res.status(200).json({
      conversations,
      tasks,
      recentMessages,
      activeSessions,
      a2aSnapshots,
      skills: skillRepo.list(),
      agentSkillIds: skillRepo.getAllAgentSkillIds(),
    });
  } catch (error) {
    console.error('[api/state] Error:', error);
    res.status(500).json({ error: 'Failed to load state' });
  }
}
