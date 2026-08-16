import { describe, expect, it, vi } from 'vitest';
import type { HumanCommand } from './types';
import { HumanCommandRequestError } from './types';
import { InMemoryHumanCommandGateway } from './InMemoryHumanCommandGateway';
import { WebHumanCommandGateway } from './WebHumanCommandGateway';

const command: HumanCommand = {
  type: 'delivery.requirement.submit',
  idempotencyKey: 'gateway-1',
  projectPath: 'C:/projects/example',
  deliveryId: 'delivery-1',
  actor: { type: 'user', id: 'human' },
  content: '继续处理',
  targetAgentIds: ['mario'],
  issuedAt: '2026-08-16T10:00:00.000Z',
};

describe('HumanCommandGateway adapters', () => {
  it('Web adapter returns a rejected receipt even when HTTP status is 409', async () => {
    const receipt = {
      idempotencyKey: 'gateway-1',
      commandType: 'delivery.requirement.submit' as const,
      projectPath: 'C:/projects/example',
      deliveryId: 'delivery-1',
      status: 'rejected' as const,
      duplicate: false,
      targetAgentIds: [],
      reasonCode: 'a2a_no_available_agent',
      userMessage: '当前交付没有可接手要求的团队成员',
      recordedAt: '2026-08-16T10:00:01.000Z',
    };
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ receipt }),
    } as Response));

    await expect(new WebHumanCommandGateway(fetcher as typeof fetch).submit(command))
      .resolves.toEqual(receipt);
    expect(fetcher).toHaveBeenCalledWith('/api/human-commands', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(command),
    }));
  });

  it('Web adapter maps protocol errors to a typed request failure', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'unavailable', reasonCode: 'service_unavailable' }),
    } as Response));

    await expect(new WebHumanCommandGateway(fetcher as typeof fetch).submit(command))
      .rejects.toMatchObject<Partial<HumanCommandRequestError>>({
        reasonCode: 'service_unavailable',
        status: 503,
      });
  });

  it('In-memory adapter implements duplicate and conflict semantics', async () => {
    const gateway = new InMemoryHumanCommandGateway();
    const first = await gateway.submit(command);
    const retry = await gateway.submit(command);

    expect(retry).toEqual({ ...first, duplicate: true });
    expect(gateway.commands).toHaveLength(1);
    await expect(gateway.submit({ ...command, content: '另一条要求' }))
      .rejects.toMatchObject({ reasonCode: 'human_command_idempotency_conflict' });
  });

  it('does not invent a chat message for non-message commands', async () => {
    const receipt = await new InMemoryHumanCommandGateway().submit({
      type: 'delivery.plan.request',
      idempotencyKey: 'plan-1',
      projectPath: 'C:/projects/example',
      deliveryId: 'delivery-1',
      actor: { type: 'user', id: 'human' },
      issuedAt: '2026-08-16T10:00:00.000Z',
    });

    expect(receipt.messageId).toBeUndefined();
  });
});
