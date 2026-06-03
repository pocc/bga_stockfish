/**
 * Pure, dependency-free runner for the parallel engine race.
 *
 * Extracted from stockfish-do.ts so vitest can exercise the short-circuit
 * timing logic without importing `cloudflare:workers`. Generic over the result
 * type `T`: the Durable Object passes `EngineTaskResult` and an `acceptEarly`
 * predicate; this module knows nothing about engines, only "settle, accept,
 * abort".
 */

export interface RaceTask<T> {
  /** Settles to a result the caller classifies. Expected never to reject
   *  (the DO's makeTask catches internally); a rejection is treated as a
   *  settled-but-unusable task so the race can still complete. */
  promise: Promise<T>;
  /** Free the underlying work (abort the in-flight fetch / cancel the signal).
   *  Must be safe to call on an already-settled task (a no-op there). */
  abort: () => void;
}

/**
 * Run every task in parallel and resolve at the FIRST of:
 *   1. a task settles for which `acceptEarly(result)` is true — the winner,
 *   2. every task has settled,
 *   3. `ceilingMs` elapses.
 *
 * On resolution, abort any still-in-flight tasks (a no-op for settled ones) so
 * losing upstream fetches are freed, and return the results that had settled by
 * then, in completion order.
 *
 * `acceptEarly` is what makes a long ceiling safe: the race ends the instant a
 * *good* answer lands (e.g. the first legal move from a real remote engine)
 * instead of waiting the full window, while a result that is NOT accept-worthy
 * (a weak local fallback, an illegal move) keeps the race open so a stronger
 * engine still has until the ceiling to answer. With no predicate the race
 * waits for all-settled or the ceiling, matching the original behaviour.
 */
export async function raceWithCeiling<T>(
  tasks: RaceTask<T>[],
  ceilingMs: number,
  acceptEarly?: (r: T) => boolean,
): Promise<T[]> {
  const completed: T[] = [];
  const settled = new Promise<void>((resolve) => {
    if (tasks.length === 0) {
      resolve();
      return;
    }
    let remaining = tasks.length;
    for (const t of tasks) {
      t.promise.then(
        (r) => {
          completed.push(r);
          remaining -= 1;
          if (remaining === 0 || (acceptEarly?.(r) ?? false)) resolve();
        },
        () => {
          // Defensive: a task that rejects still counts as settled so the
          // race can complete on all-settled. Its result is simply absent.
          remaining -= 1;
          if (remaining === 0) resolve();
        },
      );
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ceilingMs);
  });

  try {
    await Promise.race([settled, ceiling]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  // Free anything still running (early win or ceiling); harmless for settled.
  for (const t of tasks) t.abort();
  // Snapshot now: late .then callbacks from aborted tasks may still push, but
  // the caller only sees what had settled at resolution time.
  return completed.slice();
}
