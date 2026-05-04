// src/server/a2a/router.ts
import type { A2ADecision } from './types';

const MAX_CHAIN_DEPTH = 10;
const PING_PONG_THRESHOLD = 4;

// Key: "agentA:agentB" (sorted), Value: consecutive non-substantive count
const pingPongCounts = new Map<string, number>();

function ppKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function recordPingPong(from: string, to: string, hasSubstantiveWork: boolean): void {
  const key = ppKey(from, to);
  if (hasSubstantiveWork) {
    pingPongCounts.delete(key);
  } else {
    pingPongCounts.set(key, (pingPongCounts.get(key) ?? 0) + 1);
  }
}

export function resetPingPong(a: string, b: string): void {
  pingPongCounts.delete(ppKey(a, b));
}

export function getPingPongCount(a: string, b: string): number {
  return pingPongCounts.get(ppKey(a, b)) ?? 0;
}

export function shouldDeliver(opts: {
  fromAgentId: string;
  toAgentId: string;
  chainDepth: number;
}): A2ADecision {
  if (opts.chainDepth > MAX_CHAIN_DEPTH) {
    return { deliver: false, reason: `chain depth ${opts.chainDepth} exceeds limit ${MAX_CHAIN_DEPTH}` };
  }

  const count = getPingPongCount(opts.fromAgentId, opts.toAgentId);
  if (count >= PING_PONG_THRESHOLD) {
    return { deliver: false, reason: `ping-pong streak ${count} between ${opts.fromAgentId} and ${opts.toAgentId}` };
  }

  return { deliver: true };
}
