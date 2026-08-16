import {
  HumanCommandRequestError,
  type CommandReceipt,
  type HumanCommand,
  type HumanCommandGateway,
} from './types';

type ReceiptFactory = (command: HumanCommand, sequence: number) => CommandReceipt;

function defaultReceipt(command: HumanCommand, sequence: number): CommandReceipt {
  return {
    idempotencyKey: command.idempotencyKey,
    commandType: command.type,
    projectPath: command.projectPath,
    deliveryId: command.deliveryId,
    status: 'accepted',
    duplicate: false,
    ...(command.type === 'delivery.requirement.submit'
      ? { messageId: `memory-message-${sequence}` }
      : {}),
    ...('taskId' in command && command.taskId ? { taskId: command.taskId } : {}),
    targetAgentIds: command.type === 'delivery.requirement.submit'
      ? [...command.targetAgentIds]
      : [],
    recordedAt: command.issuedAt,
  };
}

export class InMemoryHumanCommandGateway implements HumanCommandGateway {
  readonly commands: HumanCommand[] = [];
  private readonly accepted = new Map<string, { request: string; receipt: CommandReceipt }>();

  constructor(private readonly receiptFactory: ReceiptFactory = defaultReceipt) {}

  async submit(command: HumanCommand): Promise<CommandReceipt> {
    const request = JSON.stringify(command);
    const existing = this.accepted.get(command.idempotencyKey);
    if (existing) {
      if (existing.request !== request) {
        throw new HumanCommandRequestError(
          'human_command_idempotency_conflict',
          `幂等键已绑定到另一条命令：${command.idempotencyKey}`,
          409,
        );
      }
      return { ...existing.receipt, duplicate: true };
    }

    this.commands.push(command);
    const receipt = this.receiptFactory(command, this.commands.length);
    this.accepted.set(command.idempotencyKey, { request, receipt });
    return receipt;
  }
}
