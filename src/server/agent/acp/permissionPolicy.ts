import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

export type AcpPermissionDecision = 'allow_once' | 'deny';
export type AcpPermissionPolicy =
  | AcpPermissionDecision
  | ((request: RequestPermissionRequest) =>
      | AcpPermissionDecision
      | Promise<AcpPermissionDecision>);

export function createCorrelatedPlatformMcpPermissionPolicy(
  basePolicy: AcpPermissionPolicy,
  approvedToolCallIds: Set<string>,
  approvedToolNames: ReadonlySet<string> = new Set(),
): AcpPermissionPolicy {
  const consumedToolCallIds = new Set<string>();
  return async (request) => {
    const toolCallId = request.toolCall.toolCallId;
    if (consumedToolCallIds.has(toolCallId)) {
      return typeof basePolicy === 'function' ? basePolicy(request) : basePolicy;
    }
    if (
      typeof request.toolCall.title === 'string'
      && approvedToolNames.has(request.toolCall.title)
    ) {
      consumedToolCallIds.add(toolCallId);
      return 'allow_once';
    }
    if (request._meta?.is_mcp_tool_approval === true) {
      const deadline = Date.now() + 250;
      do {
        if (approvedToolCallIds.delete(toolCallId)) {
          consumedToolCallIds.add(toolCallId);
          return 'allow_once';
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      } while (Date.now() < deadline);
    }
    return typeof basePolicy === 'function' ? basePolicy(request) : basePolicy;
  };
}

const DEFAULT_POLICY_TIMEOUT_MS = 5_000;

function deny(request: RequestPermissionRequest): RequestPermissionResponse {
  const reject = request.options.find(
    (option) => option.kind === 'reject_once' || option.kind === 'reject_always',
  );
  return reject
    ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

function allowOnce(request: RequestPermissionRequest): RequestPermissionResponse {
  const allow = request.options.find((option) => option.kind === 'allow_once');
  return allow
    ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
    : deny(request);
}

/**
 * Build a fail-closed ACP permission handler.
 *
 * Missing policy, policy failures, timeouts and unavailable `allow_once`
 * options all deny the request. `allow_always` is intentionally never chosen
 * implicitly because a per-turn runtime must not create durable permission
 * state as a side effect of a transient dispatch.
 */
export function createPermissionHandler(
  policy: AcpPermissionPolicy = 'deny',
  timeoutMs = DEFAULT_POLICY_TIMEOUT_MS,
): (request: RequestPermissionRequest) => Promise<RequestPermissionResponse> {
  return async (request) => {
    try {
      let decision: AcpPermissionDecision;
      if (typeof policy === 'function') {
        let timer: NodeJS.Timeout | undefined;
        try {
          decision = await Promise.race([
            Promise.resolve(policy(request)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('ACP permission policy timed out')),
                Math.max(1, timeoutMs),
              );
              timer.unref?.();
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      } else {
        decision = policy;
      }
      return decision === 'allow_once' ? allowOnce(request) : deny(request);
    } catch {
      return deny(request);
    }
  };
}
