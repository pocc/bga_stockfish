import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

/**
 * Parse-check the dashboard's inline client JS.
 *
 * The dashboard is a big backtick template literal in src/index.ts, and its
 * <script> body is browser JS embedded as a STRING. That string is valid
 * TypeScript no matter how broken the JS inside it is, so:
 *   - `tsc --noEmit` sees a valid template literal and says nothing.
 *   - vitest never executes the client JS, so it can't blow up there either.
 *
 * A real SyntaxError shipped to production exactly through this blind spot:
 *   (index):692 Uncaught SyntaxError: Unexpected identifier 'all'
 * caused by `setDiff(\'all\')` inside the template literal — the single
 * backslash collapsed away, so the browser received `setDiff('all')` whose
 * unescaped quotes terminated the surrounding single-quoted JS string.
 *
 * This test reconstructs the SERVED browser JS (resolving the template-literal
 * escape layer the TS compiler applies) and compiles it with node:vm to assert
 * it is syntactically valid. It would have caught that bug before deploy.
 */
const here = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(here, "../src/index.ts"), "utf8");

/**
 * Pull each <script>…</script> body out of the source and resolve it to the
 * exact bytes the browser receives. The dashboard <script> has no `${}`
 * interpolations and no nested backticks (guarded by the test below), so the
 * served JS is just the source text with template-literal escapes resolved —
 * which we get by evaluating the captured body as a template literal.
 */
function extractServedScripts(src: string): string[] {
  const scripts: string[] = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const rawBody = m[1];
    const served = new Function("return `" + rawBody + "`;")() as string;
    scripts.push(served);
  }
  return scripts;
}

// Boot the served dashboard script in a vm sandbox with DOM / timer stubs, then
// return the sandbox so render*/filter helpers can be driven directly. The noop
// proxy is self-chaining (el.classList.toggle(...) resolves to a no-op) so
// DOM-touching helpers like syncDiffButtons don't throw. Filter state (the
// script-scoped selectedDiff / selectedOutcome / activeFilters lets) is mutated
// through the script's own setDiff / setOutcome / setFilter; with no
// window.__lastStatus set, those skip their repaint side effects.
function bootDashboard(code: string): any {
  const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => undefined });
  const dummyEl = new Proxy({}, { get: () => noop, set: () => true });
  const sandbox: any = {
    document: { getElementById: () => dummyEl },
    setInterval: () => 0,
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    localStorage: { getItem: () => null, setItem: () => {} },
    window: {},
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

// Three live games for the filter tests: A = Italian / Premium, B = French /
// Free, C = Italian / Free. Only A has a recorded move (chess-api.com). All
// three are being played (play / asyncplay) and carry no difficulty, so they
// fall back to grandmaster.
function liveStatus() {
  const now = Date.now();
  return {
    tables: {
      A: { oppLanguage: "it", oppPremium: true, startedAt: now - 3, botColor: "white" },
      B: { oppLanguage: "fr", oppPremium: false, startedAt: now - 2, botColor: "white" },
      C: { oppLanguage: "it", oppPremium: false, startedAt: now - 1, botColor: "white" },
    },
    lastTablesSeen: [
      { id: "A", status: "play" },
      { id: "B", status: "play" },
      { id: "C", status: "asyncplay" },
    ],
    recentMoves: [{ tableId: "A", engine: "chess-api.com", from: "e2", to: "e4", ts: now }],
    recentResults: [],
  };
}

describe("dashboard inline scripts", () => {
  const scripts = extractServedScripts(indexSrc);

  test("at least one <script> block is present to check", () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  test("script blocks contain no server-side ${} interpolation", () => {
    // If this ever fails, the reconstruction above is no longer faithful —
    // the served JS would depend on runtime values and this test must grow a
    // proper interpolation stub before it can keep guarding syntax.
    const reSource = /<script[^>]*>([\s\S]*?)<\/script>/g;
    let m: RegExpExecArray | null;
    while ((m = reSource.exec(indexSrc)) !== null) {
      expect(m[1]).not.toMatch(/\$\{/);
    }
  });

  test.each(scripts.map((code, i) => [i, code] as const))(
    "served <script> block #%i parses without SyntaxError",
    (_i, code) => {
      expect(() => new vm.Script(code)).not.toThrow();
    },
  );

  test("engine-usage labels are shortened and cache: variants link to the base engine", () => {
    // Run the dashboard script in a sandbox with minimal DOM / timer stubs, then
    // grab the renderEngines output so a future "revert to long names" regression
    // (which we've already had once) trips here loudly.
    // load() runs on script init and reaches into document/fetch; stub both
    // with no-op proxies so the script defines its helpers without throwing.
    const dummyEl = new Proxy({}, { get: () => () => {}, set: () => true });
    const sandbox: any = {
      document: { getElementById: () => dummyEl },
      setInterval: () => 0,
      fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
      window: {},
      console,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(scripts[scripts.length - 1], sandbox);

    const html = sandbox.renderEngines({
      "js-chess-engine (local DO)": 10,
      "cache:lichess-cloud-eval": 5,
      "lichess-cloud-eval": 3,
    });
    // The full key is still embedded in <title> tooltips on slices (that's the
    // canonical id); the user-visible legend labels live in <span class="mono">.
    const legendLabels = [...html.matchAll(/<span class="mono">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(legendLabels).toEqual(["js-chess-engine", "cache:lichess", "lichess"]);
    // cache: variants must link to the same homepage as the underlying engine.
    expect(html).toContain('href="https://www.npmjs.com/package/js-chess-engine"');
    expect(html).toContain('href="https://lichess.org/api#tag/Analysis/operation/apiCloudEval"');
  });

  test("Past Games shows a premium dot before the opponent name", () => {
    // Same sandbox trick as above: run the client script, then call
    // renderResults directly. Guards the "easy to read premium marker"
    // feature against a future revert.
    const dummyEl = new Proxy({}, { get: () => () => {}, set: () => true });
    const sandbox: any = {
      document: { getElementById: () => dummyEl },
      setInterval: () => 0,
      fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
      window: {},
      console,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(scripts[scripts.length - 1], sandbox);

    const now = Date.now();
    // moveCount ≥ 4 keeps each entry in Past Games (under MIN_BOT_MOVES_FOR_SCORED
    // they'd be routed to the non-scored troubleshooting table instead).
    const html: string = sandbox.renderResults([
      { ts: now, tableId: "1", tally: "win", oppName: "PremPlayer", oppId: "100", oppPremium: true, moveCount: 22 },
      { ts: now, tableId: "2", tally: "loss", oppName: "FreePlayer", oppId: "200", oppPremium: false, moveCount: 18 },
      { ts: now, tableId: "3", tally: "draw", oppName: "OldEntry", oppId: "300", moveCount: 24 }, // oppPremium undefined
    ]);

    // Premium → filled green dot immediately before the name link.
    expect(html).toMatch(/premdot" title="BGA Premium member">●<\/span><a href="[^"]*id=100"/);
    // Free → hollow muted dot before the name link.
    expect(html).toMatch(/freedot" title="Free member">○<\/span><a href="[^"]*id=200"/);
    // Exactly one of each across the three rows — the unknown (legacy) entry
    // gets no dot at all.
    expect((html.match(/class="premdot"/g) || []).length).toBe(1);
    expect((html.match(/class="freedot"/g) || []).length).toBe(1);
    // The legacy entry's name link is not preceded by any dot span.
    expect(html).toMatch(/<td><a href="[^"]*id=300"[^>]*>OldEntry<\/a><\/td>/);
  });

  test("LVL column renders 1-6 from difficulty, and '?' only when missing", () => {
    // Regression: MoveEntry.difficulty was never written by recordMove, so
    // every fresh move rendered "?" in the LVL column instead of 1-6.
    const dummyEl = new Proxy({}, { get: () => () => {}, set: () => true });
    const sandbox: any = {
      document: { getElementById: () => dummyEl },
      setInterval: () => 0,
      fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
      window: {},
      console,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(scripts[scripts.length - 1], sandbox);

    const now = Date.now();
    const html: string = sandbox.renderMoves([
      { ts: now, tableId: "1", from: "e2", to: "e4", engine: "chess-api.com", difficulty: "grandmaster" },
      { ts: now, tableId: "2", from: "d2", to: "d4", engine: "chess-api.com", difficulty: "expert" },
      { ts: now, tableId: "3", from: "g1", to: "f3", engine: "chess-api.com", difficulty: "beginner" },
      { ts: now, tableId: "4", from: "c2", to: "c4", engine: "chess-api.com" }, // legacy: no difficulty
    ]);

    expect(html).toMatch(/title="grandmaster">6</);
    expect(html).toMatch(/title="expert">5</);
    expect(html).toMatch(/title="beginner">1</);
    expect(html).toMatch(/title="unknown \(entry predates difficulty capture\)">\?</);
  });

  test("short scored games drop out of Past Games and surface in non-scored", () => {
    // BGA reported a clean win/loss/draw, but the game never crossed the
    // MIN_BOT_MOVES_FOR_SCORED bar — typically an opp abandon in the opening
    // or a seatless-archive recovery with no played moves. These belong in
    // the troubleshooting table, not in Past Games, so they don't pad W/L/D.
    const dummyEl = new Proxy({}, { get: () => () => {}, set: () => true });
    const sandbox: any = {
      document: { getElementById: () => dummyEl },
      setInterval: () => 0,
      fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
      window: {},
      console,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(scripts[scripts.length - 1], sandbox);

    const now = Date.now();
    const entries = [
      { ts: now, tableId: "10", tally: "win", oppName: "Real", oppId: "10", moveCount: 22 },
      { ts: now, tableId: "11", tally: "win", oppName: null, moveCount: null }, // seatless recovery
      { ts: now, tableId: "12", tally: "loss", oppName: "Quick", oppId: "12", moveCount: 2 }, // opp abandoned early
      { ts: now, tableId: "13", tally: "none", reason: "oppQuit", oppName: "Quitter", oppId: "13" },
    ];

    const past: string = sandbox.renderResults(entries);
    // Only the proper 22-move win shows up in Past Games. Every row gets a
    // tableLink with ?table=N — checking that href is the simplest per-row
    // sentinel (works even for rows with no oppId, e.g. the seatless one).
    expect(past).toContain("?table=10");
    expect(past).not.toContain("?table=11");
    expect(past).not.toContain("?table=12");
    expect(past).not.toContain("?table=13");

    const nonScored: string = sandbox.renderNonResults(entries);
    // The two short scored games are now routed here, labeled with the
    // actual tally so the row stays auditable.
    expect(nonScored).toContain("?table=11");
    expect(nonScored).toContain("?table=12");
    expect(nonScored).toMatch(/Too short — loss \(bot moves: 2\)/);
    expect(nonScored).toMatch(/Too short — win \(bot moves: \?\)/);
    // And the genuinely-unscored opp-quit row is still in there with its
    // existing reason, unchanged.
    expect(nonScored).toContain("?table=13");
    expect(nonScored).toContain("Opponent quit");
    // The real win stays out of the non-scored table.
    expect(nonScored).not.toContain("?table=10");
  });

  const lastScript = () => scripts[scripts.length - 1];
  const sortedLive = (sb: any, s: any) => sb.selectedLiveIds(s).live.slice().sort();

  test("live games: no filter shows every live game", () => {
    const sb = bootDashboard(lastScript());
    const s = liveStatus();
    expect(sortedLive(sb, s)).toEqual(["A", "B", "C"]);
    expect(sb.selectedLiveIds(s).hidden).toBe(0);
  });

  test("live games honor the language pie filter", () => {
    const sb = bootDashboard(lastScript());
    const s = liveStatus();
    sb.setFilter("language", "it");
    expect(sortedLive(sb, s)).toEqual(["A", "C"]);
    expect(sb.selectedLiveIds(s).hidden).toBe(1);
  });

  test("live games honor the membership pie filter", () => {
    const sb = bootDashboard(lastScript());
    const s = liveStatus();
    sb.setFilter("premium", "Premium");
    expect(sortedLive(sb, s)).toEqual(["A"]);
  });

  test("live games honor the engine pie filter (via recorded moves)", () => {
    const sb = bootDashboard(lastScript());
    const s = liveStatus();
    sb.setFilter("engine", "chess-api.com");
    expect(sortedLive(sb, s)).toEqual(["A"]);
  });

  test("live games honor the difficulty tab", () => {
    const sb = bootDashboard(lastScript());
    const s = liveStatus();
    sb.setDiff("expert"); // memos default to grandmaster → nothing matches
    expect(sortedLive(sb, s)).toEqual([]);
    sb.setDiff("grandmaster");
    expect(sortedLive(sb, s)).toEqual(["A", "B", "C"]);
  });

  test("a finished-outcome card empties the live panel; the Live card keeps it", () => {
    const sb = bootDashboard(lastScript());
    const s = liveStatus();
    sb.setOutcome("win"); // a live game has no win tally
    expect(sortedLive(sb, s)).toEqual([]);
    expect(sb.selectedLiveIds(s).hidden).toBe(3);
    sb.setOutcome("live"); // toggles win off, selects live
    expect(sortedLive(sb, s)).toEqual(["A", "B", "C"]);
  });

  test("live filters combine (AND) across dimensions", () => {
    const sb = bootDashboard(lastScript());
    const s = liveStatus();
    sb.setFilter("language", "it");
    sb.setFilter("premium", "Free"); // Italian AND Free → only C
    expect(sortedLive(sb, s)).toEqual(["C"]);
  });

  test("empty live panel under a filter explains itself and offers a clear", () => {
    const sb = bootDashboard(lastScript());
    const s = liveStatus();
    sb.setOutcome("win");
    const html: string = sb.renderGamesTable(s);
    expect(html).toContain("no live games match the active filters");
    expect(html).toContain("3 live games hidden by active filters");
    expect(html).toContain("clearAllFilters()");
  });

  test("the live-outcome language pie stays the full index, not narrowed by its own slice", () => {
    // Picking the Live card sources the language pie from live memos; clicking
    // an Italian slice must NOT collapse that pie to Italian only (it's the
    // index you switch slices from), even though the games panel narrows.
    const sb = bootDashboard(lastScript());
    const s = liveStatus();
    sb.window.__lastStatus = s;
    sb.setOutcome("live");
    sb.setFilter("language", "it");
    const pie: string = sb.renderLanguages(s.recentResults);
    expect(pie).toContain("Italian");
    expect(pie).toContain("French"); // French still present despite the it filter
    // …while the games panel is narrowed to the Italian live games.
    expect(sortedLive(sb, s)).toEqual(["A", "C"]);
  });

  test("the unified chip bar shows every active dimension and clear-all resets them", () => {
    const sb = bootDashboard(lastScript());
    sb.setDiff("expert");
    sb.setOutcome("win");
    sb.setFilter("language", "it");
    const chip: string = sb.renderFilterChip();
    expect(chip).toContain("difficulty = ");
    expect(chip).toContain("expert");
    expect(chip).toContain("showing = ");
    expect(chip).toContain("wins");
    expect(chip).toContain("language = ");
    expect(chip).toContain("Italian");
    expect(chip).toContain("clear all");
    // Clearing wipes all three dimensions at once → empty bar.
    sb.clearAllFilters();
    expect(sb.renderFilterChip()).toBe("");
  });

  // A status whose lifetime aggregate (stats.wins/losses/draws) deliberately
  // disagrees with the recent window, so a test can tell which source the
  // Stats cards read from.
  function tallyStatus() {
    return {
      stats: { wins: 100, losses: 50, draws: 10, byDifficulty: {}, engineUses: { "chess-api.com": 99 } },
      recentResults: [
        { tableId: "1", tally: "win", oppLanguage: "it", oppPremium: true, moveCount: 20 },
        { tableId: "2", tally: "loss", oppLanguage: "it", oppPremium: false, moveCount: 20 },
        { tableId: "3", tally: "win", oppLanguage: "fr", oppPremium: false, moveCount: 20 },
        { tableId: "4", tally: "draw", oppLanguage: "it", oppPremium: true, moveCount: 20 },
      ],
      tables: {}, lastTablesSeen: [], recentMoves: [],
    };
  }

  test("Stats cards recompute W/L/D from the recent window under a pie filter", () => {
    const sb = bootDashboard(lastScript());
    const s = tallyStatus();
    sb.window.__lastStatus = s;
    // No pie filter → cards stay on the lifetime aggregate (recompute off).
    expect(sb.hasAnyFilter()).toBe(false);
    // language=it → recompute from the recent window: it games are 1W/1L/1D
    // (the French win is excluded), NOT the lifetime 100/50/10.
    sb.setFilter("language", "it");
    expect(sb.filteredScoredTally(s)).toEqual({ wins: 1, losses: 1, draws: 1 });
    // membership=Premium → it/prem win + it/prem draw → 1W/0L/1D.
    sb.setFilter("language", "it"); // toggle off
    sb.setFilter("premium", "Premium");
    expect(sb.filteredScoredTally(s)).toEqual({ wins: 1, losses: 0, draws: 1 });
  });

  test("pies are faceted: each reflects the OTHER active filters but stays full on its own dim", () => {
    const sb = bootDashboard(lastScript());
    const s = tallyStatus();
    sb.window.__lastStatus = s;
    sb.setFilter("language", "it");
    // Membership pie facets BY language → only the 3 Italian games feed it.
    const mem = sb.facetedPieRecords(s.recentResults, "premium").map((r: any) => r.tableId).sort();
    expect(mem).toEqual(["1", "2", "4"]);
    // Language pie leaves its OWN dim free → all 4 games, so you can switch slices.
    expect(sb.facetedPieRecords(s.recentResults, "language").length).toBe(4);
  });

  test("the engine pie facets by a language filter (counts only that language's moves)", () => {
    const s = {
      stats: { wins: 0, losses: 0, draws: 0, byDifficulty: {}, engineUses: { "chess-api.com": 99 } },
      recentResults: [
        { tableId: "1", tally: "win", oppLanguage: "it", oppPremium: true, moveCount: 20 },
        { tableId: "2", tally: "win", oppLanguage: "fr", oppPremium: true, moveCount: 20 },
      ],
      tables: {}, lastTablesSeen: [],
      recentMoves: [
        { tableId: "1", engine: "chess-api.com", from: "e2", to: "e4", ts: Date.now() },
        { tableId: "2", engine: "stockfish.online", from: "d2", to: "d4", ts: Date.now() },
      ],
    };
    const sb = bootDashboard(lastScript());
    sb.window.__lastStatus = s;
    sb.setFilter("language", "it");
    const html: string = sb.renderEngines(s.stats.engineUses);
    // Only the Italian table's engine survives the facet.
    expect(html).toContain("chess-api");
    expect(html).not.toContain("stockfish");
  });

  test("games-over-time plots cumulative scored games and honors the difficulty filter", () => {
    const sb = bootDashboard(lastScript());
    const now = Date.now();
    const s = {
      recentResults: [
        { ts: now - 30000, tableId: "1", tally: "win", moveCount: 20, difficulty: "grandmaster" },
        { ts: now - 20000, tableId: "2", tally: "loss", moveCount: 20, difficulty: "expert" },
        { ts: now - 10000, tableId: "3", tally: "draw", moveCount: 20, difficulty: "grandmaster" },
        // Too short (< MIN_BOT_MOVES_FOR_SCORED) → not scored → not on the curve.
        { ts: now - 5000, tableId: "4", tally: "win", moveCount: 2, difficulty: "grandmaster" },
      ],
      tables: {}, lastTablesSeen: [], recentMoves: [],
    };
    sb.window.__lastStatus = s;

    // Unfiltered: 3 scored games → SVG with a y-max + end-dot reading 3.
    const all: string = sb.renderGamesOverTime(s);
    expect(all).toContain("<svg");
    expect(all).toContain('class="got-line"');
    expect(all).toContain(">3 games</title>");
    expect(all).toMatch(/class="got-axis"[^>]*>3<\/text>/);

    // Difficulty tab narrows the curve to the 2 grandmaster scored games.
    sb.setDiff("grandmaster");
    expect(sb.renderGamesOverTime(s)).toContain(">2 games</title>");

    // A difficulty with no scored games shows the empty state, not an SVG.
    sb.setDiff("beginner");
    const none: string = sb.renderGamesOverTime(s);
    expect(none).not.toContain("<svg");
    expect(none).toContain("no finished games");
  });

  test("games-over-time anchors the peak to the lifetime total, not the window size", () => {
    // recentResults is capped, so the in-window count undercounts lifetime play.
    // The curve's peak must track the Stats lifetime total (here 1100), with the
    // earlier in-window games counting down from it (floor = 1100 - 3 = 1097).
    const sb = bootDashboard(lastScript());
    const now = Date.now();
    const s = {
      stats: {
        wins: 1000, losses: 60, draws: 40,
        byDifficulty: { expert: { wins: 20, losses: 5, draws: 5 } },
      },
      recentResults: [
        { ts: now - 30000, tableId: "1", tally: "win", moveCount: 20, difficulty: "grandmaster" },
        { ts: now - 20000, tableId: "2", tally: "win", moveCount: 20, difficulty: "expert" },
        { ts: now - 10000, tableId: "3", tally: "loss", moveCount: 20, difficulty: "expert" },
      ],
      tables: {}, lastTablesSeen: [], recentMoves: [],
    };
    sb.window.__lastStatus = s;

    const html: string = sb.renderGamesOverTime(s);
    // Peak label + end-dot read the lifetime total, not the window's 3.
    expect(html).toContain(">1100 games</title>");
    expect(html).toMatch(/class="got-axis"[^>]*>1100<\/text>/);
    // The logged games (base 1097) post-date launch, so the curve extrapolates a
    // straight line back to 0 at launch — the axis floor is 0, not 1097.
    expect(html).toMatch(/class="got-axis"[^>]*>0<\/text>/);
    // Hover state is stashed so the cursor handler can map x → date/total.
    expect(sb.window.__gotChart).toMatchObject({
      total: 1100, base: 1097, recorded: 3, extrapolated: true, yFloor: 0,
    });
    // The x-axis origin (launch) sits before the first logged game.
    expect(sb.window.__gotChart.tStart).toBeLessThan(sb.window.__gotChart.dataStart);

    // A per-difficulty filter re-anchors to that difficulty's lifetime tally
    // (expert: 20+5+5 = 30), over its 2 in-window expert games (floor 28).
    sb.setDiff("expert");
    const expert: string = sb.renderGamesOverTime(s);
    expect(expert).toContain(">30 games</title>");
    expect(sb.window.__gotChart).toMatchObject({ total: 30, base: 28, recorded: 2 });
  });

  test("games-over-time prefers the durable per-game timeline over the capped window", () => {
    // gamesTimeline (from the DO's SQLite games table) carries one row per game,
    // so the chart steps at each game's actual timestamp and filters by
    // difficulty / outcome over those rows.
    const sb = bootDashboard(lastScript());
    const day = 86_400_000;
    const D = 20000 * day; // an arbitrary base time (well before the window)
    const s = {
      stats: {
        wins: 50, losses: 0, draws: 0,
        byDifficulty: { grandmaster: { wins: 40, losses: 0, draws: 0 }, expert: { wins: 10, losses: 0, draws: 0 } },
      },
      // Only a sliver survives in the window, but the timeline reaches back.
      recentResults: [
        { ts: D + 5 * day, tableId: "z", tally: "win", moveCount: 20, difficulty: "grandmaster", oppLanguage: "it" },
      ],
      // 5 logged games: 4 grandmaster wins + 1 expert win, at distinct times.
      gamesTimeline: [
        { ts: D + 1 * day, difficulty: "grandmaster", tally: "win" },
        { ts: D + 2 * day, difficulty: "grandmaster", tally: "win" },
        { ts: D + 2 * day + 3600000, difficulty: "expert", tally: "win" },
        { ts: D + 4 * day, difficulty: "grandmaster", tally: "win" },
        { ts: D + 5 * day, difficulty: "grandmaster", tally: "win" },
      ],
      tables: {}, lastTablesSeen: [], recentMoves: [],
    };
    sb.window.__lastStatus = s;

    // Unfiltered: recorded = 5 games; anchored to the lifetime total of 50
    // (floor 45). One step per game proves it reads the per-game timeline, not
    // the single-game window.
    sb.renderGamesOverTime(s);
    expect(sb.window.__gotChart).toMatchObject({ total: 50, recorded: 5, base: 45 });
    // These mock times predate the launch constant, so no extrapolation: the
    // solid series starts at the first logged game.
    expect(sb.window.__gotChart.dataStart).toBe(D + 1 * day);
    expect(sb.window.__gotChart.steps.length).toBe(5); // one step per game

    // Difficulty filter keeps only that difficulty's games: 4 grandmaster wins,
    // anchored to byDifficulty.grandmaster = 40.
    sb.setDiff("grandmaster");
    sb.renderGamesOverTime(s);
    expect(sb.window.__gotChart).toMatchObject({ total: 40, recorded: 4 });

    // A pie filter has no timeline breakdown, so the chart falls back to the
    // single-game recentResults window (recorded = 1).
    sb.setDiff("all");
    sb.setFilter("language", "it");
    sb.renderGamesOverTime(s);
    expect(sb.window.__gotChart.recorded).toBe(1);
  });
});
