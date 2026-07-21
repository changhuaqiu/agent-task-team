import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  readRawWebhookBody,
  verifyGitHubWebhookSignature,
} from './signature';

describe('GitHub webhook transport security', () => {
  it('verifies the exact raw request bytes', () => {
    const body = Buffer.from('{"zen":"Keep it logically awesome."}');
    const secret = 'a-secure-test-secret-value';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(verifyGitHubWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyGitHubWebhookSignature(Buffer.from('{}'), signature, secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(body, 'sha256=bad', secret)).toBe(false);
  });

  it('rejects streaming bodies larger than the configured limit', async () => {
    const request = Readable.from([Buffer.alloc(5), Buffer.alloc(6)]) as Readable & {
      headers: Record<string, string>;
    };
    request.headers = {};
    await expect(readRawWebhookBody(request as never, 10)).rejects.toThrow(
      'Webhook payload exceeds 10 bytes',
    );
  });
});
