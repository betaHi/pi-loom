/**
 * pipeline() — each item flows through ALL stages independently, with NO barrier
 * between stages. Item A can be in stage 3 while item B is still in stage 1.
 *
 * This is the default for multi-stage work: wall-clock = the slowest single-item
 * chain, NOT the sum of each stage's slowest item. Contrast with parallel(),
 * which is a barrier.
 *
 * Each stage callback receives (prevResult, originalItem, index). A stage that
 * throws drops that item to `null` and skips its remaining stages — matching
 * Claude semantics (callers `.filter(Boolean)`).
 *
 * Concurrency across all in-flight stage work is bounded by the shared AgentPool:
 * each stage invocation that calls agent() acquires a slot, so the pool naturally
 * limits total concurrent model calls even though items advance independently.
 *
 * Note: the pool gating happens inside agent() (which stages call), not here —
 * pipeline only owns the per-item independent async chains.
 */

import type { Stage } from "../types.ts";

export function makePipeline() {
  return async function pipeline(
    items: unknown[],
    ...stages: Array<Stage<any, any>>
  ): Promise<Array<unknown | null>> {
    // Each item gets its OWN async chain. There is no `await` that synchronizes
    // across items between stages — that's what makes it barrier-free.
    return Promise.all(
      items.map(async (item, index) => {
        let acc: unknown = item;
        for (const stage of stages) {
          try {
            acc = await stage(acc, item, index);
          } catch {
            return null; // item drops out; remaining stages skipped
          }
        }
        return acc;
      }),
    );
  };
}
