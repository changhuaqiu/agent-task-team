// Invocation Pipeline valid-exit tests.
import { describe, expect, it } from 'vitest';
import { checkValidExit } from './valid-exit';

describe('checkValidExit', () => {
  it('rejects empty and acknowledgement-only output', () => {
    expect(checkValidExit('iterate', '')).toMatchObject({ valid: false, reason: 'empty' });
    expect(checkValidExit('handoff', '收到。')).toMatchObject({ valid: false, reason: 'placeholder' });
  });

  it('requires closure report markers', () => {
    expect(checkValidExit('closure', '任务都做完了')).toMatchObject({ valid: false });
    expect(checkValidExit('closure', 'GOAL: x\nDELIVERED: y\nNOT DONE: 无')).toMatchObject({ valid: true });
  });

  it('recognizes actionable handoff and wakeup outcomes', () => {
    expect(checkValidExit('handoff', '已接受任务并开始推进实现。')).toMatchObject({ valid: true });
    expect(checkValidExit('wakeup', '当前阻塞，原因是等待测试环境。')).toMatchObject({ valid: true });
  });
});
