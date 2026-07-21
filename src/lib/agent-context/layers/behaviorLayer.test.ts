import { describe, expect, it } from 'vitest';
import { buildBehaviorLayer } from './behaviorLayer';

describe('buildBehaviorLayer', () => {
  it('keeps close-the-loop guidance without duplicating A2A selection', () => {
    const result = buildBehaviorLayer();

    expect(result).toContain('可核验结果或明确阻塞');
    expect(result).toContain('需要用户确认');
    expect(result).not.toContain('@agent');
  });
});
