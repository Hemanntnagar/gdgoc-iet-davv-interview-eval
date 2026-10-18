/** Simple in-memory sliding-window failure tracker (per server instance). */
export class AttemptTracker {
  private map = new Map<string, { count: number; resetAt: number }>();

  /** Returns true when the key is currently allowed. */
  allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
    const entry = this.map.get(key);
    if (!entry || entry.resetAt <= now) {
      this.map.set(key, { count: 0, resetAt: now + windowMs });
      return true;
    }
    return entry.count < max;
  }

  fail(key: string, windowMs: number, now = Date.now()): void {
    const entry = this.map.get(key);
    if (!entry || entry.resetAt <= now) {
      this.map.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    entry.count += 1;
  }

  reset(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
