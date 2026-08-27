import type { IdentityRef, ObjectRef } from '@/shared/event-envelope';

export const COMMAND_RECEIPT_STATUSES = [
  'applied',
  'duplicate',
  'rejected',
  'conflict',
  'delivery_unknown',
] as const;

export type CommandReceiptStatus = (typeof COMMAND_RECEIPT_STATUSES)[number];

export interface ProductCommand<TName extends string = string, TInput = unknown> {
  commandId: string;
  name: TName;
  projectId: string;
  actor: IdentityRef;
  subject?: ObjectRef;
  idempotencyKey: string;
  expectedRevision?: number;
  correlationId: string;
  causationId?: string;
  input: TInput;
}

export interface CommandReceipt<TResult = unknown> {
  commandId: string;
  status: CommandReceiptStatus;
  reasonCode?: string;
  subject?: ObjectRef;
  revision?: number;
  eventIds: string[];
  evidenceRefs: string[];
  result?: TResult;
  recordedAt: string;
}

export function commandSucceeded(receipt: CommandReceipt): boolean {
  return receipt.status === 'applied' || receipt.status === 'duplicate';
}
