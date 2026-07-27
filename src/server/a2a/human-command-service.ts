import type Database from 'better-sqlite3';
import { getDb } from '../db';
import {
  A2ACollaborationRepository,
  type AbortedA2ACollaboration,
  type OfferedPassGroup,
} from './collaboration';
import { A2ACommandGuard } from './command-guard';

export interface HumanHandoffCommand {
  conversationId: string;
  messageId: string;
  prompt: string;
  targetAgentIds: string[];
  taskId?: string;
}

export type HumanHandoffResult =
  | { status: 'aborted'; previous?: AbortedA2ACollaboration }
  | { status: 'offered'; handoff: OfferedPassGroup };

export interface HumanA2ACommandServiceOptions {
  db?: Database.Database;
  collaboration?: A2ACollaborationRepository;
  commandGuard?: Pick<A2ACommandGuard, 'assert'>;
}

export class HumanA2ACommandService {
  private readonly database?: Database.Database;
  private readonly collaboration: A2ACollaborationRepository;
  private readonly commandGuard: Pick<A2ACommandGuard, 'assert'>;

  constructor(options: HumanA2ACommandServiceOptions = {}) {
    this.database = options.db;
    this.collaboration = options.collaboration
      ?? new A2ACollaborationRepository({ db: options.db });
    this.commandGuard = options.commandGuard ?? new A2ACommandGuard();
  }

  submit(command: HumanHandoffCommand): HumanHandoffResult {
    const conversationId = command.conversationId.trim();
    const messageId = command.messageId.trim();
    const prompt = command.prompt.trim();
    const targets = [...new Set(command.targetAgentIds.map((id) => id.trim()).filter(Boolean))];
    if (!conversationId) throw new Error('a2a_human_conversation_required');
    if (!messageId) throw new Error('a2a_human_message_required');
    if (targets.length > 0 && !prompt) throw new Error('a2a_human_prompt_required');
    if (targets.length > 0) {
      this.commandGuard.assert({
        conversationId,
        fromHolderId: 'human',
        fromHolderType: 'user',
        branches: targets.map((toAgentId) => ({ toAgentId })),
      });
    }
    const db = this.database ?? getDb();
    const execute = db.transaction((): HumanHandoffResult => {
      const existing = this.collaboration.findChainByRoot(
        conversationId,
        'user_turn',
        messageId,
      );
      if (targets.length === 0) {
        return {
          status: 'aborted',
          previous: this.collaboration.abortActiveChain(
            conversationId,
            'human_turn_without_handoff',
          ),
        };
      }
      if (!existing) {
        this.collaboration.abortActiveChain(conversationId, 'superseded_by_human_turn');
      }
      const created = this.collaboration.createChain({
        conversationId,
        rootTriggerType: 'user_turn',
        rootTriggerId: messageId,
        correlationId: messageId,
        holderId: 'human',
        holderType: 'user',
      });
      return {
        status: 'offered',
        handoff: this.collaboration.offerPassGroup({
          chainId: created.chain.id,
          sourcePossessionId: created.rootPossession.id,
          expectedSourceRevision: created.rootPossession.revision,
          idempotencyKey: `human:${messageId}`,
          branches: targets.map((toAgentId) => ({
            toAgentId,
            intent: 'delegate',
            taskId: command.taskId,
            packet: {
              title: `Human request for @${toAgentId}`,
              requestedAction: prompt,
              possessionSummary: prompt,
              relevantDecisions: [],
              evidenceRefs: command.taskId
                ? [{ label: command.taskId, taskId: command.taskId }]
                : [],
              constraints: [],
              openQuestions: [],
              forbiddenBehaviors: [],
              sourceMessageIds: [messageId],
            },
          })),
        }),
      };
    });
    return execute.immediate();
  }
}
