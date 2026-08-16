import {
  HumanCommandRequestError,
  type CommandReceipt,
  type HumanCommand,
  type HumanCommandGateway,
} from './types';

interface HumanCommandResponse {
  receipt?: CommandReceipt;
  error?: string;
  reasonCode?: string;
}

function isReceipt(value: unknown): value is CommandReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<CommandReceipt>;
  return typeof receipt.idempotencyKey === 'string'
    && (
      receipt.commandType === 'delivery.requirement.submit'
      || receipt.commandType === 'delivery.plan.request'
      || receipt.commandType === 'task.progress.request'
    )
    && typeof receipt.projectPath === 'string'
    && typeof receipt.deliveryId === 'string'
    && (receipt.status === 'accepted' || receipt.status === 'rejected')
    && typeof receipt.duplicate === 'boolean'
    && Array.isArray(receipt.targetAgentIds)
    && receipt.targetAgentIds.every((id) => typeof id === 'string')
    && typeof receipt.recordedAt === 'string';
}

export class WebHumanCommandGateway implements HumanCommandGateway {
  constructor(
    private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    private readonly endpoint = '/api/human-commands',
  ) {}

  async submit(command: HumanCommand): Promise<CommandReceipt> {
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      });
    } catch (error) {
      throw new HumanCommandRequestError(
        'human_command_transport_failed',
        error instanceof Error ? error.message : '无法连接命令服务',
      );
    }

    let body: HumanCommandResponse;
    try {
      body = await response.json() as HumanCommandResponse;
    } catch {
      throw new HumanCommandRequestError(
        'human_command_response_invalid',
        `命令服务返回了无法识别的响应（${response.status}）`,
        response.status,
      );
    }

    if (isReceipt(body.receipt)) return body.receipt;
    throw new HumanCommandRequestError(
      body.reasonCode ?? `human_command_http_${response.status}`,
      body.error ?? `命令提交失败（${response.status}）`,
      response.status,
    );
  }
}

export const humanCommandGateway: HumanCommandGateway = new WebHumanCommandGateway();
