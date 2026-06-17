/**
 * Concurrency pool — a hand-rolled semaphore shared across parallel(), pipeline(),
 * and nested agent() calls within a single workflow run.
 *
 * Two limits, mirroring Claude's runtime:
 *   - `concurrency` (default 16): max agents running at once.
 *   - `maxTotal` (default 1000): max agents over the whole run (runaway backstop).
 *
 * Zero third-party deps — a queue of resolvers gated by available slots.
 */

export class AgentPool {
  private readonly concurrency: number;
  private readonly maxTotal: number;
  private active = 0;
  private started = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(concurrency = 16, maxTotal = 1000) {
    if (concurrency < 1) throw new Error("concurrency must be >= 1");
    this.concurrency = concurrency;
    this.maxTotal = maxTotal;
  }

  /** Number of agents currently holding a slot (for tests/inspection). */
  get activeCount(): number {
    return this.active;
  }

  /** Total agents started over the run's lifetime. */
  get startedCount(): number {
    return this.started;
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  /**
   * Run `fn` once a slot is free, releasing the slot when it settles.
   *
   * The maxTotal cap is a RESERVATION made synchronously here, before any
   * queuing: the Nth call to run() (N > maxTotal) rejects immediately, so a
   * script that schedules 2000 thunks fails fast on the ones over the cap
   * rather than after 1000 have drained.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.started >= this.maxTotal) {
      throw new Error(
        `Agent cap reached: ${this.maxTotal} agents started in this run (runaway backstop).`,
      );
    }
    this.started++;
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
