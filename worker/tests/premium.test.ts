import { describe, expect, test } from "vitest";
import {
  buildPremiumLink, buildGameLink, isSecondaryAsyncGame, primaryAsyncGameId,
  decidePremiumBlock, isPremiumGateActive, PREMIUM_GATE_MIN_GAMES,
  PREMIUM_REDIRECT_ORIGIN, BGA_PREMIUM_URL, BGA_TABLE_URL,
  type PremiumMemoView,
} from "../src/premium";

describe("buildPremiumLink", () => {
  test("routes through the worker /go/premium with who/where/mode", () => {
    const link = buildPremiumLink("99999001", "860987170", "realtime");
    expect(link.startsWith(PREMIUM_REDIRECT_ORIGIN + "/go/premium?")).toBe(true);
    const u = new URL(link);
    expect(u.searchParams.get("u")).toBe("99999001");
    expect(u.searchParams.get("t")).toBe("860987170");
    expect(u.searchParams.get("m")).toBe("realtime");
  });

  test("encodes async mode too", () => {
    expect(buildPremiumLink("1", "2", "async")).toContain("m=async");
  });

  test("BGA target is the membership page", () => {
    expect(BGA_PREMIUM_URL).toBe("https://boardgamearena.com/premium");
  });
});

describe("buildGameLink", () => {
  test("points at the generic BGA table view for the kept game", () => {
    expect(buildGameLink("860987170")).toBe(BGA_TABLE_URL + "860987170");
    expect(buildGameLink("860987170")).toBe(
      "https://boardgamearena.com/table?table=860987170",
    );
  });
  test("does NOT route through the worker (nothing to log)", () => {
    expect(buildGameLink("1").startsWith(PREMIUM_REDIRECT_ORIGIN)).toBe(false);
  });
});

describe("primaryAsyncGameId", () => {
  const async = (oppId: string, extra: Partial<PremiumMemoView> = {}): PremiumMemoView =>
    ({ realtime: false, oppId, ...extra });

  test("returns the oldest (smallest-id) active async game", () => {
    const tables = { "300": async("opp1"), "100": async("opp1"), "200": async("opp1") };
    expect(primaryAsyncGameId(tables, "opp1")).toBe("100");
  });
  test("ignores finished/conceded, realtime, and other opponents", () => {
    const tables = {
      "100": async("opp1", { finished: true }),
      "150": { realtime: true, oppId: "opp1" },
      "180": async("other"),
      "200": async("opp1"),
      "300": async("opp1"),
    };
    expect(primaryAsyncGameId(tables, "opp1")).toBe("200");
  });
  test("null when the opponent has no active async game", () => {
    expect(primaryAsyncGameId({}, "opp1")).toBe(null);
    expect(primaryAsyncGameId({ "100": async("opp1", { finished: true }) }, "opp1")).toBe(null);
  });
  test("the blocked secondary game is never its own primary", () => {
    const tables = { "100": async("opp1"), "200": async("opp1") };
    const primary = primaryAsyncGameId(tables, "opp1");
    expect(primary).toBe("100");
    expect(isSecondaryAsyncGame(tables, "opp1", "200")).toBe(true);
    expect(primary).not.toBe("200"); // the kept game differs from the blocked one
  });
});

describe("decidePremiumBlock", () => {
  test("premium members are always allowed", () => {
    expect(decidePremiumBlock({ isRealtime: true, oppPremium: true, secondaryAsync: true })).toBe(null);
    expect(decidePremiumBlock({ isRealtime: false, oppPremium: true, secondaryAsync: true })).toBe(null);
  });

  test("unknown membership fails open (never blocks a possibly-paying user)", () => {
    expect(decidePremiumBlock({ isRealtime: true, oppPremium: undefined, secondaryAsync: true })).toBe(null);
  });

  test("free member in realtime is blocked", () => {
    expect(decidePremiumBlock({ isRealtime: true, oppPremium: false, secondaryAsync: false })).toBe("realtime-free");
  });

  test("free member's first async game is allowed", () => {
    expect(decidePremiumBlock({ isRealtime: false, oppPremium: false, secondaryAsync: false })).toBe(null);
  });

  test("free member's second concurrent async game is blocked", () => {
    expect(decidePremiumBlock({ isRealtime: false, oppPremium: false, secondaryAsync: true })).toBe("async-limit");
  });
});

describe("isSecondaryAsyncGame", () => {
  const async = (oppId: string, extra: Partial<PremiumMemoView> = {}): PremiumMemoView =>
    ({ realtime: false, oppId, ...extra });

  test("a lone async game is never secondary", () => {
    const tables = { "100": async("opp1") };
    expect(isSecondaryAsyncGame(tables, "opp1", "100")).toBe(false);
  });

  test("with two concurrent games, only the newer (larger id) is secondary", () => {
    const tables = { "100": async("opp1"), "200": async("opp1") };
    expect(isSecondaryAsyncGame(tables, "opp1", "100")).toBe(false); // oldest kept
    expect(isSecondaryAsyncGame(tables, "opp1", "200")).toBe(true);  // newer blocked
  });

  test("finished/conceded peers don't count toward the limit", () => {
    const tables = {
      "100": async("opp1", { finished: true }),
      "200": async("opp1", { conceded: true }),
      "300": async("opp1"),
    };
    expect(isSecondaryAsyncGame(tables, "opp1", "300")).toBe(false); // only active one
  });

  test("games against a different opponent don't count", () => {
    const tables = { "100": async("other"), "200": async("opp1") };
    expect(isSecondaryAsyncGame(tables, "opp1", "200")).toBe(false);
  });

  test("realtime games are ignored entirely", () => {
    const tables = {
      "100": { realtime: true, oppId: "opp1" },
      "200": async("opp1"),
    };
    expect(isSecondaryAsyncGame(tables, "opp1", "200")).toBe(false);
  });

  test("three concurrent games: oldest kept, both newer blocked", () => {
    const tables = { "100": async("opp1"), "200": async("opp1"), "300": async("opp1") };
    expect(isSecondaryAsyncGame(tables, "opp1", "100")).toBe(false);
    expect(isSecondaryAsyncGame(tables, "opp1", "200")).toBe(true);
    expect(isSecondaryAsyncGame(tables, "opp1", "300")).toBe(true);
  });

  test("a table not in the active set is never flagged", () => {
    const tables = { "100": async("opp1") };
    expect(isSecondaryAsyncGame(tables, "opp1", "999")).toBe(false);
  });
});

describe("isPremiumGateActive (growth-phase hold)", () => {
  test("min games threshold is 10k", () => {
    expect(PREMIUM_GATE_MIN_GAMES).toBe(10_000);
  });

  test("off well below the threshold (current ~535 games)", () => {
    expect(isPremiumGateActive(535)).toBe(false);
    expect(isPremiumGateActive(0)).toBe(false);
  });

  test("off one game short of the threshold", () => {
    expect(isPremiumGateActive(9_999)).toBe(false);
  });

  test("on exactly at the threshold and above", () => {
    expect(isPremiumGateActive(10_000)).toBe(true);
    expect(isPremiumGateActive(10_001)).toBe(true);
    expect(isPremiumGateActive(1_000_000)).toBe(true);
  });

  test("threshold is injectable for staged rollouts / tests", () => {
    expect(isPremiumGateActive(100, 100)).toBe(true);
    expect(isPremiumGateActive(99, 100)).toBe(false);
  });
});
