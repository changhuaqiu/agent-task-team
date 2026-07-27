import { createHash } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureAutonomousDeliveryRuntime } from '@/server/autonomous-delivery/bootstrap';
import { readGitHubIssueHookConfig, GitHubIssueHookConfigurationError } from '@/server/github-issue-hook/config';
import { GitHubIssuePayloadError } from '@/server/github-issue-hook/compiler';
import {
  GitHubIssueAgentIngress,
  GitHubIssueRuntimeUnavailableError,
} from '@/server/github-issue-hook/ingress';
import {
  readRawWebhookBody,
  verifyGitHubWebhookSignature,
  WebhookPayloadTooLargeError,
} from '@/server/github-issue-hook/signature';
import { ensureProjectSocketRuntime } from '@/server/socket-runtime';

export const config = {
  api: {
    bodyParser: false,
  },
};

function header(req: NextApiRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function errorResponse(
  res: NextApiResponse,
  status: number,
  code: string,
  message: string,
) {
  return res.status(status).json({ error: message, reasonCode: code });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return errorResponse(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  try {
    const hookConfig = readGitHubIssueHookConfig();
    const rawBody = await readRawWebhookBody(req);
    const signature = header(req, 'x-hub-signature-256');
    if (!signature) {
      return errorResponse(res, 401, 'signature_missing', 'GitHub webhook signature is required');
    }
    if (!verifyGitHubWebhookSignature(rawBody, signature, hookConfig.secret)) {
      return errorResponse(res, 401, 'signature_invalid', 'GitHub webhook signature is invalid');
    }

    const eventName = header(req, 'x-github-event');
    const deliveryId = header(req, 'x-github-delivery');
    if (!eventName || !deliveryId) {
      return errorResponse(
        res,
        400,
        'event_headers_missing',
        'GitHub event and delivery headers are required',
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return errorResponse(res, 400, 'payload_invalid', 'Webhook payload must be valid JSON');
    }

    if (eventName === 'ping') {
      return res.status(200).json({ ok: true, disposition: 'ping' });
    }

    let deliveryRuntime: ReturnType<typeof ensureAutonomousDeliveryRuntime> | undefined;
    const ingress = new GitHubIssueAgentIngress({
      resolveRuntime: () => {
        const runtime = ensureProjectSocketRuntime(res);
        if (!runtime) return undefined;
        deliveryRuntime = ensureAutonomousDeliveryRuntime(runtime.io);
        return deliveryRuntime;
      },
    });
    const result = ingress.handle({
      eventName,
      deliveryId,
      payload,
      payloadDigest: createHash('sha256').update(rawBody).digest('hex'),
      config: hookConfig,
    });

    if (result.disposition === 'accepted') {
      if (!deliveryRuntime) {
        return errorResponse(res, 503, 'runtime_unavailable', 'Agent runtime is not ready');
      }
      void deliveryRuntime.advance(result.mapping.delivery_run_id, {
        kind: 'started',
        ref: `github:${deliveryId}`,
      }).catch((error) => {
        console.error(
          `[github-issue-hook] initial advance failed for delivery ${deliveryId}:`,
          error instanceof Error ? error.message : String(error),
        );
      });
      return res.status(202).json({
        ok: true,
        disposition: result.disposition,
        conversationId: result.mapping.conversation_id,
        deliveryRunId: result.mapping.delivery_run_id,
      });
    }

    if (result.disposition === 'duplicate') {
      return res.status(200).json({
        ok: true,
        disposition: result.disposition,
        conversationId: result.mapping.conversation_id,
        deliveryRunId: result.mapping.delivery_run_id,
      });
    }
    return res.status(200).json({
      ok: true,
      disposition: result.disposition,
      reason: result.reason,
    });
  } catch (error) {
    if (error instanceof WebhookPayloadTooLargeError) {
      return errorResponse(res, 413, error.code, error.message);
    }
    if (error instanceof GitHubIssueHookConfigurationError) {
      return errorResponse(res, 503, error.code, error.message);
    }
    if (error instanceof GitHubIssuePayloadError) {
      return errorResponse(res, 400, error.code, error.message);
    }
    if (error instanceof GitHubIssueRuntimeUnavailableError) {
      return errorResponse(res, 503, error.code, error.message);
    }
    console.error(
      '[github-issue-hook] request failed:',
      error instanceof Error ? error.message : String(error),
    );
    return errorResponse(res, 500, 'internal_error', 'GitHub Issue hook failed');
  }
}
