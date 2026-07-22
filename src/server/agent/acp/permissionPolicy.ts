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

const CLAUDE_MCP_TOOL_NAME = /^mcp__([A-Za-z0-9-]+)__([A-Za-z0-9_-]+)$/;

export function normalizeAcpMcpToolName(name: string): string {
  const match = CLAUDE_MCP_TOOL_NAME.exec(name);
  return match ? `mcp.${match[1]}.${match[2]}` : name;
}

type ApprovalState = 'armed' | 'consumed' | 'invalid';

export class CorrelatedPlatformMcpApprovalTracker {
  private readonly calls = new Map<string, { sessionId: string; state: ApprovalState }>();

  observe(sessionId: string, toolCallId: string, approved: boolean): void {
    const existing = this.calls.get(toolCallId);
    if (existing) {
      // ACP only promises tool-call id uniqueness within a session. Reuse in
      // any session, whether identical or conflicting, permanently invalidates
      // the id for this execution so a replay cannot re-arm an approval.
      existing.state = 'invalid';
      return;
    }
    this.calls.set(toolCallId, {
      sessionId,
      state: approved ? 'armed' : 'invalid',
    });
  }

  consume(sessionId: string, toolCallId: string): boolean {
    const call = this.calls.get(toolCallId);
    if (!call || call.sessionId !== sessionId || call.state !== 'armed') return false;
    call.state = 'consumed';
    return true;
  }
}

export function createCorrelatedPlatformMcpPermissionPolicy(
  basePolicy: AcpPermissionPolicy,
  approvals: CorrelatedPlatformMcpApprovalTracker,
  options?: { hardDeny?: boolean },
): AcpPermissionPolicy {
  return async (request) => {
    // An operator hard deny is an emergency boundary for every ACP permission
    // request, including otherwise valid platform MCP approvals.
    if (options?.hardDeny) return 'deny';
    // Claude ACP does not attach Codex ACP's private
    // `_meta.is_mcp_tool_approval` marker. The preceding `tool_call` event is
    // the portable protocol signal: AcpBackend records this call id only after
    // the event's exact normalized tool name matches the current grant. Delete
    // it here so the correlated approval is one-shot and replays fail closed.
    if (approvals.consume(request.sessionId, request.toolCall.toolCallId)) return 'allow_once';
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
