/** Serializes asynchronous daemon setup for one conversation/agent pair. */
export class ProcessStartGuard {
  private readonly starting = new Set<string>();

  claim(key: string, active: boolean, force = false): boolean {
    if (!force && (active || this.starting.has(key))) return false;
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
