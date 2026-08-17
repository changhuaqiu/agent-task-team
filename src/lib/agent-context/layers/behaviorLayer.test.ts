import { describe, expect, it } from 'vitest';
import { buildBehaviorLayer } from './behaviorLayer';

describe('buildBehaviorLayer', () => {
  it('focuses natural-language output while leaving tools visible as traces', () => {
    const result = buildBehaviorLayer();

    expect(result).toContain('可核验结果或明确阻塞');
    expect(result).toContain('需要用户确认');
    expect(result).toContain('Trace 卡片');
    expect(result).toContain('新决策、新证据、明确阻塞或最终结果');
    expect(result).toContain('不以身份介绍、计划预告');
    expect(result).not.toContain('@agent');
  });
});
