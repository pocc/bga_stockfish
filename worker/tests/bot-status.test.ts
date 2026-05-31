import { describe, expect, test } from "vitest";
import {
  isJoinableStatus,
  isLivePlayStatus,
  isFinishedStatus,
  gamemodeOf,
  inviteSlotModeOf,
  GAMEMODES,
  isBenignCreateTableError,
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

/**
 * Regression: a bot-owned table briefly reports `setup`/`init` after
 * createTable, before BGA promotes it to `open`. The invite-slot adoption
 * pass used to call gamemodeOf() (returns null for setup/init) and skip the
 * table; if the slot was also null at that moment (DO restart, or the
 * oppSeated transient-clear path that's since been removed), the table sat
 * orphaned in BGA's records and every subsequent createTable failed with
 * "you are already at a real-time table about to start". inviteSlotModeOf
 * pins setup/init to realtime so the slot reclaims the orphan and the
 * 15-minute setup-timeout path can reap it.
 */
describe("inviteSlotModeOf", () => {
  test("open / asyncopen match gamemodeOf", () => {
    expect(inviteSlotModeOf("open")).toBe("realtime");
    expect(inviteSlotModeOf("asyncopen")).toBe("async");
  });

  test("setup and init are treated as realtime (not null)", () => {
    expect(inviteSlotModeOf("setup")).toBe("realtime");
    expect(inviteSlotModeOf("init")).toBe("realtime");
    expect(gamemodeOf("setup")).toBeNull();
    expect(gamemodeOf("init")).toBeNull();
  });

  test("non-joinable statuses still resolve to null", () => {
    expect(inviteSlotModeOf("play")).toBeNull();
    expect(inviteSlotModeOf("asyncplay")).toBeNull();
    expect(inviteSlotModeOf("finished")).toBeNull();
    expect(inviteSlotModeOf("asyncfinished")).toBeNull();
    expect(inviteSlotModeOf("totally_made_up")).toBeNull();
  });
});

describe("isBenignCreateTableError", () => {
  test("the 'about to start' feException is benign", () => {
    const msg =
      'createTable failed gamemode=realtime: {"status":"0","exception":' +
      '"feException","error":"You are already at a real-time table about ' +
      'to start! <a href=\\"/table?table=859987695\\">See this game</a>",' +
      '"expected":1,"code":100}';
    expect(isBenignCreateTableError(msg)).toBe(true);
  });

  test("a 'game in progress at another table' refusal is benign", () => {
    const msg =
      'createTable failed gamemode=realtime: {"status":"0","error":' +
      '"You have a game in progress at another table","code":100}';
    expect(isBenignCreateTableError(msg)).toBe(true);
  });

  test("an mmstarted envelope (no table issued) is benign", () => {
    const msg =
      'createTable failed gamemode=async: {"status":1,"data":' +
      '{"mmstarted":true,"mode":"realtime"}}';
    expect(isBenignCreateTableError(msg)).toBe(true);
  });

  test("an HTML error page is NOT benign (stays logged)", () => {
    const msg =
      "createTable non-json: <html>\n    <head>\n        <style " +
      'type="text/css">\n            html { min-height: 100%; }';
    expect(isBenignCreateTableError(msg)).toBe(false);
  });

  test("a generic/unknown failure is NOT benign", () => {
    expect(isBenignCreateTableError("Error: fetch failed")).toBe(false);
    expect(isBenignCreateTableError("createTable failed gamemode=realtime: " +
      '{"status":"0","error":"Game not available"}')).toBe(false);
  });
});
