export interface HumanCommandActor {
  type: 'user';
  id: string;
}

export interface SubmitDeliveryRequirementCommand {
  type: 'delivery.requirement.submit';
  idempotencyKey: string;
  projectPath: string;
  deliveryId: string;
  actor: HumanCommandActor;
  content: string;
  targetAgentIds: string[];
  taskId?: string;
  issuedAt: string;
  mentions?: string[];
  intent?: 'ideate' | 'execute' | 'review' | 'general';
  replyToMessageId?: string;
}

export interface RequestDeliveryPlanCommand {
  type: 'delivery.plan.request';
  idempotencyKey: string;
  projectPath: string;
  deliveryId: string;
  actor: HumanCommandActor;
  issuedAt: string;
}

export interface RequestTaskProgressCommand {
  type: 'task.progress.request';
  idempotencyKey: string;
  projectPath: string;
  deliveryId: string;
  taskId: string;
  actor: HumanCommandActor;
  request: string;
  issuedAt: string;
}

export type HumanCommand =
  | SubmitDeliveryRequirementCommand
  | RequestDeliveryPlanCommand
  | RequestTaskProgressCommand;

export interface CommandReceipt {
  idempotencyKey: string;
  commandType: HumanCommand['type'];
  projectPath: string;
  deliveryId: string;
  status: 'accepted' | 'rejected';
  duplicate: boolean;
  messageId?: string;
  taskId?: string;
  targetAgentIds: string[];
  reasonCode?: string;
  userMessage?: string;
  recordedAt: string;
}

export interface HumanCommandGateway {
  submit(command: HumanCommand): Promise<CommandReceipt>;
}

export class HumanCommandRequestError extends Error {
  constructor(
    readonly reasonCode: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HumanCommandRequestError';
  }
}

export function createHumanCommandIdempotencyKey(deliveryId: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `human:${deliveryId}:${Date.now().toString(36)}:${random}`;
}
