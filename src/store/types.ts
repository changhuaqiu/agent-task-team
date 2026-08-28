export interface ToolEvent {
  id: string;
  type: 'tool_use' | 'tool_result' | 'error';
  label: string;
  detail?: string;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  agentId: string | 'human' | 'system';
  content: string;
  /** Runtime-provided reasoning summary. Kept separate from the user-facing answer. */
  thinking?: string;
  contentType?: 'text' | 'thinking' | 'tool_use';
  timestamp: string;
  conversationId?: string;
  invocationId?: string;
  isApprovalRequest?: boolean;
  referencedTaskId?: string;
  taskRefs?: {
    id: string;
    title: string;
    status?: string;
    ownerAgentId?: string;
  }[];
  taskActionIds?: string[];
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  mentions?: string[];
  intent?: 'ideate' | 'execute' | 'review' | 'general' | 'progress' | 'task_status';
  selectedProposals?: string[];
  toolEvents?: ToolEvent[];
  isStreaming?: boolean;
  artifactPreview?: {
    files: { path: string; change: 'added' | 'modified' | 'deleted' }[];
  };
  rejectionReason?: string;
  metadata?: Record<string, any>;
  tokenUsage?: TokenUsage;
  source?: 'user' | 'a2a';
  fromAgentId?: string;
}

export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TokenUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  byModel: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
}

export type {
  A2AProjectionPassStatus as A2AHandoffStatus,
  A2AProjectionHandoff as A2AHandoffView,
  A2AProjectionSnapshot as A2APossessionView,
} from '@/shared/project-view-events';
