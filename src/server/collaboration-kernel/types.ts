import type { ContextRequest } from '../../lib/agent-context/ContextManager';
import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';
import type {
  AgentActivationSource,
  AgentExecutionMode,
} from '../invocation-pipeline/types';
import type { PlatformEvent } from '../platform-events/types';

export type CollaborationReplyAddress =
  | { type: 'human_command'; id: string }
  | { type: 'task'; id: string }
  | { type: 'quality_gate'; id: string }
  | { type: 'delivery_run'; id: string }
  | { type: 'a2a_possession'; id: string }
  | { type: 'a2a_pass_group'; id: string }
  | { type: 'evaluation_case'; id: string }
  | { type: 'work'; id: string };

export interface WorkRequest {
  projectId: string;
  targetAgentId: string;
  source: AgentActivationSource;
  requestedAction: string;
  idempotencyKey: string;
  cause: {
    correlationId: string;
    causationId?: string;
    event?: PlatformEvent;
  };
  scope?: {
    workId?: string;
    executionMode?: AgentExecutionMode;
    taskId?: string;
    deliveryRunId?: string;
  };
  collaboration?: {
    fromAgentId?: string;
    chainId?: string;
    passId?: string;
    possession?: { id: string; revision: number };
  };
  context?: {
    scenario?: ContextScenario;
    handoff?: ContextRequest['a2aHandoff'];
    wakeup?: ContextRequest['wakeup'];
    evaluation?: {
      executionId: string;
      caseId: string;
      applicationSnapshotId: string;
      targetManifestDigest: string;
    };
  };
  policy?: {
    rejectIfDeliveryOwned?: boolean;
  };
  replyTo: CollaborationReplyAddress;
}

export interface WorkRequestReceipt {
  requestId: string;
  inboxItemId: string;
  laneId: string;
  projectId: string;
  targetAgentId: string;
  replyTo: CollaborationReplyAddress;
}

export type WorkCancellation =
  | {
      kind: 'request';
      projectId: string;
      targetAgentId: string;
      idempotencyKey?: string;
    }
  | { kind: 'task'; projectId: string; taskId: string; includeClaimed?: boolean }
  | { kind: 'delivery'; projectId: string; deliveryRunId: string }
  | { kind: 'a2a_chain'; projectId: string; chainId: string }
  | { kind: 'work'; projectId: string; workIds: readonly string[]; reasonCode?: string };
