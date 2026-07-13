// src/lib/agent-context/MemoryHook.ts
/**
 * Memory Hook Contract (NoOp Implementation)
 *
 * This module defines the contract for memory recall/write operations.
 * The current implementation is NoOp (returns empty artifacts, does nothing).
 * Future implementations will connect to archival storage (see memory spec).
 */

export interface MemoryArtifact {
  id: string;
  kind: 'decision' | 'fact' | 'preference' | 'blocker';
  content: string;
  evidence?: string;
  timestamp: string;
  relevanceScore?: number;
}

export interface MemoryRecallInput {
  scope: string;          // = conversationId (project scope)
  agentId: string;
  query: string;          // 召回锚点（本期用不到，预留）
  limit?: number;
}

export interface MemoryWriteInput {
  scope: string;
  agentId: string;
  kind: 'decision' | 'fact' | 'preference' | 'blocker';
  content: string;
  evidence?: string;
}

export interface MemoryHook {
  recall(input: MemoryRecallInput): Promise<MemoryArtifact[]>;
  write(input: MemoryWriteInput): Promise<void>;
}

// ============================================================================
// NoOp Implementation (本期实现)
// ============================================================================

const noOpMemoryHookImpl: MemoryHook = {
  async recall(_input: MemoryRecallInput): Promise<MemoryArtifact[]> {
    // NoOp: return empty array
    // Future implementation: query memory-repo for relevant artifacts
    return [];
  },

  async write(_input: MemoryWriteInput): Promise<void> {
    // NoOp: do nothing
    // Future implementation: write to memory-repo
  },
};

// ============================================================================
// Export singleton
// ============================================================================

export const noOpMemoryHook = noOpMemoryHookImpl;