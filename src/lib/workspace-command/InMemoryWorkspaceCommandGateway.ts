import {
  WorkspaceCommandRequestError,
  type WorkspaceCommand,
  type WorkspaceCommandGateway,
  type WorkspaceCommandReceipt,
} from './types';

export class InMemoryWorkspaceCommandGateway implements WorkspaceCommandGateway {
  readonly commands: WorkspaceCommand[] = [];
  private readonly receipts = new Map<string, { request: string; receipt: WorkspaceCommandReceipt }>();

  async submit(command: WorkspaceCommand): Promise<WorkspaceCommandReceipt> {
    const request = JSON.stringify(command);
    const existing = this.receipts.get(command.idempotencyKey);
    if (existing) {
      if (existing.request !== request) {
        throw new WorkspaceCommandRequestError(
          'workspace_command_idempotency_conflict',
          `幂等键已绑定到另一条命令：${command.idempotencyKey}`,
          409,
        );
      }
      return { ...existing.receipt, duplicate: true };
    }
    this.commands.push(command);
    const receipt: WorkspaceCommandReceipt = {
      idempotencyKey: command.idempotencyKey,
      commandType: command.type,
      projectPath: command.projectPath,
      deliveryId: command.deliveryId,
      status: 'accepted',
      duplicate: false,
      ...('taskId' in command && command.taskId ? { taskId: command.taskId } : {}),
      targetAgentIds: command.type === 'delivery.requirement.submit'
        ? [...command.targetAgentIds]
        : [],
      recordedAt: command.issuedAt,
    };
    this.receipts.set(command.idempotencyKey, { request, receipt });
    return receipt;
  }
}
