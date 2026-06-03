import { describe, expect, test } from "vitest";
import { raceWithCeiling, type RaceTask } from "../src/engine-race";

/**
 * The engine race is what makes a 60s ceiling safe: it must return the instant
 * the first GOOD answer lands (so the common path stays ~remote-latency fast),
 * keep waiting when only an unacceptable answer (the weak local fallback) has
 * settled, and never stall past the ceiling when every engine hangs. These are
 * the exact properties the grandmaster move path depends on.
 */

type Res = { engine: string; ok: boolean; move?: string };

/** A task that settles to `value` after `delayMs`, tracking whether it was
 *  aborted so tests can assert losers are freed. */
function timed(value: Res, delayMs: number) {
  const state = { aborted: false };
  const task: RaceTask<Res> = {
    promise: new Promise<Res>((res) => setTimeout(() => res(value), delayMs)),
    abort: () => { state.aborted = true; },
  };
  return { task, state };
}

/** A task that never settles — stands in for a hung upstream fetch. */
function hanging(engine: string) {
  const state = { aborted: false };
  const task: RaceTask<Res> = {
    promise: new Promise<Res>(() => {}),
    abort: () => { state.aborted = true; },
  };
  return { task, state, engine };
}

const ok = (engine: string, move = "e2e4"): Res => ({ engine, ok: true, move });

describe("raceWithCeiling", () => {
  test("resolves on the first accepted result and aborts the slow loser", async () => {
    const fast = timed(ok("stockfish.online"), 5);
    const slow = hanging("chess-api.com");
    const out = await raceWithCeiling(
      [fast.task, slow.task],
      1_000,
      (r) => r.ok,
    );
    expect(out.map((r) => r.engine)).toEqual(["stockfish.online"]);
    expect(slow.state.aborted).toBe(true); // loser freed, not left hanging
  });

  test("an unaccepted early result does NOT end the race — a later accepted one does", async () => {
    // The local engine settles first but is excluded by the predicate; the
    // race must wait for the real remote rather than returning the weak move.
    const local = timed(ok("js-chess-engine (local DO)", "a2a3"), 2);
    const remote = timed(ok("stockfish.online"), 25);
    const out = await raceWithCeiling(
      [local.task, remote.task],
      1_000,
      (r) => r.engine !== "js-chess-engine (local DO)",
    );
    expect(out.map((r) => r.engine).sort()).toEqual([
      "js-chess-engine (local DO)",
      "stockfish.online",
    ]);
  });

  test("resolves on all-settled even when nothing is accepted (no ceiling wait)", async () => {
    const a = timed({ engine: "a", ok: false }, 3);
    const b = timed({ engine: "b", ok: false }, 8);
    const start = Date.now();
    const out = await raceWithCeiling([a.task, b.task], 5_000, (r) => r.ok);
    expect(out).toHaveLength(2);
    expect(Date.now() - start).toBeLessThan(1_000); // didn't wait the 5s ceiling
  });

  test("returns whatever settled by the ceiling and aborts the rest", async () => {
    const hung = hanging("stockfish.online");
    const out = await raceWithCeiling([hung.task], 20, (r) => r.ok);
    expect(out).toEqual([]); // nothing settled before the 20ms ceiling
    expect(hung.state.aborted).toBe(true);
  });

  test("empty task list resolves immediately to []", async () => {
    expect(await raceWithCeiling<Res>([], 50)).toEqual([]);
  });

  test("preserves completion order of settled results", async () => {
    const second = timed(ok("chess-api.com"), 30);
    const first = timed(ok("lichess-cloud-eval"), 10);
    // No predicate → waits for all-settled, recording in completion order.
    const out = await raceWithCeiling([second.task, first.task], 1_000);
    expect(out.map((r) => r.engine)).toEqual([
      "lichess-cloud-eval",
      "chess-api.com",
    ]);
  });

  test("a rejecting task still lets the race complete on all-settled", async () => {
    const reject: RaceTask<Res> = {
      promise: Promise.reject(new Error("boom")),
      abort: () => {},
    };
    const good = timed(ok("stockfish.online"), 5);
    const out = await raceWithCeiling([reject, good.task], 1_000, (r) => r.ok);
    // The rejection is absent from results but the accepted move still wins.
    expect(out.map((r) => r.engine)).toEqual(["stockfish.online"]);
  });
});
