/** Serializes asynchronous daemon setup for one conversation/agent pair. */
export class ProcessStartGuard {
  private readonly starting = new Set<string>();

  claim(key: string, active: boolean, force = false): boolean {
    // Force may replace an already-running process, but it must never bypass an
    // in-flight setup. Otherwise two forced starts can both await termination
    // and then race to install ownership for the same key.
    if (this.starting.has(key) || (!force && active)) return false;
    this.starting.add(key);
    return true;
  }

  markStarted(key: string): void {
    this.starting.delete(key);
  }

  release(key: string): void {
    this.starting.delete(key);
  }

  isStarting(key: string): boolean {
    return this.starting.has(key);
  }
}

/** Delete an asynchronously-owned entry only while it is still the current owner. */
export function deleteIfCurrent<K, V>(entries: Map<K, V>, key: K, expected: V): boolean {
  if (entries.get(key) !== expected) return false;
  return entries.delete(key);
}
