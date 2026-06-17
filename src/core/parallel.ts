/**
 * parallel() — run thunks concurrently with a BARRIER (awaits all).
 *
 * Use when you genuinely need every result together (dedup, vote-count,
 * zero-result early-exit). A thunk that throws resolves to `null` — the call
 * itself never rejects, so callers `.filter(Boolean)` before using results.
 *
 * parallel() does NOT gate concurrency itself. The concurrency cap lives in
 * agent() (each agent acquires a pool slot), matching Claude's model where
 * "concurrent agent() calls are capped". Gating here too would deadlock: a
 * thunk holding a slot while awaiting agent()'s slot is a nested-semaphore hang.
 */

export function makeParallel() {
  return async function parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>> {
    return Promise.all(
      thunks.map((thunk) =>
        Promise.resolve()
          .then(thunk)
          .catch(() => null as T | null),
      ),
    );
  };
}
