// src/server/a2a/dedup.ts
import { createHash } from 'crypto';
import type { InvocationChain, DispatchRequest } from './types-v2';
import type { ChainRepo } from './chain';

// ──────────────────────────────────────────────
// Layer 1: Content Hash
// ──────────────────────────────────────────────

export function computeContentHash(fromAgent: string, toAgent: string, content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256')
    .update(`${fromAgent}:${toAgent}:${normalized}`)
    .digest('hex')
    .slice(0, 16);
}

// ──────────────────────────────────────────────
// Layer 2: Chain-Scoped Agent Dedup
// ──────────────────────────────────────────────

export interface ChainDedupOptions {
  exemptAgentIds?: string[];
  exemptIntents?: string[];
}

export function checkChainAgentDedup(
  chainRepo: ChainRepo,
  chainId: string,
  agentId: string,
  options?: ChainDedupOptions,
  intent?: string,
): { pass: boolean; reason?: string } {
  if (chainRepo.hasAgentInChain(chainId, agentId)) {
    if (options?.exemptAgentIds?.includes(agentId)) {
      return { pass: true };
    }
    if (intent && options?.exemptIntents?.includes(intent)) {
      return { pass: true };
    }
    return { pass: false, reason: `agent ${agentId} already has an entry in chain ${chainId}` };
  }
  return { pass: true };
}

// ──────────────────────────────────────────────
// Layer 3: Ripple Detection
// ──────────────────────────────────────────────

// In-memory tracker: how many distinct agents have requested dispatch to the same target within current chain
const rippleTracker = new Map<string, Set<string>>(); // key: `${chainId}:${targetAgent}` → set of requesters

export function checkRippleDetection(chainId: string, toAgentId: string, fromAgentId: string): { pass: boolean; reason?: string } {
  const key = `${chainId}:${toAgentId}`;
  let requesters = rippleTracker.get(key);
  if (!requesters) {
    requesters = new Set();
    rippleTracker.set(key, requesters);
  }
  requesters.add(fromAgentId);

  if (requesters.size >= 3) {
    return { pass: false, reason: `ripple detected: ${requesters.size} agents targeting ${toAgentId} in chain ${chainId}` };
  }
  return { pass: true };
}

export function clearRippleForChain(chainId: string): void {
  for (const key of rippleTracker.keys()) {
    if (key.startsWith(`${chainId}:`)) {
      rippleTracker.delete(key);
    }
  }
}

// ──────────────────────────────────────────────
// Layer 4: Rate Limit
// ──────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 5_000;
const CHAIN_MAX_DISPATCHES = 8;

// Per-agent last dispatch timestamp
const lastDispatchTime = new Map<string, number>();

export function checkRateLimit(agentId: string): { pass: boolean; reason?: string } {
  const last = lastDispatchTime.get(agentId);
  if (last && Date.now() - last < RATE_LIMIT_WINDOW_MS) {
    return { pass: false, reason: `rate limited: agent ${agentId} received dispatch ${Date.now() - last}ms ago (min ${RATE_LIMIT_WINDOW_MS}ms)` };
  }
  return { pass: true };
}

export function recordDispatchTime(agentId: string): void {
  lastDispatchTime.set(agentId, Date.now());
}

export function resetAllDedupState(): void {
  rippleTracker.clear();
  lastDispatchTime.clear();
}

export function checkChainBudget(chainRepo: ChainRepo, chainId: string): { pass: boolean; reason?: string } {
  const total = chainRepo.getTotalCount(chainId);
  if (total >= CHAIN_MAX_DISPATCHES) {
    return { pass: false, reason: `chain ${chainId} reached max dispatches (${CHAIN_MAX_DISPATCHES})` };
  }
  return { pass: true };
}

// ──────────────────────────────────────────────
// Layer 5: Chain Lifetime
// ──────────────────────────────────────────────

export function checkChainLifetime(chain: InvocationChain): { pass: boolean; reason?: string } {
  const elapsed = Date.now() - new Date(chain.createdAt).getTime();
  if (elapsed > chain.config.maxDurationMs) {
    return { pass: false, reason: `chain ${chain.id} exceeded max duration (${elapsed}ms > ${chain.config.maxDurationMs}ms)` };
  }
  return { pass: true };
}

// ──────────────────────────────────────────────
// Direct Ping-Pong Detection (zero tolerance)
// ──────────────────────────────────────────────

export function checkDirectPingPong(chainRepo: ChainRepo, chainId: string, fromAgentId: string, toAgentId: string, options?: ChainDedupOptions, intent?: string): { pass: boolean; reason?: string } {
  // Coordinators are exempt from ping-pong detection — they are the natural re-entry point
  if (options?.exemptAgentIds?.includes(toAgentId)) {
    return { pass: true };
  }
  // Reject/escalate intents are legitimate A→B→A patterns (reviewer sends back to implementer)
  if (intent && options?.exemptIntents?.includes(intent)) {
    return { pass: true };
  }
  // If toAgent just dispatched to fromAgent in this chain, block immediately
  const worklist = chainRepo.getWorklistForChain(chainId);
  const lastEntry = worklist.filter(e => e.status === 'done' || e.status === 'executing').pop();
  if (lastEntry && lastEntry.agentId === fromAgentId && lastEntry.requestedBy === toAgentId) {
    return { pass: false, reason: `direct ping-pong: ${toAgentId} → ${fromAgentId} → ${toAgentId}` };
  }
  return { pass: true };
}

// ──────────────────────────────────────────────
// Aggregate: run all layers
// ──────────────────────────────────────────────

export interface DedupResult {
  pass: boolean;
  failedLayer?: string;
  reason?: string;
}

export function runAllDedupLayers(
  chainRepo: ChainRepo,
  chain: InvocationChain,
  req: DispatchRequest,
  options?: ChainDedupOptions,
): DedupResult {
  // Layer 5: Chain lifetime (check first — if chain is expired, nothing else matters)
  const lifetime = checkChainLifetime(chain);
  if (!lifetime.pass) return { pass: false, failedLayer: 'chain_lifetime', reason: lifetime.reason };

  // Direct ping-pong (zero tolerance, check early — coordinators and reject intents are exempt)
  const pingPong = checkDirectPingPong(chainRepo, chain.id, req.fromAgentId, req.toAgentId, options, req.intent);
  if (!pingPong.pass) return { pass: false, failedLayer: 'ping_pong', reason: pingPong.reason };

  // Layer 2: Chain-scoped agent dedup (coordinators and reject intents are exempt)
  const agentDedup = checkChainAgentDedup(chainRepo, chain.id, req.toAgentId, options, req.intent);
  if (!agentDedup.pass) return { pass: false, failedLayer: 'agent_dedup', reason: agentDedup.reason };

  // Layer 3: Ripple detection
  const ripple = checkRippleDetection(chain.id, req.toAgentId, req.fromAgentId);
  if (!ripple.pass) return { pass: false, failedLayer: 'ripple', reason: ripple.reason };

  // Layer 4: Rate limit
  const rate = checkRateLimit(req.toAgentId);
  if (!rate.pass) return { pass: false, failedLayer: 'rate_limit', reason: rate.reason };

  // Layer 4b: Chain budget
  const budget = checkChainBudget(chainRepo, chain.id);
  if (!budget.pass) return { pass: false, failedLayer: 'chain_budget', reason: budget.reason };

  // Layer 1: Content hash dedup is enforced at DB insert level (UNIQUE constraint)
  // If we get here, all layers pass
  return { pass: true };
}
