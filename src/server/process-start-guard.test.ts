import { describe, expect, it } from 'vitest';
import { deleteIfCurrent, ProcessStartGuard } from './process-start-guard';

describe('ProcessStartGuard', () => {
  it('admits only one concurrent asynchronous start for a key', () => {
    const guard = new ProcessStartGuard();
    expect(guard.claim('mario@conv-1', false)).toBe(true);
    expect(guard.claim('mario@conv-1', false)).toBe(false);
    guard.markStarted('mario@conv-1');
    expect(guard.claim('mario@conv-1', true)).toBe(false);
  });

  it('releases a failed setup and permits an explicit forced replacement of an active process', () => {
    const guard = new ProcessStartGuard();
    expect(guard.claim('peach@conv-1', false)).toBe(true);
    guard.release('peach@conv-1');
    expect(guard.claim('peach@conv-1', true, true)).toBe(true);
  });

  it('does not let force bypass another in-flight setup', () => {
    const guard = new ProcessStartGuard();
    expect(guard.claim('peach@conv-1', true, true)).toBe(true);
    expect(guard.claim('peach@conv-1', true, true)).toBe(false);
  });
});

describe('deleteIfCurrent', () => {
  it('does not let an old asynchronous owner delete its replacement', () => {
    const oldOwner = { id: 'old' };
    const replacement = { id: 'replacement' };
    const entries = new Map([['agent@project', replacement]]);

    expect(deleteIfCurrent(entries, 'agent@project', oldOwner)).toBe(false);
    expect(entries.get('agent@project')).toBe(replacement);
    expect(deleteIfCurrent(entries, 'agent@project', replacement)).toBe(true);
    expect(entries.has('agent@project')).toBe(false);
  });
});
