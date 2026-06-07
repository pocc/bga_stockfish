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
});
