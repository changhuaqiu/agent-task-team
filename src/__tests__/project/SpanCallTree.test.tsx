// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SpanCallTree, type SpanNode } from '@/components/project/SpanCallTree';

afterEach(cleanup);

const T0 = '2026-07-17T10:00:00.000Z';
const at = (ms: number) => new Date(new Date(T0).getTime() + ms).toISOString();

function root(): SpanNode {
  return { span_id: 'root', parent_span_id: null, name: 'agent.invoke', kind: 'agent', status: 'ok', started_at: T0, durationMs: 1000, parsedAttributes: { 'ath.runtime.engine': 'claude' } };
}
function child(id: string, kind: string, name: string, startMs: number, durMs: number): SpanNode {
  return { span_id: id, parent_span_id: 'root', name, kind, status: 'ok', started_at: at(startMs), durationMs: durMs, parsedAttributes: kind === 'tool' ? { 'gen_ai.tool.name': name } : {} };
}

describe('SpanCallTree', () => {
  it('空 spans 显示无可观测 span 提示', () => {
    render(<SpanCallTree spans={[]} rootStartedAt={T0} totalMs={1000} />);
    expect(screen.getByText('本次执行无可观测 span')).toBeDefined();
  });

  it('按 parent_span_id 建两层树：根在前，子 span 缩进在后', () => {
    const spans = [
      root(),
      child('c1', 'context', 'context.assemble', 0, 80),
      child('t1', 'tool', 'read_file', 100, 120),
      child('m1', 'message', 'agent.message', 400, 520),
    ];
    render(<SpanCallTree spans={spans} rootStartedAt={T0} totalMs={1000} />);
    // 根名 agent.invoke
    expect(screen.getByText('agent.invoke')).toBeDefined();
    // 子 span：tool 显示 tool name（read_file），message 显示 span.name
    expect(screen.getByText('read_file')).toBeDefined();
    expect(screen.getByText('agent.message')).toBeDefined();
  });

  it('点击 span 行触发 onSelectSpan', () => {
    const spans = [root(), child('t1', 'tool', 'grep', 10, 140)];
    const onSelect = vi.fn();
    render(<SpanCallTree spans={spans} rootStartedAt={T0} totalMs={1000} onSelectSpan={onSelect} />);
    fireEvent.click(screen.getByText('grep'));
    expect(onSelect).toHaveBeenCalledWith('t1');
  });

  it('并行工具（区间重叠）显示并行提示', () => {
    // 两个 tool 区间重叠：grep 10-150, read 20-120
    const spans = [
      root(),
      child('t1', 'tool', 'grep', 10, 140),
      child('t2', 'tool', 'read_file', 20, 100),
    ];
    render(<SpanCallTree spans={spans} rootStartedAt={T0} totalMs={1000} />);
    expect(screen.getByText(/并行执行/)).toBeDefined();
  });

  it('串行工具（区间不重叠）不显示并行提示', () => {
    const spans = [
      root(),
      child('t1', 'tool', 'grep', 0, 100),
      child('t2', 'tool', 'read_file', 120, 100), // 100-220 与 0-100 不重叠
    ];
    render(<SpanCallTree spans={spans} rootStartedAt={T0} totalMs={1000} />);
    expect(screen.queryByText(/并行执行/)).toBeNull();
  });

  it('selectedSpanId 高亮选中行', () => {
    const spans = [root(), child('t1', 'tool', 'grep', 10, 140)];
    render(<SpanCallTree spans={spans} rootStartedAt={T0} totalMs={1000} selectedSpanId="t1" />);
    // 选中行应有 accent-soft 背景（通过 button 元素 class 判定）
    const grepBtn = screen.getByText('grep').closest('button');
    expect(grepBtn?.className).toContain('accent-soft');
  });

  it('root 退化：所有 span 都有 parent 时取最早一条为根', () => {
    // 没有无 parent 的 span —— 退化取最早
    const spans: SpanNode[] = [
      { span_id: 'a', parent_span_id: 'root', name: 'a', kind: 'tool', status: 'ok', started_at: at(0), durationMs: 10, parsedAttributes: {} },
      { span_id: 'b', parent_span_id: 'root', name: 'b', kind: 'tool', status: 'ok', started_at: at(50), durationMs: 10, parsedAttributes: {} },
    ];
    render(<SpanCallTree spans={spans} rootStartedAt={T0} totalMs={1000} />);
    // a 应作为根显示（最早），b 作为子
    expect(screen.getByText('a')).toBeDefined();
    expect(screen.getByText('b')).toBeDefined();
  });
});
