import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { EngineId } from '../types';
import { workContractRepo } from '../../work-contract/repository';
import type { WorkAuthorityRow, WorkContract } from '../../work-contract/types';

type AcpPermissionDecision = 'allow_once' | 'deny';
export type AcpPermissionPolicy =
  | AcpPermissionDecision
  | ((request: RequestPermissionRequest) =>
      | AcpPermissionDecision
      | Promise<AcpPermissionDecision>);

interface AutonomousAcpAuthorization {
  allowCodeChanges?: boolean;
  allowPush?: boolean;
  allowPullRequest?: boolean;
  allowAutoMerge?: boolean;
}

interface WorkContractPermissionEnvelope {
  authorization?: AutonomousAcpAuthorization;
}

async function evaluatePolicy(
  policy: AcpPermissionPolicy,
  request: RequestPermissionRequest,
): Promise<AcpPermissionDecision> {
  return typeof policy === 'function' ? policy(request) : policy;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function readAuthorization(permissions: unknown): AutonomousAcpAuthorization | undefined {
  const envelope = asRecord(permissions) as WorkContractPermissionEnvelope | undefined;
  return asRecord(envelope?.authorization) as AutonomousAcpAuthorization | undefined;
}

function commandFrom(request: RequestPermissionRequest): string | undefined {
  const input = asRecord(request.toolCall.rawInput);
  return typeof input?.command === 'string' ? input.command.trim() : undefined;
}

function isPathInsideCwd(filePath: string, cwd: string): boolean {
  const candidate = resolve(cwd, filePath);
  let existingAncestor = candidate;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) return false;
    existingAncestor = parent;
  }
  const realCwd = realpathSync(cwd);
  const realAncestor = realpathSync(existingAncestor);
  const relation = relative(realCwd, realAncestor);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function editTargetsProject(request: RequestPermissionRequest, cwd: string): boolean {
  const input = asRecord(request.toolCall.rawInput);
  const filePath = input?.file_path;
  return typeof filePath === 'string' && isPathInsideCwd(filePath, cwd);
}

function isAllowedLocalVerificationCommand(command: string): boolean {
  if (!command || /[\r\n;&|><`]|\$\(/.test(command)) return false;
  if (/^node(?:\.exe)?\s+--test(?:=\S+)?(?:\s|$)/i.test(command)) return true;
  if (/^(?:npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.exe)?)\s+test(?:\s|$)/i.test(command)) {
    return true;
  }
  if (/^(?:npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.exe)?)\s+run\s+(?:test|build|lint|typecheck|check|verify|e2e)(?::[\w.-]+)?(?:\s|$)/i.test(command)) {
    return true;
  }
  return /^(?:npx(?:\.cmd)?(?:\s+--no-install)?|pnpm(?:\.cmd)?\s+exec)\s+(?:vitest|tsc|eslint)(?:\.cmd)?(?:\s|$)/i.test(command)
    || /^(?:npx(?:\.cmd)?(?:\s+--no-install)?|pnpm(?:\.cmd)?\s+exec)\s+next(?:\.cmd)?\s+build(?:\s|$)/i.test(command);
}

/**
 * Convert an immutable autonomous WorkContract authorization into a one-turn
 * ACP policy. This is deliberately narrower than the operator override: it
 * only applies while the owning Invocation is authoritative, never chooses
 * `allow_always`, keeps file edits inside the invocation cwd, and limits
 * execution to local verification commands. External delivery stays on
 * trusted platform actions instead of generic shell access.
 */
export function createAutonomousWorkPermissionPolicy(input: {
  permissions: unknown;
  cwd: string;
  engine: EngineId;
  isAuthorityActive: () => boolean | Promise<boolean>;
}): AcpPermissionPolicy {
  const authorization = readAuthorization(input.permissions);
  if (authorization?.allowCodeChanges !== true) return 'deny';

  return async (request) => {
    if (!await input.isAuthorityActive()) return 'deny';
    const kind = request.toolCall.kind;

    if (kind === 'edit') {
      return editTargetsProject(request, input.cwd) ? 'allow_once' : 'deny';
    }

    // Claude exposes its runtime-native Agent/Task delegation as ACP `think`.
    // Top-level Task requests do not consistently include vendor metadata, so
    // the protocol kind is the stable compatibility boundary.
    if (
      input.engine === 'claude'
      && kind === 'think'
      && typeof asRecord(request.toolCall.rawInput)?.prompt === 'string'
    ) {
      return 'allow_once';
    }

    if (kind === 'execute') {
      const command = commandFrom(request);
      return command && isAllowedLocalVerificationCommand(command) ? 'allow_once' : 'deny';
    }

    return 'deny';
  };
}

export function createWorkContractPermissionPolicy(input: {
  workContract: WorkContract;
  cwd: string;
  engine: EngineId;
  authorityReader?: (workId: string) => WorkAuthorityRow | undefined;
}): AcpPermissionPolicy {
  const readAuthority = input.authorityReader ?? ((workId: string) => (
    workContractRepo.getAuthority(workId)
  ));
  return createAutonomousWorkPermissionPolicy({
    permissions: input.workContract.permissions,
    cwd: input.cwd,
    engine: input.engine,
    isAuthorityActive: () => {
      const authority = readAuthority(input.workContract.workId);
      return authority?.status === 'active'
        && authority.project_id === input.workContract.projectId
        && authority.current_contract_id === input.workContract.contractId
        && authority.current_epoch === input.workContract.workEpoch;
    },
  });
}

export function createCorrelatedPlatformMcpPermissionPolicy(
  basePolicy: AcpPermissionPolicy,
  approvedToolCallIds: Set<string>,
  approvedToolNames: ReadonlySet<string> = new Set(),
): AcpPermissionPolicy {
  const consumedToolCallIds = new Set<string>();
  return async (request) => {
    const toolCallId = request.toolCall.toolCallId;
    if (consumedToolCallIds.has(toolCallId)) {
      return evaluatePolicy(basePolicy, request);
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
    return evaluatePolicy(basePolicy, request);
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
