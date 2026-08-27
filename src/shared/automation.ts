export type AutomationConditionOperator = 'equals' | 'not_equals' | 'contains';

export interface AutomationCondition {
  field:
    | 'type'
    | 'actor.id'
    | 'subject.type'
    | 'payload.status'
    | 'payload.previousStatus'
    | 'payload.agentId'
    | 'payload.summary'
    | 'payload.content'
    | 'payload.senderId';
  operator: AutomationConditionOperator;
  value: string;
}

export type AutomationTrigger =
  | { type: 'event'; eventType: string; conditions: AutomationCondition[] }
  | { type: 'schedule'; intervalMinutes: number }
  | { type: 'manual' };

export type AutomationAction =
  | { id: string; type: 'notify'; message: string }
  | { id: string; type: 'dispatch_agent'; agentId: string; prompt: string }
  | {
      id: string;
      type: 'product_command';
      command: {
        name: 'work.create';
        input: {
          title: string;
          category: 'issue' | 'change_request' | 'improvement';
          description?: string;
        };
      };
    }
  | { id: string; type: 'request_decision'; prompt: string };

export type AutomationDecisionStatus = 'pending' | 'approved' | 'denied';

export interface AutomationDecision {
  id: string;
  automationId: string;
  runId: string;
  projectId: string;
  stepId: string;
  prompt: string;
  status: AutomationDecisionStatus;
  requestedBy: string;
  decidedBy?: string;
  note?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface ProjectAutomation {
  id: string;
  projectId: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  revision: number;
  activationWatermarkAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunStatus = 'pending' | 'running' | 'waiting_decision' | 'completed' | 'failed' | 'cancelled' | 'skipped';

export interface AutomationStepTrace {
  stepId: string;
  actionType: AutomationAction['type'];
  status: 'running' | 'waiting_decision' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  output?: Record<string, unknown>;
  error?: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  projectId: string;
  sourceEventId?: string;
  scheduleClaim?: string;
  status: AutomationRunStatus;
  currentStep?: number;
  triggerContext: Record<string, unknown>;
  definitionRevision: number;
  triggerSnapshot: AutomationTrigger;
  actionsSnapshot: AutomationAction[];
  retryCount: number;
  trace: AutomationStepTrace[];
  decisions?: AutomationDecision[];
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationDefinitionDocument {
  schemaVersion: 1;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
}
