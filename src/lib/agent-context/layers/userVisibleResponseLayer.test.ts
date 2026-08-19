import { describe, expect, it } from 'vitest';
import { buildUserVisibleResponseLayer } from './userVisibleResponseLayer';

describe('buildUserVisibleResponseLayer', () => {
  it('defines one plain-language contract for every role', () => {
    const result = buildUserVisibleResponseLayer();

    expect(result).toContain('所有角色必须遵守');
    expect(result).toContain('角色性格只影响语气');
    expect(result).toContain('第一行直接说结果');
    expect(result).toContain('普通回复控制在 1–5 句');
    expect(result).toContain('最多补 3 项');
    expect(result).toContain('只问一个真正阻止继续的问题');
    expect(result).toContain('用户追问技术细节时再展开');
  });

  it('keeps platform language and tool narration out of user-visible prose', () => {
    const result = buildUserVisibleResponseLayer();

    expect(result).toContain('WorkContract');
    expect(result).toContain('outcome');
    expect(result).toContain('fencing');
    expect(result).toContain('不在正文罗列');
    expect(result).toContain('工具记录和调试详情');
    expect(result).toContain('任务已收口');
    expect(result).toContain('平台已接纳');
  });
});
