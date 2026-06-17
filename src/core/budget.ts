/**
 * Token budget — accumulates output tokens across all agents and enforces a
 * hard ceiling. Mirrors Claude's `budget`: total / spent() / remaining(),
 * and agent() throws once spent reaches total.
 */

import type { Budget } from "../types.ts";

export class BudgetTracker implements Budget {
  readonly total: number | null;
  private outputTokens = 0;

  constructor(total: number | null = null) {
    this.total = total;
  }

  spent(): number {
    return this.outputTokens;
  }

  remaining(): number {
    return this.total === null ? Number.POSITIVE_INFINITY : Math.max(0, this.total - this.outputTokens);
  }

  /** Add output tokens from a completed agent call. */
  add(outputTokens: number): void {
    this.outputTokens += outputTokens;
  }

  /**
   * Throws if the budget is already exhausted. Called by agent() BEFORE
   * spending — once spent >= total, further agents are refused (hard ceiling).
   */
  check(): void {
    if (this.total !== null && this.outputTokens >= this.total) {
      throw new Error(
        `Token budget exhausted: spent ${this.outputTokens} output tokens of ${this.total}.`,
      );
    }
  }

  /** Read-only view to hand to the script (no add/check exposed). */
  view(): Budget {
    return {
      total: this.total,
      spent: () => this.spent(),
      remaining: () => this.remaining(),
    };
  }
}
