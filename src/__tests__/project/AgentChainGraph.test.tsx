// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentChainGraph } from '@/components/project/AgentChainGraph';

vi.mock('@xyflow/react', () => ({
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Background: () => null,
  Controls: () => null,
  ReactFlow: ({ nodes, onNodeClick }: any) => <div>{nodes.map((node: any) => <button key={node.id} onClick={() => onNodeClick({}, node)}>{node.data.label}</button>)}</div>,
}));

afterEach(() => cleanup());

describe('AgentChainGraph', () => {
  it('lays out explicit chain nodes and opens the selected trace', () => {
    const onSelectTrace = vi.fn();
    render(<AgentChainGraph chains={[{
      chainId: 'chain-1', taskIds: ['TASK-1'],
      nodes: [{ id: 'n1', agentId: 'planner', traceId: 'trace-1', taskId: 'TASK-1' }, { id: 'n2', agentId: 'reviewer', traceId: 'trace-2' }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', reason: 'review' }],
    }]} onSelectTrace={onSelectTrace} />);
    fireEvent.click(screen.getByText('reviewer'));
    expect(onSelectTrace).toHaveBeenCalledWith('trace-2');
  });
});
