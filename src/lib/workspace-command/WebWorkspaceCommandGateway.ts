import {
  WorkspaceCommandRequestError,
  type WorkspaceCommand,
  type WorkspaceCommandGateway,
  type WorkspaceCommandReceipt,
} from './types';
import {
  DESKTOP_RENDERER_SESSION_HEADER,
  readDesktopRendererSessionToken,
} from '@/lib/desktop-host/renderer-session';

interface WorkspaceCommandResponse {
  receipt?: WorkspaceCommandReceipt;
  error?: string;
  reasonCode?: string;
}

function isReceipt(value: unknown): value is WorkspaceCommandReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<WorkspaceCommandReceipt>;
  return typeof receipt.idempotencyKey === 'string'
    && typeof receipt.commandType === 'string'
    && typeof receipt.projectPath === 'string'
    && typeof receipt.deliveryId === 'string'
    && (receipt.status === 'accepted' || receipt.status === 'rejected')
    && typeof receipt.duplicate === 'boolean'
    && Array.isArray(receipt.targetAgentIds)
    && typeof receipt.recordedAt === 'string';
}

export class WebWorkspaceCommandGateway implements WorkspaceCommandGateway {
  constructor(
    private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    private readonly endpoint = '/api/workspace-commands',
  ) {}

  async submit(command: WorkspaceCommand): Promise<WorkspaceCommandReceipt> {
    let response: Response;
    try {
      const rendererSession = readDesktopRendererSessionToken();
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(rendererSession ? { [DESKTOP_RENDERER_SESSION_HEADER]: rendererSession } : {}),
        },
        body: JSON.stringify(command),
      });
    } catch (error) {
      throw new WorkspaceCommandRequestError(
        'workspace_command_transport_failed',
        error instanceof Error ? error.message : '无法连接命令服务',
      );
    }
    const body = await response.json().catch(() => undefined) as WorkspaceCommandResponse | undefined;
    if (body && isReceipt(body.receipt)) return body.receipt;
    throw new WorkspaceCommandRequestError(
      body?.reasonCode ?? `workspace_command_http_${response.status}`,
      body?.error ?? `命令提交失败（${response.status}）`,
      response.status,
    );
  }
}

export const workspaceCommandGateway: WorkspaceCommandGateway = new WebWorkspaceCommandGateway();
