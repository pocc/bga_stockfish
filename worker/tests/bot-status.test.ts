import { describe, expect, test } from "vitest";
import {
  isJoinableStatus,
  isLivePlayStatus,
  isFinishedStatus,
  gamemodeOf,
  GAMEMODES,
} from "../src/bot-status";

/**
 * Regression coverage for the three status-enum classes the BotDriver
 * dispatches on. Every BGA chess status we've ever observed in production
 * is enumerated below; the truth table here would have caught:
 *
 *   - "asyncplay was silently ignored"     (isLivePlayStatus drift)
 *   - "asyncfinished never said GG"        (isFinishedStatus drift)
 *   - "asyncopen treated as realtime"      (gamemodeOf drift)
 *
 * If BGA introduces a new status, add it to the table — the asserts will
 * tell you which bucket(s) are now wrong.
 */
const ALL_STATUSES = [
  // status,       joinable, live,  finished, gamemode
  ["open",         true,     false, false,    "realtime"],
  ["asyncopen",    true,     false, false,    "async"],
  ["init",         true,     false, false,    null],
  ["setup",        true,     false, false,    null],
  ["play",         false,    true,  false,    null],
  ["asyncplay",    false,    true,  false,    null],
  ["finished",     false,    false, true,     null],
  ["asyncfinished",false,    false, true,     null],
] as const;

describe("status helpers", () => {
  test.each(ALL_STATUSES)(
    "%s → joinable=%s live=%s finished=%s gamemode=%s",
    (status, joinable, live, finished, gamemode) => {
      expect(isJoinableStatus(status)).toBe(joinable);
      expect(isLivePlayStatus(status)).toBe(live);
      expect(isFinishedStatus(status)).toBe(finished);
      expect(gamemodeOf(status)).toBe(gamemode);
    },
  );

  test("unknown status falls into no bucket", () => {
    const fake = "totally_made_up_status";
    expect(isJoinableStatus(fake)).toBe(false);
    expect(isLivePlayStatus(fake)).toBe(false);
    expect(isFinishedStatus(fake)).toBe(false);
    expect(gamemodeOf(fake)).toBeNull();
  });

  test("status buckets are mutually exclusive", () => {
    for (const [status] of ALL_STATUSES) {
      const hits = [
        isJoinableStatus(status),
        isLivePlayStatus(status),
        isFinishedStatus(status),
      ].filter(Boolean).length;
      expect(hits, `status="${status}" landed in ${hits} buckets`).toBe(1);
    }
  });

  test("GAMEMODES covers exactly realtime + async", () => {
    expect([...GAMEMODES].sort()).toEqual(["async", "realtime"]);
  });
});
