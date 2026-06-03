import { describe, expect, test } from "vitest";
import {
  isJoinableStatus,
  isLivePlayStatus,
  isFinishedStatus,
  gamemodeOf,
  inviteSlotModeOf,
  GAMEMODES,
  isBenignCreateTableError,
  shouldFinalizeSeatlessTerminal,
  needsFinishScoreRefetch,
  inviteSetupAgeMs,
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

describe("shouldFinalizeSeatlessTerminal", () => {
  // The bug: a realtime abandon BGA archives server-side comes back as a lean
  // `archive` myTables row with no `players`, so meSeat is undefined and the
  // game never gets tallied / finished — it ghosts. These two production
  // ghosts (861196321 at move 0, 861700740 at mate-in-1) are the fixtures.
  const played = (status: string, finished = false) =>
    shouldFinalizeSeatlessTerminal({ status, saidHi: true, finished });

  test("finalizes a played game archived out from under us", () => {
    expect(played("archive")).toBe(true);
  });

  test("finalizes the explicit realtime/async terminal statuses too", () => {
    expect(played("finished")).toBe(true);       // realtime end
    expect(played("asyncfinished")).toBe(true);   // turn-based end
  });

  test("does nothing for a game we never actually played (saidHi=false)", () => {
    // Never greeted = never reached play; the staleUnplayed / orphan GC owns it.
    expect(shouldFinalizeSeatlessTerminal({ status: "archive", saidHi: false, finished: false })).toBe(false);
  });

  test("never re-finalizes an already-finished memo (no double tally)", () => {
    expect(played("archive", true)).toBe(false);
    expect(played("finished", true)).toBe(false);
  });

  test("ignores live / joinable statuses — those have their own handlers", () => {
    expect(played("play")).toBe(false);
    expect(played("asyncplay")).toBe(false);
    expect(played("open")).toBe(false);
    expect(played("setup")).toBe(false);
  });
});

/**
 * Regression: the live finish handler used to only re-fetch getTableInfo for
 * the friendly-draw 0/0 quirk (`score===0 && oppScore==null`). When BGA shipped
 * a seated-but-scoreless finished row (`meSeat.score` null), the guard never
 * fired, the tally fell through to "none", and a real win/loss was silently
 * dropped from W/L/D — ~40 realtime games lost this way (waler ~half of them).
 * needsFinishScoreRefetch now also fires whenever our own score is missing.
 */
describe("needsFinishScoreRefetch", () => {
  test("null own score always refetches (the dropped-game bug)", () => {
    expect(needsFinishScoreRefetch(null, null)).toBe(true);
    expect(needsFinishScoreRefetch(undefined, "1")).toBe(true);
    expect(needsFinishScoreRefetch(null, "0")).toBe(true);
  });

  test("loss (0) with missing opponent score refetches (friendly 0/0 quirk)", () => {
    expect(needsFinishScoreRefetch("0", null)).toBe(true);
    expect(needsFinishScoreRefetch("0", undefined)).toBe(true);
  });

  test("loss (0) with a present opponent score does NOT refetch", () => {
    expect(needsFinishScoreRefetch("0", "1")).toBe(false);
    expect(needsFinishScoreRefetch("0", "0")).toBe(false); // mutual-zero resolved
  });

  test("a clear win/draw own score never refetches", () => {
    expect(needsFinishScoreRefetch("1", null)).toBe(false);
    expect(needsFinishScoreRefetch("0.5", null)).toBe(false);
    expect(needsFinishScoreRefetch("1", "0")).toBe(false);
  });
});

/**
 * Regression: 17 production setupTimeout reaps with opp seated reported ages of
 * 28-59m despite a 15-min limit. slot.createdAt is reset to `now` on every
 * re-adoption, and a table flickering out of myTables restarted the clock, so
 * the realtime slot stayed blocked far past 15m. inviteSetupAgeMs anchors on
 * the earlier of slot.createdAt and the memo's stable startedAt.
 */
describe("inviteSetupAgeMs", () => {
  const now = 1_000_000_000;

  test("uses the memo's stable startedAt when the slot clock was just reset", () => {
    // slot.createdAt reset to now (age 0) but the memo has been around 20m.
    const twentyMin = 20 * 60_000;
    expect(inviteSetupAgeMs(now, now, now - twentyMin)).toBe(twentyMin);
  });

  test("uses slot.createdAt when it is the earlier anchor", () => {
    const thirtyMin = 30 * 60_000;
    expect(inviteSetupAgeMs(now, now - thirtyMin, now - 5 * 60_000)).toBe(thirtyMin);
  });

  test("a fresh table (both anchors ~now) has age ~0 and is never reaped early", () => {
    expect(inviteSetupAgeMs(now, now, now)).toBe(0);
  });

  test("null slot timestamp falls back to the memo anchor", () => {
    const tenMin = 10 * 60_000;
    expect(inviteSetupAgeMs(now, null, now - tenMin)).toBe(tenMin);
  });

  test("null memo startedAt falls back to the slot anchor", () => {
    const tenMin = 10 * 60_000;
    expect(inviteSetupAgeMs(now, now - tenMin, null)).toBe(tenMin);
  });

  test("both null → age 0 (no anchor yet, don't reap)", () => {
    expect(inviteSetupAgeMs(now, null, undefined)).toBe(0);
  });
});
