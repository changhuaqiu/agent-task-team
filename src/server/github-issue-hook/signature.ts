import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const MAX_GITHUB_WEBHOOK_BYTES = 1024 * 1024;

export class WebhookPayloadTooLargeError extends Error {
  readonly code = 'payload_too_large';
}

export function verifyGitHubWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
    'utf8',
  );
  const actual = Buffer.from(signatureHeader, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function readRawWebhookBody(
  request: IncomingMessage,
  maximumBytes = MAX_GITHUB_WEBHOOK_BYTES,
): Promise<Buffer> {
  const contentLengthHeader = request.headers['content-length'];
  const contentLength = Array.isArray(contentLengthHeader)
    ? Number(contentLengthHeader[0])
    : Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new WebhookPayloadTooLargeError(`Webhook payload exceeds ${maximumBytes} bytes`);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maximumBytes) {
      throw new WebhookPayloadTooLargeError(`Webhook payload exceeds ${maximumBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}
