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
  timestamp: string;
  conversationId?: string;
  isApprovalRequest?: boolean;
  referencedTaskId?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  mentions?: string[];
  intent?: 'ideate' | 'execute' | 'review' | 'general' | 'progress' | 'task_status';
  selectedProposals?: string[];
  toolEvents?: ToolEvent[];
  isStreaming?: boolean;
  progressData?: {
    taskId: string;
    type: 'start' | 'update' | 'complete';
    completedSteps: number;
    totalSteps: number;
    steps: { label: string; status: 'done' | 'in_progress' | 'pending' }[];
  };
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

export type A2AHandoffStatus = 'offered' | 'started' | 'blocked' | 'completed' | 'timeout';

export interface A2AHandoffView {
  id: string;
  chainId: string;
  passId?: string;
  fromAgentId?: string;
  toAgentId?: string;
  status: A2AHandoffStatus;
  title?: string;
  reason?: string;
  timestamp: string;
}

export interface A2APossessionView {
  chainId: string;
  currentHolderId?: string;
  status: 'active' | 'completed' | 'blocked' | 'timeout';
  updatedAt: string;
  handoffs: A2AHandoffView[];
}
