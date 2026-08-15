import type { TeamRuntime } from '@/lib/team-runtime';
import { resolveConversationRuntime } from '../invocation-pipeline/conversation-runtime';
import { A2ACollaborationInvariantError } from './collaboration';

export interface A2ACommandGuardBranch {
  toAgentId: string;
}

export interface A2ACommandGuardInput {
  conversationId: string;
  fromHolderId: string;
  fromHolderType: 'user' | 'agent' | 'system';
  branches: A2ACommandGuardBranch[];
}

export interface A2ACommandGuardOptions {
  resolveRuntime?: (conversationId: string) => TeamRuntime | undefined;
}

/**
 * Admission guard for collaboration commands. Roster and communication rules
 * belong to Team Runtime; the A2A aggregate only receives already-authorized
 * branches.
 */
export class A2ACommandGuard {
  private readonly resolveRuntime: (conversationId: string) => TeamRuntime | undefined;

  constructor(options: A2ACommandGuardOptions = {}) {
    this.resolveRuntime = options.resolveRuntime ?? resolveConversationRuntime;
  }

  assert(input: A2ACommandGuardInput): void {
    const runtime = this.resolveRuntime(input.conversationId);
    if (!runtime) {
      throw new A2ACollaborationInvariantError(
        'a2a_conversation_runtime_missing',
        input.conversationId,
      );
    }
    const roster = new Set(runtime.roster.map((agent) => agent.id));
    if (input.fromHolderType === 'agent' && !roster.has(input.fromHolderId)) {
      throw new A2ACollaborationInvariantError(
        'a2a_source_not_in_roster',
        input.fromHolderId,
      );
    }
    for (const branch of input.branches) {
      if (!roster.has(branch.toAgentId)) {
        throw new A2ACollaborationInvariantError(
          'a2a_target_not_in_roster',
          branch.toAgentId,
        );
      }
      if (input.fromHolderType === 'agent') {
        const explanation = runtime.communicationPolicy.explainBlock(
          input.fromHolderId,
          branch.toAgentId,
        );
        if (explanation !== undefined) {
          throw new A2ACollaborationInvariantError(
            'a2a_communication_policy_blocked',
            `${input.fromHolderId}:${branch.toAgentId}:${explanation || 'communication policy denied the handoff'}`,
          );
        }
      }
    }
  }
}
