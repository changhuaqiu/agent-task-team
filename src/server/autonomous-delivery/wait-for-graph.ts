export interface WaitForEdge {
  waiter: string;
  blocker: string;
  reasonCode: string;
}

export interface WaitForDeadlock {
  cycle: string[];
  edges: WaitForEdge[];
}

/**
 * Returns the lexicographically stable first cycle. The graph is a fact
 * projection only; recovery policy remains a Process Manager decision.
 */
export function detectWaitForDeadlock(edges: readonly WaitForEdge[]): WaitForDeadlock | undefined {
  const adjacency = new Map<string, WaitForEdge[]>();
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.waiter) ?? [];
    outgoing.push(edge);
    adjacency.set(edge.waiter, outgoing);
  }
  for (const outgoing of adjacency.values()) {
    outgoing.sort((left, right) => left.blocker.localeCompare(right.blocker)
      || left.reasonCode.localeCompare(right.reasonCode));
  }
  const visited = new Set<string>();
  const active = new Map<string, number>();
  const pathNodes: string[] = [];
  const pathEdges: WaitForEdge[] = [];

  const visit = (node: string): WaitForDeadlock | undefined => {
    const cycleStart = active.get(node);
    if (cycleStart !== undefined) {
      return {
        cycle: [...pathNodes.slice(cycleStart), node],
        edges: pathEdges.slice(cycleStart),
      };
    }
    if (visited.has(node)) return undefined;
    active.set(node, pathNodes.length);
    pathNodes.push(node);
    for (const edge of adjacency.get(node) ?? []) {
      pathEdges.push(edge);
      const deadlock = visit(edge.blocker);
      if (deadlock) return deadlock;
      pathEdges.pop();
    }
    pathNodes.pop();
    active.delete(node);
    visited.add(node);
    return undefined;
  };

  const nodes = [...new Set(edges.flatMap((edge) => [edge.waiter, edge.blocker]))].sort();
  for (const node of nodes) {
    const deadlock = visit(node);
    if (deadlock) return deadlock;
  }
  return undefined;
}
