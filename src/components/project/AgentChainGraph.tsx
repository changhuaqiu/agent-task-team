'use client';

import { useMemo } from 'react';
import dagre from '@dagrejs/dagre';
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';

export interface ObservationChain {
  chainId: string;
  status?: string;
  taskIds: string[];
  nodes: Array<{ id: string; agentId: string; traceId?: string; invocationId?: string; taskId?: string; status?: string }>;
  edges: Array<{ id: string; source: string; target: string; status?: string; reason?: string; eventType?: string }>;
}

const NODE_WIDTH = 164;
const NODE_HEIGHT = 58;

export function AgentChainGraph({ chains, onSelectTrace }: {
  chains: ObservationChain[];
  onSelectTrace?: (traceId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: 'LR', ranksep: 54, nodesep: 28, marginx: 18, marginy: 18 });
    const chainNodes = new Map<string, ObservationChain['nodes'][number]>();
    for (const chain of chains) {
      for (const node of chain.nodes) {
        chainNodes.set(node.id, node);
        graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
      }
      for (const edge of chain.edges) graph.setEdge(edge.source, edge.target);
    }
    dagre.layout(graph);
    const nodes: Node[] = Array.from(chainNodes.values()).map(node => {
      const point = graph.node(node.id);
      return {
        id: node.id,
        position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
        data: { label: `${node.agentId}${node.taskId ? ` · ${node.taskId}` : ''}`, traceId: node.traceId },
        style: {
          width: NODE_WIDTH,
          minHeight: NODE_HEIGHT,
          borderRadius: 8,
          border: node.status === 'error' ? '1px solid #f43f5e' : '1px solid hsl(var(--border))',
          background: 'hsl(var(--bg-card))',
          color: 'hsl(var(--text-primary))',
          fontSize: 10,
          fontWeight: 600,
        },
      };
    });
    const edges: Edge[] = chains.flatMap(chain => chain.edges.map(edge => ({
      id: `${chain.chainId}:${edge.id}`,
      source: edge.source,
      target: edge.target,
      label: edge.reason || edge.eventType || edge.status || 'handoff',
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: edge.status === 'active' || edge.status === 'executing' || edge.status === 'started',
      style: { stroke: edge.status === 'blocked' || edge.status === 'timeout' ? '#f43f5e' : '#f59e0b' },
      labelStyle: { fontSize: 8, fill: 'hsl(var(--text-secondary))' },
    })));
    return { nodes, edges };
  }, [chains]);

  if (!nodes.length) return <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-5 text-center text-[10px] text-[hsl(var(--text-tertiary))]">暂无显式 Agent 交接链</div>;

  return <div className="h-[280px] overflow-hidden rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))]" data-testid="agent-chain-graph">
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_, node) => {
        const traceId = node.data.traceId;
        if (typeof traceId === 'string') onSelectTrace?.(traceId);
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>;
}
