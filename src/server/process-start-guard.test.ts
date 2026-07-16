import { describe, expect, it } from 'vitest';
import { ProcessStartGuard } from './process-start-guard';

describe('ProcessStartGuard', () => {
  it('admits only one concurrent asynchronous start for a key', () => {
    const guard = new ProcessStartGuard();
    expect(guard.claim('mario@conv-1', false)).toBe(true);
    expect(guard.claim('mario@conv-1', false)).toBe(false);
    guard.markStarted('mario@conv-1');
    expect(guard.claim('mario@conv-1', true)).toBe(false);
  });

  it('releases a failed setup and permits an explicit forced replacement', () => {
    const guard = new ProcessStartGuard();
    expect(guard.claim('peach@conv-1', false)).toBe(true);
    guard.release('peach@conv-1');
    expect(guard.claim('peach@conv-1', false)).toBe(true);
    expect(guard.claim('peach@conv-1', true, true)).toBe(true);
  });
});
