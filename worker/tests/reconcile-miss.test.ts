import { describe, expect, test } from "vitest";
import { decideReconcileMiss } from "../src/bot-status";

/**
 * Reconcile-miss GC decides what to do when a tracked table vanishes from
 * both `myTables` and a direct `getTableInfo` lookup. The rule that matters:
 * realtime games get GC'd after RECONCILE_MISS_LIMIT consecutive misses (a
 * dead realtime slot blocks every createTable), but async/turn-based games
 * FAIL OPEN — they're never abandoned on a flake, because doing so makes the
 * bot stop moving and lose the game on the clock. This is the regression that
 * cost table 856600921 a bogus 3-move "loss".
 *
 * These tests replay the miss-count sequence a memo actually walks through
 * during a tick loop, so they exercise the same decisions production hits.
 */
const LIMIT = 3; // mirrors RECONCILE_MISS_LIMIT in bot-do.ts

/** Walk a memo through `n` consecutive misses and collect each decision,
 *  exactly as tick() does: increment first, then decide. */
function walkMisses(realtime: boolean | undefined, n: number) {
  const decisions = [];
  for (let count = 1; count <= n; count++) {
    decisions.push(decideReconcileMiss(count, realtime, LIMIT));
  }
  return decisions;
}

describe("decideReconcileMiss — below threshold", () => {
  test("a single transient flake never GCs and never logs", () => {
    for (const realtime of [true, false, undefined] as const) {
      const d = decideReconcileMiss(1, realtime, LIMIT);
      expect(d).toEqual({
        markFinished: false, log: false, reason: "below-threshold",
      });
    }
  });

  test("misses below the limit wait regardless of gamemode", () => {
    for (const realtime of [true, false, undefined] as const) {
      for (let count = 1; count < LIMIT; count++) {
        const d = decideReconcileMiss(count, realtime, LIMIT);
        expect(d.markFinished).toBe(false);
        expect(d.reason).toBe("below-threshold");
      }
    }
  });
});

describe("decideReconcileMiss — realtime GC", () => {
  test("a vanished realtime game is GC'd once it hits the limit", () => {
    const d = decideReconcileMiss(LIMIT, true, LIMIT);
    expect(d).toEqual({
      markFinished: true, log: true, reason: "gc-realtime",
    });
  });

  test("unknown gamemode (undefined) is treated as realtime — only a positive async signal earns fail-open", () => {
    const d = decideReconcileMiss(LIMIT, undefined, LIMIT);
    expect(d.markFinished).toBe(true);
    expect(d.reason).toBe("gc-realtime");
  });

  test("realtime rage-quit lifecycle: waits 2 ticks, GCs on the 3rd", () => {
    const seq = walkMisses(true, LIMIT);
    expect(seq.map((d) => d.markFinished)).toEqual([false, false, true]);
    expect(seq.map((d) => d.reason)).toEqual([
      "below-threshold", "below-threshold", "gc-realtime",
    ]);
  });
});

describe("decideReconcileMiss — async fails open", () => {
  test("a flaking async game is never marked finished, even past the limit", () => {
    for (const count of [LIMIT, LIMIT + 1, LIMIT + 50, 1000]) {
      const d = decideReconcileMiss(count, false, LIMIT);
      expect(d.markFinished).toBe(false);
      expect(d.reason).toBe("fail-open-async");
    }
  });

  test("the 856600921 lifecycle: a played async game that BGA stops returning is left LIVE, never abandoned", () => {
    // 30 ticks of getTableInfo returning null (BGA flake / archive lag).
    const seq = walkMisses(false, 30);
    // Not one of them forfeits the game.
    expect(seq.every((d) => !d.markFinished)).toBe(true);
  });

  test("async logs exactly once (at the threshold), never per-tick spam", () => {
    const seq = walkMisses(false, 30);
    const logged = seq.filter((d) => d.log);
    expect(logged.length).toBe(1);
    // And it's the threshold tick that logs, not later ones.
    expect(seq[LIMIT - 1].log).toBe(true);
    expect(seq[LIMIT].log).toBe(false);
  });
});

describe("decideReconcileMiss — recovery", () => {
  test("after a successful lookup resets the count to 0, the next miss starts over below threshold", () => {
    // Simulate: 2 misses, BGA recovers (count reset to 0 by tick()), then
    // a fresh miss. The fresh miss must NOT immediately GC.
    decideReconcileMiss(2, true, LIMIT); // pre-recovery, still waiting
    const afterRecovery = decideReconcileMiss(1, true, LIMIT);
    expect(afterRecovery.markFinished).toBe(false);
    expect(afterRecovery.reason).toBe("below-threshold");
  });
});
