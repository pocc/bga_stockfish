import { StockfishEngine } from "./stockfish-do";
import { BotDriver } from "./bot-do";
import { StockfishContainer } from "./container-do";
import { BGA_PREMIUM_URL } from "./premium";

export { StockfishEngine, BotDriver, StockfishContainer };

export interface Env {
  ENGINE: DurableObjectNamespace;
  BOT: DurableObjectNamespace;
  /** Optional: native Stockfish container binding. Dormant — uncomment the
   *  [[containers]] + binding blocks in wrangler.toml to enable. */
  STOCKFISH_CONTAINER?: DurableObjectNamespace;
  /** BGA bot credentials — set with `wrangler secret put`. */
  BGA_USERNAME: string;
  BGA_PASSWORD: string;
  /** Admin secret for mutating /bot/* endpoints. Set with `wrangler secret put BOT_ADMIN_SECRET`.
   *  When unset, mutating endpoints are blocked from external callers. */
  BOT_ADMIN_SECRET?: string;
  /** RapidAPI key for the Chess Stockfish 16 API. Set with
   *  `wrangler secret put RAPIDAPI_STOCKFISH_KEY`. When unset, the engine
   *  is silently skipped in the race. */
  RAPIDAPI_STOCKFISH_KEY?: string;
}

function botStub(env: Env) {
  // Single global bot singleton — one account, one driver.
  return env.BOT.get(env.BOT.idFromName("singleton"));
}

/** Constant-time string comparison so admin-secret checks don't leak the
 *  secret's contents through response-time differences. A length mismatch is
 *  allowed to short-circuit; the byte comparison always scans the full buffer. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** Returns true when the request carries the admin secret (header or query). */
function isAdmin(req: Request, env: Env): boolean {
  const expected = env.BOT_ADMIN_SECRET;
  if (!expected) return false;
  const url = new URL(req.url);
  const fromHeader = req.headers.get("x-admin-secret");
  const fromQuery = url.searchParams.get("secret");
  return (
    (fromHeader != null && safeEqual(fromHeader, expected)) ||
    (fromQuery != null && safeEqual(fromQuery, expected))
  );
}

function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(landingHtml(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "stockfish-worker",
        version: "0.2.0",
        endpoints: {
          "GET /health": "this",
          "GET /bot/status": "public bot diagnostic snapshot",
        },
      });
    }

    if (url.pathname === "/bestmove" && req.method === "POST") {
      // Gated: the bot calls the DO directly via service binding, so the
      // public HTTP route only exists for ad-hoc admin testing. Leaving it
      // open lets anyone proxy through us to upstream APIs (chess-api.com,
      // lichess, stockfish.online, rapidapi) on our quota/keys.
      if (!isAdmin(req, env)) return unauthorized();
      let body: {
        fen?: string;
        movetime?: number;
        depth?: number;
        gameId?: string;
        localOnly?: boolean;
        remoteOnly?: boolean;
      };
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid json body" }, { status: 400 });
      }
      if (!body.fen || typeof body.fen !== "string") {
        return Response.json({ error: "fen required" }, { status: 400 });
      }

      const gameId = body.gameId ?? "default";
      const id = env.ENGINE.idFromName(gameId);
      const stub = env.ENGINE.get(id);

      const { gameId: _, ...passthrough } = body;
      return stub.fetch("https://do/bestmove", {
        method: "POST",
        body: JSON.stringify(passthrough),
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/status" && req.method === "GET") {
      const gameId = url.searchParams.get("gameId") ?? "default";
      const id = env.ENGINE.idFromName(gameId);
      const stub = env.ENGINE.get(id);
      return stub.fetch("https://do/status");
    }

    // Bot status is public so the dashboard at / can poll it.
    if (url.pathname === "/bot/status" && req.method === "GET") {
      return botStub(env).fetch("https://do/status");
    }

    // Premium upgrade redirect. The bot's "upgrade to BGA Premium" nudge
    // links here (carrying u=opponent, t=table, m=mode) so the click is
    // logged in the DO — evidence we drive BGA memberships — before we 302
    // the user on to BGA's membership page. Public + best-effort: a logging
    // failure must never block the redirect.
    if (url.pathname === "/go/premium") {
      const forwarded = new URLSearchParams();
      for (const k of ["u", "t", "m"]) {
        const v = url.searchParams.get(k);
        if (v) forwarded.set(k, v);
      }
      const qs = forwarded.toString();
      try {
        await botStub(env).fetch(
          qs ? `https://do/premium-click?${qs}` : "https://do/premium-click",
        );
      } catch {
        /* logging is best-effort — fall through to the redirect */
      }
      return Response.redirect(BGA_PREMIUM_URL, 302);
    }
    // Debug: dump parsed game state for a tracked table id. Gated behind the
    // admin secret — it triggers a BGA login + game-page fetch, so leaving it
    // open lets anonymous callers drive bot-side work (and leaks game state).
    if (url.pathname === "/bot/inspect" && req.method === "GET") {
      if (!isAdmin(req, env)) return unauthorized();
      const forwarded = new URLSearchParams(url.search);
      forwarded.delete("secret");
      return botStub(env).fetch(`https://do/inspect?${forwarded.toString()}`);
    }

    // Mutating bot endpoints require the admin secret. The internal cron
    // handler calls the DO stub directly and bypasses this fetch handler,
    // so it doesn't need the secret.
    const mutatingBot = new Set([
      "/bot/start", "/bot/stop", "/bot/tick", "/bot/cleanup",
      "/bot/probe", "/bot/wipe", "/bot/fix-result", "/bot/reconcile-results",
      "/bot/retally-unscored",
      "/bot/resync-stats", "/bot/resync-engine-uses", "/bot/ws-probe",
      "/bot/purge-cache",
    ]);
    if (mutatingBot.has(url.pathname)) {
      if (!isAdmin(req, env)) return unauthorized();
      const subpath = url.pathname.replace(/^\/bot/, "");
      // Every entry in mutatingBot is a POST on the DO side. (/bot/status is
      // handled earlier and never reaches here.)
      const method = "POST";
      // Forward query params (e.g. ?only=4 for /bot/probe) but drop the
      // admin secret so it doesn't show up in DO-side logs.
      const forwarded = new URLSearchParams(url.search);
      forwarded.delete("secret");
      const qs = forwarded.toString();
      const doUrl = qs ? `https://do${subpath}?${qs}` : `https://do${subpath}`;
      return botStub(env).fetch(doUrl, { method });
    }

    return new Response("not found", { status: 404 });
  },

  /**
   * Cron Trigger watchdog: pokes the bot driver once a minute. The DO
   * normally self-schedules via alarm() every TICK_MS, but if an alarm
   * ever fails to fire (DO eviction during deploy, etc.) this rearms it.
   * Also auto-starts the bot on first poke so a fresh deploy is hands-off.
   */
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const stub = botStub(env);
    // Single watchdog call: re-arms the alarm chain and runs one tick, but
    // honors an operator pause (/bot/stop). Poking /start here instead would
    // override a deliberate stop within ~60s, so the bot could never be
    // paused. A fresh deploy has paused=false, so auto-start still works.
    await stub.fetch("https://do/watchdog", { method: "POST" });
  },
};

function landingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>stockfish.ross.gg</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  :root {
    --bg: #f7f5f0;
    --fg: #1a1a1a;
    --muted: #6b6b6b;
    --rule: #d9d4c7;
    --accent: #b85c38;
    --code-bg: #efece4;
    --ok: #2c7a3a;
    --warn: #b85c38;
    --err: #c0392b;
    --draw: #a8881e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14110d;
      --fg: #ece8df;
      --muted: #8a8578;
      --rule: #2a2620;
      --accent: #e89968;
      --code-bg: #1d1a15;
      --ok: #6ec27a;
      --warn: #e89968;
      --err: #e87968;
      --draw: #e0c64a;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font: 14px/1.55 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    padding: 32px 24px 96px;
  }
  main { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 24px; }
  h2 {
    font-size: 11px; font-weight: 600; letter-spacing: 0.10em; text-transform: uppercase;
    color: var(--muted); margin: 24px 0 8px; border-top: 1px solid var(--rule); padding-top: 16px;
  }
  .mono, code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; font-size: 12px; }
  code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px; }
  pre { background: var(--code-bg); padding: 12px 14px; border-radius: 6px; overflow-x: auto; margin: 0 0 8px; }
  pre code { background: transparent; padding: 0; }
  a { color: var(--accent); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
  #stats { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .card { background: var(--code-bg); padding: 10px 12px; border-radius: 6px; }
  .card .label { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  .card .val { font-size: 22px; font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--rule); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  .ok { color: var(--ok); }
  .warn { color: var(--warn); }
  .err { color: var(--err); }
  .draw { color: var(--draw); }
  .muted { color: var(--muted); }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 10px; background: var(--code-bg); font-size: 11px; }
  .pill.btn { cursor: pointer; user-select: none; border: 1px solid transparent; }
  .pill.btn.on { border-color: var(--accent); color: var(--accent); }
  /* Gallery of mini boards */
  .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
  .gcard { display: block; text-decoration: none; color: inherit; background: var(--code-bg); border-radius: 8px; padding: 10px; transition: transform 0.08s ease; border-left: 3px solid transparent; }
  .gcard:hover { transform: translateY(-1px); }
  /* Gamemode accent: realtime games get a live/electric stripe, turn-based a calm one. */
  .gcard.rt { border-left-color: #f59e0b; }
  .gcard.tb { border-left-color: #6b7fd7; }
  .gmode { font-weight: 600; padding: 1px 6px; border-radius: 8px; font-size: 10px; white-space: nowrap; flex-shrink: 0; }
  /* Past-games Live column: orange dot marks a realtime game. */
  .livedot { color: #f59e0b; font-size: 13px; line-height: 1; }
  /* Premium marker before an opponent name: filled green dot = BGA Premium,
     hollow muted dot = free member, nothing = unknown (legacy entries). */
  .premdot { color: var(--ok); font-size: 12px; line-height: 1; margin-right: 4px; }
  .freedot { color: var(--muted); font-size: 12px; line-height: 1; margin-right: 4px; }
  .gmode.rt { background: rgba(245, 158, 11, 0.18); color: #b45309; }
  .gmode.tb { background: rgba(107, 127, 215, 0.18); color: #4356a8; }
  @media (prefers-color-scheme: dark) {
    .gmode.rt { color: #fbbf24; }
    .gmode.tb { color: #a9b6ee; }
  }
  .gboard { display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr); aspect-ratio: 1 / 1; border-radius: 4px; overflow: hidden; box-shadow: 0 0 0 1px var(--rule) inset; }
  .gsq { display: flex; align-items: center; justify-content: center; font-size: 17px; line-height: 1; }
  .gsq.l { background: #ebe1c4; }
  .gsq.d { background: #b38a5b; }
  @media (prefers-color-scheme: dark) {
    .gsq.l { background: #6f614a; }
    .gsq.d { background: #3d3326; }
  }
  /* Highlight the from/to squares of the most recent move. */
  .gsq.lm { box-shadow: inset 0 0 0 9999px rgba(255, 213, 79, 0.45); }
  /* Force black pieces to actually render black on light squares,
   * and use the filled (black) glyphs for both sides so contrast is
   * consistent across light/dark mode. */
  .gsq .pw { color: #fafafa; text-shadow: 0 0 1px #000, 0 0 1px #000; }
  .gsq .pb { color: #111; text-shadow: 0 0 1px #fff, 0 0 1px #fff; }
  .gmeta { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11px; }
  /* Header row above the board: mode badge (left) + started time (right). */
  .gmeta.ghead { margin-top: 0; margin-bottom: 8px; }
  .gmeta .mono { font-size: 11px; }
  .gmeta .grow { flex: 1; }
  .gev { font-weight: 600; }
  .gev.plus { color: var(--ok); }
  .gev.minus { color: var(--err); }
  .gev.even { color: var(--muted); }
  /* Turn-to-move chip on each gallery card. */
  .turn { font-weight: 600; padding: 1px 6px; border-radius: 8px; font-size: 10px; }
  .turn.bot { background: var(--accent); color: var(--bg); }
  .turn.opp { background: var(--rule); color: var(--fg); }
  /* Clock display: monospace + pulse on the side whose clock is ticking. */
  .clock { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
  .clock.live { animation: pulse 1.2s ease-in-out infinite; }
  .clock.low { color: var(--err); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
  /* Per-side line: shows who plays which color, with name + time spent.
     White-on-dark name chip keeps the player ID highly readable; the
     bot row gets a subtle accent border-left (no fill colour) so it's
     identifiable without flashing. No pulse — the 👉 marker on the
     active row is the to-move signal. */
  .sideline { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 4px; font-size: 11px; background: rgba(255, 255, 255, 0.03); min-width: 0; overflow: hidden; }
  .sideline.bot { border-left: 3px solid var(--accent); }
  .sideline.opp { border-left: 3px solid var(--rule); }
  .sideline .glyph-w { color: #fafafa; text-shadow: 0 0 1px #000, 0 0 1px #000; font-size: 14px; line-height: 1; flex-shrink: 0; }
  .sideline .glyph-b { color: #111; text-shadow: 0 0 1px #fff, 0 0 1px #fff; font-size: 14px; line-height: 1; flex-shrink: 0; }
  .sideline .namechip { display: inline-block; padding: 1px 6px; border-radius: 3px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  .sideline.bot .namechip { background: var(--accent); color: #fff; }
  .sideline.opp .namechip { background: transparent; color: var(--fg); padding-left: 0; padding-right: 0; }
  .sideline .spent { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; flex-shrink: 0; white-space: nowrap; }
  .sideline .lowtag { color: var(--err); font-weight: 600; margin-left: 4px; }
  .sideline .active-mark { font-size: 13px; line-height: 1; }
  .sideline .active-mark-gap { display: inline-block; width: 16px; }
  .sidestack { display: flex; flex-direction: column; gap: 3px; }
  .ghist { margin-top: 4px; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Engine usage pie chart. */
  .pie-wrap { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
  .pie-svg { flex: 0 0 200px; }
  .pie-legend { font-size: 12px; min-width: 240px; }
  .pie-legend table { width: 100%; }
  .pie-legend td { padding: 4px 6px; border-bottom: 1px solid var(--rule); vertical-align: middle; }
  .pie-sw { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }
  .pie-svg path { transition: opacity 0.12s ease; }
  .pie-svg path:hover { opacity: 0.7; cursor: default; }
  /* 2-col grid for the three summary charts: language spans 2 rows on the
     left (lots of entries), engine + membership stack on the right. Tight
     pie sizing inside the grid so legend + pie still fit side-by-side. */
  .chart-grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto auto; gap: 8px 24px; margin: 0 0 12px; align-items: start; }
  .chart-grid > section { min-width: 0; }
  .chart-grid .cg-tall { grid-column: 1; grid-row: 1 / span 2; }
  .chart-grid > section > h2 { margin-top: 0; }
  .chart-grid .pie-wrap { gap: 12px; }
  .chart-grid .pie-svg { flex: 0 0 150px; width: 150px; height: 150px; }
  .chart-grid .pie-legend { min-width: 0; }
  .chart-grid .pie-legend td { padding: 2px 4px; }
  @media (max-width: 640px) {
    .chart-grid { grid-template-columns: 1fr; }
    .chart-grid .cg-tall { grid-column: auto; grid-row: auto; }
  }
  /* Recent moves table — winner / fell-through indicators. */
  .winner { color: var(--ok); font-weight: 600; }
  .rejected { color: var(--muted); text-decoration: line-through; opacity: 0.7; }
  .legend { font-size: 11px; color: var(--muted); margin-bottom: 6px; }
  .legend .sw { display: inline-block; padding: 0 4px; border-radius: 3px; background: var(--code-bg); margin: 0 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  footer { margin-top: 32px; color: var(--muted); font-size: 11px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .grow { flex: 1; }
  .right { text-align: right; }
</style>
</head>
<body>
<main>
  <div class="row">
    <h1 class="grow" style="margin:0">stockfish.ross.gg</h1>
    <span id="state" class="pill muted">loading…</span>
    <a href="javascript:load()" class="pill">refresh</a>
  </div>
  <p class="sub">Autonomous chess bot on <a href="https://boardgamearena.com" target="_blank" rel="noopener">Board Game Arena</a>. Friendly games only. <span id="ticked" class="muted"></span></p>

  <h2>Stats</h2>
  <div class="row" id="diff-tabs" style="margin: 0 0 10px; gap: 6px;">
    <span id="diff-all" class="pill btn" onclick="setDiff('all')">All</span>
    <span id="diff-grandmaster" class="pill btn on" onclick="setDiff('grandmaster')" title="Default difficulty">Grandmaster*</span>
    <span id="diff-expert" class="pill btn" onclick="setDiff('expert')">Expert</span>
    <span id="diff-advanced" class="pill btn" onclick="setDiff('advanced')">Advanced</span>
    <span id="diff-intermediate" class="pill btn" onclick="setDiff('intermediate')">Intermediate</span>
    <span id="diff-easy" class="pill btn" onclick="setDiff('easy')">Easy</span>
    <span id="diff-beginner" class="pill btn" onclick="setDiff('beginner')">Beginner</span>
  </div>
  <div class="cards" id="stats"></div>
  <p class="sub" style="margin: 6px 0 0; font-size: 11px;">* default difficulty — full grandmaster-strength Stockfish (the remote engine race)</p>

  <h2>Bot rules</h2>
  <ul style="padding-left: 22px; margin: 0; font-size: 13px;">
    <li>Friendly games only. Ranked invites declined.</li>
    <li>Maintains one open invite per gamemode (realtime + turn-based).</li>
    <li>Always accepts draw offers and collective-abandon proposals.</li>
    <li>Default strength is full <span class="mono">grandmaster</span> Stockfish for both realtime and turn-based games. Send one word at any time — <span class="mono">beginner</span> / <span class="mono">easy</span> / <span class="mono">intermediate</span> / <span class="mono">advanced</span> / <span class="mono">expert</span> / <span class="mono">grandmaster</span> — to set my level.</li>
    <li>Replies <span class="mono">"I'm not sure."</span> to every opponent chat message except those exact difficulty keywords (chat otherwise treated as untrusted).</li>
    <li>Speaks to each opponent in their BGA interface language (41 supported, English fallback).</li>
    <li>After 3 consecutive errors on a table, sends a polite concession message and resigns.</li>
  </ul>

  <h2 style="margin-bottom: 6px;">Active games</h2>
  <div class="row" style="margin: 0 0 12px;">
    <span id="gmode-gallery" class="pill btn" onclick="setGamesMode('gallery')">♞ gallery</span>
    <span id="gmode-table" class="pill btn" onclick="setGamesMode('table')">≡ table</span>
  </div>
  <div id="games" class="muted">…</div>

  <h2>Open invites</h2>
  <div id="invites" class="muted">…</div>

  <div class="chart-grid">
    <section class="cg-tall">
      <h2>Opponents by language</h2>
      <div id="languages" class="muted">…</div>
    </section>
    <section>
      <h2>Engine usage</h2>
      <div id="engines" class="muted">…</div>
    </section>
    <section>
      <h2>Opponents by membership</h2>
      <p class="sub" style="margin: -2px 0 10px;">BGA premium vs. free, by finished game. Membership is read from the opponent's game-page profile, so it's only recorded for games played after this was added.</p>
      <div id="premium" class="muted">…</div>
    </section>
  </div>

  <h2>Recent moves</h2>
  <p class="sub" style="margin: -2px 0 10px;">Parallel engine race, winner picked by precedence: lichess-cloud-eval · stockfish.online · chess-api.com · rapidapi-stockfish-16 · stockfish-container · js-chess-engine (local DO) · random legal move.</p>
  <div id="moves" class="muted">…</div>

  <h2>Past Games</h2>
  <p class="sub" style="margin: -2px 0 10px;">Before each opponent: <span class="premdot">●</span> BGA Premium member · <span class="freedot">○</span> free member.</p>
  <div id="results" class="muted">…</div>

  <h2>Technical details</h2>
  <details>
    <summary style="cursor: pointer; color: var(--accent); font-size: 13px;">Running a chess engine on Cloudflare Workers — what worked, what didn't</summary>
    <div style="margin-top: 12px; font-size: 13px;">

      <h3 style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 16px 0 6px;">Architecture</h3>
      <p style="margin: 0 0 8px;">
        Each <code>/bestmove</code> call races every available engine in parallel inside the per-game
        Durable Object, capped at <code>RACE_CEILING_MS=5000</code>. When the ceiling fires (or all
        engines settle, whichever comes first) the DO picks a winner by a fixed precedence list —
        the strongest engine that returned a legal move wins. Failed engines don't block the race,
        and every engine's result is recorded in the move log so you can see who carried each move.
      </p>
      <p style="margin: 0 0 8px;">
        Precedence (strongest → weakest):
        <code>lichess-cloud-eval</code> →
        <code>chess-api.com</code> →
        <code>stockfish.online</code> →
        <code>rapidapi-stockfish-16</code> →
        <code>js-chess-engine</code> →
        random legal move.
        (<code>stockfish-container</code> sits between
        <code>rapidapi-stockfish-16</code> and <code>js-chess-engine</code>
        but its binding is currently dormant — see below.)
      </p>

      <h3 style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 16px 0 6px;">Engines we tried</h3>
      <table>
        <thead><tr><th>Engine</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          <tr>
            <td class="mono"><a href="https://chess-api.com/" target="_blank" rel="noopener">chess-api.com</a></td>
            <td class="ok">Works</td>
            <td>External wrapper around Stockfish 17. Strongest in the race when it responds in
              time, but variable latency and the occasional flake mean we never trust it alone.</td>
          </tr>
          <tr>
            <td class="mono"><a href="https://lichess.org/api#tag/Analysis/operation/apiCloudEval" target="_blank" rel="noopener">lichess-cloud-eval</a></td>
            <td class="ok">Works (cache-only)</td>
            <td>
              <code>GET lichess.org/api/cloud-eval?fen=…&amp;multiPv=1</code>. Returns
              community-cached Stockfish evaluations, typically at very deep nominal depths
              (30&ndash;75+ ply). When it hits it's authoritative and wins the race; for most
              non-opening positions it 404s silently and the next engine wins. No auth, free.
            </td>
          </tr>
          <tr>
            <td class="mono"><a href="https://stockfish.online/" target="_blank" rel="noopener">stockfish.online</a></td>
            <td class="ok">Works</td>
            <td>
              <code>GET stockfish.online/api/s/v2.php?fen=…&amp;depth=…</code> (max depth 15).
              Free, no auth. Added as a second hosted Stockfish source so the bot keeps playing
              real engine moves when <code>chess-api.com</code> rate-limits.
            </td>
          </tr>
          <tr>
            <td class="mono"><a href="https://rapidapi.com/AnyChess/api/chess-stockfish-16-api" target="_blank" rel="noopener">rapidapi-stockfish-16</a></td>
            <td class="ok">Works (when key bound)</td>
            <td>
              <code>POST chess-stockfish-16-api.p.rapidapi.com/chess/api</code>, form-urlencoded
              <code>fen=…</code> body, <code>x-rapidapi-key</code> header. Server-side depth is
              fixed at 12 (the depth param is ignored). Returns bestmove + ponder only —
              no eval, no continuation. Gated on
              <code>RAPIDAPI_STOCKFISH_KEY</code> being set; silently skipped otherwise.
            </td>
          </tr>
          <tr>
            <td class="mono"><a href="https://github.com/official-stockfish/Stockfish" target="_blank" rel="noopener">wasm-stockfish</a></td>
            <td class="err">Dropped — doesn't fit</td>
            <td>
              <code>stockfish-18-lite-single</code> (~7&nbsp;MB binary) compiled to WASM, hosted in
              a dedicated DO so OOMs couldn't take down anything else. Even with <code>Hash=1</code>,
              <code>Threads=1</code>, <code>MultiPV=1</code>, <code>SyzygyPath=&lt;empty&gt;</code>,
              <code>UCI_AnalyseMode=false</code>, the NNUE plus emscripten heap blew past the
              128&nbsp;MB DO memory cap on every call; cold-init also tended to exceed the 30&nbsp;s
              CPU budget. Removed from the race after it never produced a move in production.
            </td>
          </tr>
          <tr>
            <td class="mono"><a href="https://stockfishchess.org/" target="_blank" rel="noopener">stockfish-container</a></td>
            <td class="warn">Dormant — works, not worth the price</td>
            <td>
              Native <code>stockfish</code> in a Debian-slim container behind a small Node HTTP
              server (<code>POST /bestmove</code>, <code>Hash=16</code>, single thread, movetime
              clamped 50&ndash;2000&nbsp;ms). Wired through a Cloudflare Container Durable Object,
              built locally with colima + binfmt for cross-arch (mac arm64 → cf amd64). We
              deployed it once: warm latency ~350&nbsp;ms (beats chess-api.com), cold start ~9&nbsp;s.
              Disabled because keeping a "lite" instance perpetually warm runs ~$245/mo —
              roughly 40&times; what a $6/mo Linux VPS running the same server costs. Code stays in
              the tree; uncomment the <code>[[containers]]</code> blocks in
              <code>wrangler.toml</code> to re-enable.
            </td>
          </tr>
          <tr>
            <td class="mono"><a href="https://stockfishchess.org/" target="_blank" rel="noopener">vps-stockfish</a></td>
            <td class="muted">Planned</td>
            <td>
              The cheaper version of the container tier: a small Linux droplet running the same
              <code>server.mjs</code> as a systemd unit, behind nginx + Let's Encrypt. Worker calls
              over plain HTTPS. No cold starts, no per-second billing, no cross-arch build dance.
            </td>
          </tr>
          <tr>
            <td class="mono"><a href="https://www.npmjs.com/package/js-chess-engine" target="_blank" rel="noopener">js-chess-engine</a></td>
            <td class="ok">Works (weak)</td>
            <td>Pure-JS alpha-beta search, level 3, ~30&nbsp;KB. Always available inside the
              isolate with zero cold-start cost. Plays at roughly beginner strength but never
              times out.</td>
          </tr>
          <tr>
            <td class="mono">random legal move</td>
            <td class="warn">Used more than expected</td>
            <td>Last-resort. In practice it ends up carrying a large share of moves whenever the
              hosted Stockfish APIs are all throttling or timing out together and lichess-cloud
              misses the position (everything past the opening book). When the bot picks a random
              move it also sends an in-game chat saying so, so the opponent isn't left wondering.
              See the "Engine usage" chart above for the current breakdown.</td>
          </tr>
        </tbody>
      </table>

      <h3 style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 16px 0 6px;">Platform constraints we hit</h3>
      <ul style="padding-left: 22px; margin: 0;">
        <li><strong>128&nbsp;MB DO memory cap.</strong> The single biggest constraint. Real
          Stockfish (even the lite WASM build) plus NNUE plus the emscripten heap won't fit.</li>
        <li><strong>30&nbsp;s DO CPU per request.</strong> Cold-init of a heavy WASM module can
          eat most of it before the first <code>go movetime</code>.</li>
        <li><strong>No runtime <code>WebAssembly.instantiate</code> of raw bytes.</strong> The WASM
          binary has to be bundled as a <code>CompiledWasm</code> rule in
          <code>wrangler.toml</code> and imported as a pre-compiled module.</li>
        <li><strong>Docker required for container builds.</strong> <code>wrangler deploy</code>
          shells out to <code>docker build</code> for any Cloudflare Container, so the container
          tier is blocked on having Docker installed on whichever machine runs the deploy.</li>
        <li><strong>Cron + DO alarms for scheduling.</strong> The bot polls BGA on a 5&nbsp;s
          alarm loop inside its DO; a 1-minute Cron Trigger re-arms the alarm after deploys or
          evictions so the bot never falls silent.</li>
      </ul>

      <h3 style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 16px 0 6px;">What this means for play strength</h3>
      <p style="margin: 0 0 8px;">
        On a good day chess-api.com or lichess-cloud responds first and the bot plays at roughly
        Stockfish-17 strength. On a bad day (or when both are throttling) the move falls to
        <code>js-chess-engine</code> at level 3, or all the way down to a random legal move when
        even that misses the 5&nbsp;s ceiling. The bot is intentionally limited to friendly games
        for exactly this reason.
      </p>

      <h3 style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 16px 0 6px;">Recent findings</h3>
      <ul style="padding-left: 22px; margin: 0 0 8px;">
        <li><strong>Per-FEN move cache.</strong> Each engine race result is stored against the
          position's FEN inside the per-game DO. A later turn (in any game) that reaches the same
          FEN reuses the cached move instead of racing again. Cached moves are still re-validated
          against BGA's current legal-move table before being played, so a stale entry that no
          longer fits (castling rights changed, etc.) silently falls through to a fresh race.</li>
        <li><strong>BGA HTML lag handling.</strong> Right after the bot plays, BGA's table HTML
          still reports the bot as the active player for a few hundred milliseconds. The dashboard
          and the tick loop now flip the turn locally as soon as <code>selectCell</code> succeeds
          and gate further engine work behind an <code>awaitingOppMove</code> flag, so the bot
          doesn't try to "play again" against its own move.</li>
        <li><strong>Chat is treated as untrusted input.</strong> The bot replies <code>"I'm not
          sure."</code> to every opponent chat message. No language-model parsing, no command
          handling — chat is purely an injection surface and is answered the same way every
          time.</li>
        <li><strong>Auto-concede on repeated table errors.</strong> If the same table errors out
          three ticks in a row (HTML parse failure, repeated illegal-move rejection, etc.) the bot
          concedes that game and moves on, so one broken table can't stall the whole loop.</li>
        <li><strong>Stale invites get cleaned up.</strong> An open invite that BGA leaves stuck in
          <code>setup</code> for over 15&nbsp;minutes is closed and re-created, so a peer that
          accepted-then-vanished doesn't pin a slot forever.</li>
        <li><strong>Finished-game reconciliation.</strong> BGA's <code>finished</code> list rolls
          off quickly, so a memo whose game ended between ticks can disappear from both
          <code>play</code> and <code>finished</code>. The bot looks each missing memo up by id
          (<code>tableinfos.html?id=…</code>) and only marks it finished after three consecutive
          misses, so a transient indexing gap doesn't drop the game from stats.</li>
        <li><strong>Realtime friendly-mode quirk.</strong> Setting BGA option 201 directly to
          <code>1</code> on a freshly-created realtime table demotes it back to async. Toggling
          <code>0&nbsp;→&nbsp;1</code> instead preserves the realtime flag — that's now the order
          the bot uses when accepting a friendly invite.</li>
        <li><strong>Opponent inactivity detection.</strong> On realtime tables the bot watches
          BGA's per-player chess clock (<code>reflexion.total</code>); if the opponent overdraws
          and goes negative without playing, the bot concedes politely rather than spinning until
          a flag fall the server never reports.</li>
      </ul>
    </div>
  </details>
  <details style="margin-top: 8px;">
    <summary style="cursor: pointer; color: var(--accent); font-size: 13px;">Recent errors</summary>
    <div id="errors" class="muted" style="margin-top: 12px;">…</div>
  </details>
  <details style="margin-top: 8px;">
    <summary style="cursor: pointer; color: var(--accent); font-size: 13px;">Non-scored games (concedes, opponent quits, aborts, premium-gate voids)</summary>
    <p class="sub" style="margin: 8px 0 0;">Games that never produced a clean win/loss/draw, kept out of Past Games (and the win-rate stats) so odd terminations stay auditable here.</p>
    <div id="nonresults" class="muted" style="margin-top: 12px;">…</div>
  </details>

  <footer>
    Worker + Durable Objects on Cloudflare.
  </footer>
</main>
<script>
const fmtTime = (ts) => {
  if (!ts) return "never";
  const d = new Date(ts);
  const ago = Math.round((Date.now() - ts) / 1000);
  if (ago < 60) return ago + "s ago";
  if (ago < 3600) return Math.round(ago/60) + "m ago";
  if (ago < 86400) return Math.round(ago/3600) + "h ago";
  return d.toLocaleDateString();
};
const fmtUtc = (ts) => {
  if (!ts) return "never";
  const d = new Date(ts);
  // ISO without milliseconds, with a trailing " UTC" so it's unambiguous.
  return d.toISOString().replace(/\\.\\d{3}Z$/, "Z") + " UTC";
};
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
// Decode player names BGA leaves encoded into their real unicode form.
// Two encodings show up: JS string escapes from page JS blobs (laglo + u-esc)
// and HTML entities (&#239; / &iuml;) from HTML contexts. Run both: re-quote
// + JSON.parse handles the JS escapes (escape lives in the data, not this
// source, so the template literal can't mangle it), then the browser's own
// parser via a textarea handles any HTML entities. Keep raw on any error.
function decodeName(s) {
  if (!s) return s;
  var out = String(s);
  try { out = JSON.parse('"' + out.replace(/"/g, "") + '"'); } catch (e) {}
  if (out.indexOf("&") >= 0) {
    try { var el = document.createElement("textarea"); el.innerHTML = out; out = el.value; }
    catch (e) {}
  }
  return out;
}

async function load() {
  document.getElementById("state").textContent = "loading…";
  try {
    const r = await fetch("/bot/status", { cache: "no-store" });
    if (!r.ok) throw new Error("http " + r.status);
    render(await r.json());
  } catch (e) {
    document.getElementById("state").textContent = "error";
    document.getElementById("state").className = "pill err";
    document.getElementById("errors").innerHTML = "<div class='err'>" + esc(String(e)) + "</div>";
  }
}

function render(s) {
  window.__lastStatus = s;
  syncGamesModeButtons();
  const stateEl = document.getElementById("state");
  stateEl.textContent = s.running ? (s.loggedIn ? "running" : "running (not logged in)") : "stopped";
  stateEl.className = "pill " + (s.running && s.loggedIn ? "ok" : "warn");
  document.getElementById("ticked").textContent = "last tick: " + fmtUtc(s.lastTickAt);

  renderStats(s);

  document.getElementById("invites").innerHTML = renderInvites(s);
  // Only repaint the games section if the new snapshot would render
  // something. If a tick momentarily yields no live games (BGA flake,
  // reconcile miss) we leave the prior gallery in place rather than
  // flashing "no live games" between ticks. The placeholder "…" is
  // treated as empty so the very first load still paints.
  const gamesEl = document.getElementById("games");
  const newGamesHtml = renderGames(s);
  const newGamesHasContent = selectedLiveIds(s).live.length > 0;
  const oldGamesIsPlaceholder = gamesEl.textContent.trim() === "…"
    || gamesEl.textContent.trim() === "no live games";
  if (newGamesHasContent || oldGamesIsPlaceholder) {
    gamesEl.innerHTML = newGamesHtml;
  }
  document.getElementById("moves").innerHTML = renderMoves(s.recentMoves);
  document.getElementById("results").innerHTML = renderResults(s.recentResults);
  document.getElementById("nonresults").innerHTML = renderNonResults(s.recentResults);
  document.getElementById("engines").innerHTML = renderEngines((s.stats || {}).engineUses);
  document.getElementById("languages").innerHTML = renderLanguages(s.recentResults);
  document.getElementById("premium").innerHTML = renderPremium(s.recentResults);
  document.getElementById("errors").innerHTML = renderErrors(s.recentErrors);
}

function card(label, val, cls, suffix) {
  const sub = suffix
    ? ' <span class="muted" style="font-size: 13px; font-weight: 400;">' + esc(suffix) + '</span>'
    : '';
  return '<div class="card"><div class="label">' + esc(label) + '</div><div class="val ' + (cls||'') + '">' + esc(val) + sub + '</div></div>';
}

// Difficulty filter for the Stats cards. "all" = lifetime aggregate; the
// rest read per-difficulty counters (stats.byDifficulty) plus live tables
// whose memo difficulty matches. Default is grandmaster — the bot's name
// is bot_stockfish, so the full-Stockfish tier is the headline view.
const DIFF_KEYS = ["all", "grandmaster", "expert", "advanced", "intermediate", "easy", "beginner"];
let selectedDiff = "grandmaster";
function setDiff(d) {
  selectedDiff = DIFF_KEYS.includes(d) ? d : "grandmaster";
  syncDiffButtons();
  // The games panel is now difficulty-filtered too (selectedLiveIds), so it
  // must repaint on a tab change — and the page index may overshoot the
  // smaller filtered set, so reset to page 1.
  gamesPage = 1;
  if (window.__lastStatus) {
    renderStats(window.__lastStatus);
    document.getElementById("games").innerHTML = renderGames(window.__lastStatus);
  }
}
function syncDiffButtons() {
  for (const k of DIFF_KEYS) {
    const el = document.getElementById("diff-" + k);
    if (el) el.classList.toggle("on", k === selectedDiff);
  }
}
// Difficulty a live game is being played at: the locked effective level,
// else the opponent-chosen level, else grandmaster (the default + what
// pre-difficulty entries fall back to elsewhere).
function liveDifficulty(memo, id) {
  const m = memo[id] || {};
  return m.effectiveDifficulty || m.difficulty || "grandmaster";
}

function renderStats(s) {
  const st = s.stats || { wins: 0, losses: 0, draws: 0, concedes: 0, engineUses: {}, byDifficulty: {} };
  // "Live" uses the SAME difficulty-filtered set the gallery/table renders
  // (selectedLiveIds), so the "Live games" count can never disagree with the
  // number of cards shown below it. "Total" = BGA-scored games (wins+losses+
  // draws) plus those live tables. Concedes are excluded (mostly error/
  // abandoned states). "all" is the lifetime aggregate.
  const { live: liveIds } = selectedLiveIds(s);
  let wins, losses, draws;
  if (selectedDiff === "all") {
    wins = st.wins || 0; losses = st.losses || 0; draws = st.draws || 0;
  } else {
    const bd = (st.byDifficulty || {})[selectedDiff] || { wins: 0, losses: 0, draws: 0 };
    wins = bd.wins || 0; losses = bd.losses || 0; draws = bd.draws || 0;
  }
  const liveTables = liveIds.length;
  const pastGames = wins + losses + draws;
  const totalGames = pastGames + liveTables;
  const winPct = pastGames > 0 ? "(" + Math.round(wins * 100 / pastGames) + "%)" : null;
  document.getElementById("stats").innerHTML = [
    card("Total games", totalGames),
    card("Live games", liveTables),
    card("Wins", wins, "ok", winPct),
    card("Losses", losses, "err"),
    card("Draws", draws, "draw"),
  ].join("");
  syncDiffButtons();
}

// BGA's actual game URL is /<gameserver>/<gamename>?table=<id> — the
// gameserver number is per-table and the bot DO captures it on the
// first live-play tick (see bot-do.ts:resolveGameserver). When we don't
// know it yet (very fresh table, or older error/move records that
// outlived the memo), fall back to /table?table=<id>; BGA will bounce
// you to the player-view page from there.
function bgaUrl(id, gameserver) {
  if (gameserver != null) {
    return 'https://boardgamearena.com/' + encodeURIComponent(gameserver) + '/chess?table=' + encodeURIComponent(id);
  }
  return 'https://boardgamearena.com/table?table=' + encodeURIComponent(id);
}

function tableLink(id, gameserver) {
  if (gameserver == null && window.__lastStatus) {
    gameserver = window.__lastStatus.tables?.[id]?.gameserver;
  }
  return '<a href="' + bgaUrl(id, gameserver) + '" target="_blank" class="mono">' + esc(id) + '</a>';
}

// A live count-up timer for the "still launching" invite state. Renders the
// elapsed time since sinceMs and carries data-since so tickCountups() can
// advance it every second between the (10s) status polls.
function countup(sinceMs) {
  if (!sinceMs) return '<span class="muted">—</span>';
  return '<span class="countup mono" data-since="' + sinceMs + '">'
    + fmtClock((Date.now() - sinceMs) / 1000) + '</span>';
}

// Classify an open-invite slot into one of three visible states so a stuck
// launch is obvious at a glance:
//   - published invite (open/asyncopen): link to the joinable table + "Xm ago"
//     — the normal "waiting for a human" state.
//   - consumed into a live / just-finished game (play/asyncplay/finished, or
//     the memo is finished/conceded): a LINK to that game instead of "—".
//     There is no open invite while a realtime game is live (one realtime game
//     per account), so the slot points at the ongoing table.
//   - created but not yet visible to players (setup/init, or not in the lobby
//     snapshot yet): "Loading…" + a count-up timer. The timer climbs every
//     second and turns amber (>30s) then red (>120s), so a hung setup stands
//     out (the backend reaps a truly stuck launch at 15min).
function inviteStateCells(v, seen, s) {
  if (!v.id) {
    return '<td><span class="muted">—</span></td><td class="muted"></td>';
  }
  const t = seen.get(v.id);
  const m = (s.tables || {})[v.id] || {};
  const status = t && t.status;
  const created = v.createdAt ? fmtTime(v.createdAt) : "";
  const live = status === "play" || status === "asyncplay";
  const done = status === "finished" || status === "asyncfinished" || m.finished || m.conceded;
  if (status === "open" || status === "asyncopen") {
    return '<td>' + tableLink(v.id) + '</td><td class="muted">' + created + '</td>';
  }
  if (live || done) {
    const tag = done ? "finished" : "in game";
    return '<td>' + tableLink(v.id)
      + ' <span class="muted" style="font-size:11px;">' + tag + '</span></td>'
      + '<td class="muted">' + created + '</td>';
  }
  return '<td><span class="muted">Loading… </span>' + countup(v.createdAt)
    + '</td><td class="muted">' + created + '</td>';
}

function renderInvites(s) {
  const invites = s && s.openInvites;
  if (!invites) return "<span class='muted'>none</span>";
  const seen = new Map((s.lastTablesSeen || []).map(t => [t.id, t]));
  const rows = ["realtime", "async"].map(mode => {
    const v = invites[mode] || {};
    return '<tr><td>' + mode + '</td>' + inviteStateCells(v, seen, s) + '</tr>';
  }).join("");
  return '<table><thead><tr><th>Mode</th><th>Table</th><th>Created</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function liveGameIds(s) {
  const memo = s.tables || {};
  const seen = new Map((s.lastTablesSeen || []).map(t => [t.id, t]));
  const ids = Array.from(new Set([...Object.keys(memo), ...seen.keys()]));
  // Live = actually being played. Open invites (status: open/asyncopen/
  // setup/init) live in the "Open invites" section instead.
  const live = ids.filter(id => {
    const m = memo[id] || {};
    if (m.finished || m.conceded) return false;
    const t = seen.get(id);
    if (!t) return false;
    return t.status === "play" || t.status === "asyncplay";
  });
  // Most-recently-started first.
  live.sort((a, b) => (memo[b]?.startedAt || 0) - (memo[a]?.startedAt || 0));
  return { live, memo, seen };
}

// Live game ids honoring the active difficulty tab. Both the Stats "Live
// games" card and the gallery/table render from THIS set so the count and the
// cards always agree (the bug where Stats showed 5 grandmaster games while the
// gallery rendered all 9). "all" returns every live game; a specific tier
// returns only games being played at that tier. The "hidden" count is how
// many live games the current filter is suppressing, so the panel can hint.
function selectedLiveIds(s) {
  const { live, memo, seen } = liveGameIds(s);
  if (selectedDiff === "all") return { live, memo, seen, hidden: 0 };
  const filtered = live.filter(id => liveDifficulty(memo, id) === selectedDiff);
  return { live: filtered, memo, seen, hidden: live.length - filtered.length };
}

// Page size by view: gallery is image-heavy so fewer per page; table is
// dense so more fit comfortably without scroll fatigue.
const GAMES_PAGE_SIZE = { gallery: 8, table: 20 };
const MOVES_PAGE_SIZE = 10;
const ERRORS_PAGE_SIZE = 10;
const RESULTS_PAGE_SIZE = 10;
const NONRESULTS_PAGE_SIZE = 10;
const MOVES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let gamesPage = 1, movesPage = 1, errorsPage = 1, resultsPage = 1, nonResultsPage = 1;
function setGamesPage(p) {
  gamesPage = Math.max(1, p | 0);
  if (window.__lastStatus) document.getElementById("games").innerHTML = renderGames(window.__lastStatus);
}
function setMovesPage(p) {
  movesPage = Math.max(1, p | 0);
  if (window.__lastStatus) document.getElementById("moves").innerHTML = renderMoves(window.__lastStatus.recentMoves);
}
function setErrorsPage(p) {
  errorsPage = Math.max(1, p | 0);
  if (window.__lastStatus) document.getElementById("errors").innerHTML = renderErrors(window.__lastStatus.recentErrors);
}
function setResultsPage(p) {
  resultsPage = Math.max(1, p | 0);
  if (window.__lastStatus) document.getElementById("results").innerHTML = renderResults(window.__lastStatus.recentResults);
}
function setNonResultsPage(p) {
  nonResultsPage = Math.max(1, p | 0);
  if (window.__lastStatus) document.getElementById("nonresults").innerHTML = renderNonResults(window.__lastStatus.recentResults);
}

function renderGames(s) {
  const mode = gamesMode();
  return mode === "table" ? renderGamesTable(s) : renderGamesGallery(s);
}

// Generic pager. getter is a global function name (e.g. "setGamesPage")
// taking a 1-based page index. noun is the unit (games / moves / errors).
function pager(total, perPage, curPage, getter, noun) {
  if (total <= perPage) return "";
  const pages = Math.ceil(total / perPage);
  if (curPage > pages) curPage = pages;
  const btn = (p, label, disabled) => disabled
    ? '<span class="pill muted">' + label + '</span>'
    : '<a href="javascript:' + getter + '(' + p + ')" class="pill' + (p === curPage ? ' btn on' : '') + '">' + label + '</a>';
  const parts = [btn(curPage - 1, "‹ prev", curPage === 1)];
  const wnd = 2;
  const lo = Math.max(2, curPage - wnd);
  const hi = Math.min(pages - 1, curPage + wnd);
  parts.push(btn(1, "1"));
  if (lo > 2) parts.push('<span class="muted">…</span>');
  for (let p = lo; p <= hi; p++) parts.push(btn(p, String(p)));
  if (hi < pages - 1) parts.push('<span class="muted">…</span>');
  if (pages > 1) parts.push(btn(pages, String(pages)));
  parts.push(btn(curPage + 1, "next ›", curPage === pages));
  return '<div class="row" style="margin-top: 12px; gap: 4px;">'
    + parts.join("")
    + '<span class="muted" style="margin-left: 8px; font-size: 11px;">'
    + total + ' ' + noun + ' · page ' + curPage + '/' + pages + '</span>'
    + '</div>';
}

function paginate(arr, perPage, curPage) {
  const pages = Math.max(1, Math.ceil(arr.length / perPage));
  const cur = Math.min(curPage, pages);
  const start = (cur - 1) * perPage;
  return arr.slice(start, start + perPage);
}

// Banner shown above the games panel when a difficulty tab is hiding live
// games played at other tiers, so a small "Live games: 5" next to 9 running
// boards reads as a filter, not a bug. Click jumps to the "all" tab.
function liveFilterHint(hidden) {
  if (selectedDiff === "all" || !hidden) return "";
  return '<div class="muted" style="margin-bottom: 10px; font-size: 12px;">'
    + 'showing <b>' + esc(selectedDiff) + '</b> games · '
    + hidden + ' more live at other difficulties · '
    + '<a href="javascript:setDiff(&#39;all&#39;)" class="pill">show all</a>'
    + '</div>';
}

function renderGamesTable(s) {
  const { live: all, memo, seen, hidden } = selectedLiveIds(s);
  if (all.length === 0) {
    return hidden
      ? liveFilterHint(hidden) + "<span class='muted'>no live games at this difficulty</span>"
      : "<span class='muted'>no live games</span>";
  }
  const perPage = GAMES_PAGE_SIZE.table;
  const live = paginate(all, perPage, gamesPage);
  const movesByTable = new Map();
  for (const mv of s.recentMoves || []) {
    if (!movesByTable.has(mv.tableId)) movesByTable.set(mv.tableId, []);
    movesByTable.get(mv.tableId).push(mv);
  }
  const rows = live.map(id => {
    const m = memo[id] || {};
    const t = seen.get(id) || {};
    const clocks = clocksHtml(m, m.oppName);
    const lastMove = (m.lastMoveFrom && m.lastMoveTo)
      ? '<span class="mono">' + esc(m.lastMoveFrom) + esc(m.lastMoveTo) + '</span>'
      : '<span class="muted">—</span>';
    const ev = evalPill(m.lastEval);
    const hist = historyLine(movesByTable.get(id) || []);
    const histCell = hist
      ? '<span class="mono muted" style="font-size: 11px;">' + hist + '</span>'
      : '<span class="muted">—</span>';
    const started = m.startedAt ? fmtTime(m.startedAt) : '<span class="muted">—</span>';
    const errBadge = m.errorCount ? ' <span class="warn">·err' + m.errorCount + '</span>' : "";
    const isRt = t.status === "play";
    const modeCls = isRt ? "rt" : "tb";
    const modeBadge = '<span class="gmode ' + modeCls + '" title="' + (isRt ? 'Realtime game' : 'Turn-based (async) game') + '">'
      + (isRt ? '⚡ live' : '✉ turn-based') + '</span>';
    return '<tr>'
      + '<td>' + tableLink(id) + '</td>'
      + '<td>' + modeBadge + '</td>'
      + '<td>' + clocks + '</td>'
      + '<td>' + lastMove + '</td>'
      + '<td>' + ev + '</td>'
      + '<td>' + histCell + '</td>'
      + '<td class="muted">' + started + errBadge + '</td>'
      + '</tr>';
  }).join("");
  return liveFilterHint(hidden)
    + '<table><thead><tr>'
    + '<th>Table</th><th>Mode</th><th>Players (👉 = to move)</th><th>Last</th><th>Eval</th><th>Recent</th><th>Started</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + pager(all.length, perPage, gamesPage, "setGamesPage", "games");
}

function renderGamesGallery(s) {
  const { live: all, memo, seen, hidden } = selectedLiveIds(s);
  if (all.length === 0) {
    return hidden
      ? liveFilterHint(hidden) + "<span class='muted'>no live games at this difficulty</span>"
      : "<span class='muted'>no live games</span>";
  }
  const perPage = GAMES_PAGE_SIZE.gallery;
  const live = paginate(all, perPage, gamesPage);
  const movesByTable = new Map();
  for (const mv of s.recentMoves || []) {
    if (!movesByTable.has(mv.tableId)) movesByTable.set(mv.tableId, []);
    movesByTable.get(mv.tableId).push(mv);
  }
  const cards = live.map(id => {
    const m = memo[id] || {};
    const t = seen.get(id) || {};
    const url = bgaUrl(id, m.gameserver);
    const board = boardHtml(m.lastBoardFen, m.lastMoveFrom, m.lastMoveTo);
    const ev = evalPill(m.lastEval);
    const clocks = clocksHtml(m, m.oppName);
    const hist = historyLine(movesByTable.get(id) || []);
    const lastMv = (m.lastMoveFrom && m.lastMoveTo)
      ? '<span class="mono muted" style="font-size: 11px;">last: ' + esc(m.lastMoveFrom) + esc(m.lastMoveTo) + '</span>'
      : '';
    const isRt = t.status === "play";
    const modeCls = isRt ? "rt" : "tb";
    const modeBadge = '<span class="gmode ' + modeCls + '" title="' + (isRt ? 'Realtime game' : 'Turn-based (async) game') + '">'
      + (isRt ? '⚡ live' : '✉ turn-based') + '</span>';
    return '<a class="gcard ' + modeCls + '" href="' + url + '" target="_blank" rel="noopener" title="' + esc(id) + ' · ' + esc(t.status || "?") + '">'
      + '<div class="gmeta ghead">'
      +   modeBadge
      +   '<span class="grow"></span>'
      +   '<span class="muted">' + (m.startedAt ? fmtTime(m.startedAt) : "—") + '</span>'
      + '</div>'
      + board
      + '<div class="gmeta">'
      +   lastMv
      +   '<span class="grow"></span>'
      +   ev
      + '</div>'
      + clocks
      + (hist ? '<div class="ghist">' + hist + '</div>' : '')
      + '<div class="gmeta">'
      +   '<span class="mono muted grow">' + esc(id) + '</span>'
      + '</div>'
      + '</a>';
  }).join("");
  return liveFilterHint(hidden)
    + '<div class="gallery">' + cards + '</div>'
    + pager(all.length, perPage, gamesPage, "setGamesPage", "games");
}

function fmtClock(secs) {
  if (secs == null || !Number.isFinite(secs)) return "—";
  const sign = secs < 0 ? "-" : "";
  const s = Math.abs(Math.round(secs));
  if (s >= 86400) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return sign + d + "d" + (h ? " " + h + "h" : "");
  }
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return sign + h + "h" + String(m).padStart(2, "0");
  }
  const m = Math.floor(s / 60);
  const r = s % 60;
  return sign + m + ":" + String(r).padStart(2, "0");
}

// Time spent on the clock = start − current. start is captured the first
// non-null tick we see, so it converges to BGA's initial reflexion within
// one observation. Returns null if we don't have both values yet.
function spentSecs(start, current) {
  if (start == null || current == null) return null;
  const s = start - current;
  return s >= 0 ? s : 0;
}

function fmtSpent(s) {
  if (s == null || !Number.isFinite(s)) return "—";
  const n = Math.max(0, Math.round(s));
  if (n < 60) return n + "s";
  if (n < 3600) return Math.floor(n / 60) + "m" + String(n % 60).padStart(2, "0");
  if (n < 86400) {
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    return h + "h" + (m ? String(m).padStart(2, "0") : "");
  }
  const d = Math.floor(n / 86400);
  const h = Math.floor((n % 86400) / 3600);
  return d + "d" + (h ? h + "h" : "");
}

// One side's row: a 👉 marker for the active player, color-block (which
// colour they play), label (bot / opp name), time spent, and a
// low-clock warning if applicable. The "bot" row is visually distinct
// (accent stripe + tinted background) so it's obvious at a glance which
// colour the bot is playing.
function sideLine(opts) {
  // opts: { isBot, color, label, spent, remaining, isLive }
  const color = opts.color === "black" ? "black" : "white";
  const glyph = color === "white" ? "♔" : "♚";
  const glyphCls = color === "white" ? "glyph-w" : "glyph-b";
  const colorTitle = color === "white" ? "White" : "Black";
  const lowTag = (opts.remaining != null && opts.remaining < 60)
    ? '<span class="lowtag">' + fmtClock(opts.remaining) + ' left</span>'
    : "";
  const lineCls = "sideline" + (opts.isBot ? " bot" : " opp");
  const activeMarker = opts.isLive
    ? '<span class="active-mark" title="to move">👉</span>'
    : '<span class="active-mark-gap"></span>';
  return '<div class="' + lineCls + '">'
    + activeMarker
    + '<span class="' + glyphCls + '" title="' + colorTitle + '">' + glyph + '</span>'
    + '<span class="namechip">' + esc(opts.label) + '</span>'
    + '<span class="grow" style="flex:1"></span>'
    + '<span class="spent">' + fmtSpent(opts.spent) + '</span>'
    + lowTag
    + '</div>';
}

function clocksHtml(m, oppName) {
  const botLive = m.lastTurn === "bot";
  const oppLive = m.lastTurn === "opp";
  const botColor = m.botColor || "white";
  const oppColor = botColor === "black" ? "white" : "black";
  const botSpent = spentSecs(m.botClockStart, m.botClock);
  const oppSpent = spentSecs(m.oppClockStart, m.oppClock);
  const bot = sideLine({
    isBot: true, color: botColor, label: "bot_stockfish",
    spent: botSpent, remaining: m.botClock, isLive: botLive,
  });
  const opp = sideLine({
    isBot: false, color: oppColor, label: decodeName(oppName) || "opponent",
    spent: oppSpent, remaining: m.oppClock, isLive: oppLive,
  });
  // White always on top to match the board's natural orientation, no
  // matter which side the bot is on.
  const top = botColor === "white" ? bot : opp;
  const bottom = botColor === "white" ? opp : bot;
  return '<div class="sidestack">' + top + bottom + '</div>';
}

function historyLine(moves) {
  if (!moves || moves.length === 0) return "";
  // moves are appended in time order; take the last 5 bot moves we logged.
  const last = moves.slice(-5);
  return last.map(mv => esc(mv.from) + esc(mv.to)).join(" · ");
}

// Unicode chess piece glyphs (filled, used for both colors; CSS recolors via
// the .pw / .pb spans so contrast on the wood-tone squares stays readable).
const PIECE_GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
function sqToRF(sq) {
  if (!sq || sq.length < 2) return null;
  const f = sq.charCodeAt(0) - 97;
  const r = 8 - Number(sq[1]);
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return { r, f };
}
function boardHtml(fen, fromSq, toSq) {
  const placement = (fen || "").split(" ")[0] || "";
  const from = sqToRF(fromSq);
  const to = sqToRF(toSq);
  // Expand FEN rows ("rnbqkbnr/...") into 64 cells (rank 8 first).
  const cells = [];
  const rows = placement.split("/");
  for (let r = 0; r < 8; r++) {
    const row = rows[r] || "";
    const expanded = [];
    for (const ch of row) {
      if (/[1-8]/.test(ch)) for (let i = 0; i < Number(ch); i++) expanded.push(null);
      else expanded.push(ch);
    }
    while (expanded.length < 8) expanded.push(null);
    for (let f = 0; f < 8; f++) {
      const isLight = (r + f) % 2 === 0;
      const piece = expanded[f];
      let glyph = "";
      if (piece) {
        const isWhite = piece === piece.toUpperCase();
        const g = PIECE_GLYPH[piece.toLowerCase()] || "";
        glyph = '<span class="' + (isWhite ? "pw" : "pb") + '">' + g + '</span>';
      }
      const lm = (from && from.r === r && from.f === f) || (to && to.r === r && to.f === f);
      cells.push('<div class="gsq ' + (isLight ? "l" : "d") + (lm ? " lm" : "") + '">' + glyph + '</div>');
    }
  }
  return '<div class="gboard">' + cells.join("") + '</div>';
}

function evalPill(ev) {
  // Eval is stored from the bot's perspective (positive = bot winning), so
  // every tooltip is framed around the bot rather than White.
  if (!ev) return '<span class="muted">?</span>';
  if (ev.mate != null && ev.mate !== 0) {
    const n = Math.abs(ev.mate);
    const cls = ev.mate > 0 ? "plus" : "minus";
    const tip = ev.mate > 0 ? "bot mates in " + n : "bot gets mated in " + n;
    return '<span class="gev ' + cls + '" title="' + tip + '">M' + n + '</span>';
  }
  if (ev.cp == null) return '<span class="muted">?</span>';
  const cp = Number(ev.cp);
  const cls = cp > 0.2 ? "plus" : (cp < -0.2 ? "minus" : "even");
  const sign = cp > 0 ? "+" : "";
  const tip = cp > 0.2 ? "bot ahead by " + cp.toFixed(1) + " pawns"
    : (cp < -0.2 ? "bot behind by " + Math.abs(cp).toFixed(1) + " pawns" : "roughly even");
  return '<span class="gev ' + cls + '" title="' + tip + '">' + sign + cp.toFixed(1) + '</span>';
}

function gamesMode() {
  try {
    const v = localStorage.getItem("gamesMode");
    // legacy: "minimal" was the old name for "table"
    if (v === "minimal") return "table";
    return v === "table" ? "table" : "gallery";
  } catch (e) { return "gallery"; }
}
function setGamesMode(mode) {
  try { localStorage.setItem("gamesMode", mode); } catch (e) {}
  gamesPage = 1;
  syncGamesModeButtons();
  // Re-render from the most recent payload if we have it; otherwise just
  // refresh from the server.
  if (window.__lastStatus) document.getElementById("games").innerHTML = renderGames(window.__lastStatus);
  else load();
}
function syncGamesModeButtons() {
  const mode = gamesMode();
  const tbl = document.getElementById("gmode-table");
  const gal = document.getElementById("gmode-gallery");
  if (tbl) tbl.classList.toggle("on", mode === "table");
  if (gal) gal.classList.toggle("on", mode === "gallery");
}

// Engines we care about as columns, in precedence order. wasm-stockfish was
// dropped from the race after exhausting the 128MB DO budget on every call.
const MOVE_ENGINE_COLUMNS = [
  "lichess-cloud-eval",
  "stockfish.online",
  "chess-api.com",
  "rapidapi-stockfish-16",
  "stockfish-container",
  "js-chess-engine (local DO)",
];

const ENGINE_LABELS = {
  "lichess-cloud-eval": "lichess",
  "rapidapi-stockfish-16": "rapidapi",
  "js-chess-engine (local DO)": "js-chess-engine",
};
function shortEngine(e) {
  return ENGINE_LABELS[e] || e.replace(/\\s*\\(.*\\)\\s*$/, "");
}
// Same shortening, but preserves a leading "cache:" prefix so cache-hit
// rows in the engine-usage chart stay distinguishable from live races.
function shortEngineWithCache(e) {
  if (typeof e === "string" && e.indexOf("cache:") === 0) {
    return "cache:" + shortEngine(e.slice("cache:".length));
  }
  return shortEngine(e);
}

// Homepage / docs for each engine, so the usage legend and the "Engines we
// tried" table link out to the source. random-fallback has no page.
const ENGINE_LINKS = {
  "lichess-cloud-eval": "https://lichess.org/api#tag/Analysis/operation/apiCloudEval",
  "stockfish.online": "https://stockfish.online/",
  "chess-api.com": "https://chess-api.com/",
  "rapidapi-stockfish-16": "https://rapidapi.com/AnyChess/api/chess-stockfish-16-api",
  "stockfish-container": "https://stockfishchess.org/",
  "js-chess-engine (local DO)": "https://www.npmjs.com/package/js-chess-engine",
};
// Wrap an engine key's display text in a link to its page when we have one.
// A "cache:<engine>" key links to the same homepage as the underlying engine.
function engineNameHtml(key, text) {
  const baseKey = typeof key === "string" && key.indexOf("cache:") === 0
    ? key.slice("cache:".length) : key;
  const href = ENGINE_LINKS[baseKey];
  const display = text == null ? shortEngineWithCache(key) : text;
  const label = '<span class="mono">' + esc(display) + '</span>';
  return href
    ? '<a href="' + href + '" target="_blank" rel="noopener">' + label + '</a>'
    : label;
}

// Past-games "Lang" column: BGA interface-language code → flag + name. The
// flag is a representative country (languages aren't 1:1 with flags), good
// enough for an at-a-glance column.
const LANG_DISPLAY = {
  ar: "🇸🇦 Arabic", be: "🇧🇾 Belarusian", bg: "🇧🇬 Bulgarian", br: "🇫🇷 Breton",
  ca: "🇪🇸 Catalan", cs: "🇨🇿 Czech", da: "🇩🇰 Danish", de: "🇩🇪 German",
  el: "🇬🇷 Greek", en: "🇬🇧 English", es: "🇪🇸 Spanish", et: "🇪🇪 Estonian",
  fa: "🇮🇷 Persian", fi: "🇫🇮 Finnish", fr: "🇫🇷 French", gl: "🇪🇸 Galician",
  he: "🇮🇱 Hebrew", hr: "🇭🇷 Croatian", hu: "🇭🇺 Hungarian", id: "🇮🇩 Indonesian",
  it: "🇮🇹 Italian", ja: "🇯🇵 Japanese", ko: "🇰🇷 Korean", lt: "🇱🇹 Lithuanian",
  lv: "🇱🇻 Latvian", ms: "🇲🇾 Malay", nl: "🇳🇱 Dutch", no: "🇳🇴 Norwegian",
  pl: "🇵🇱 Polish", pt: "🇵🇹 Portuguese", ro: "🇷🇴 Romanian", ru: "🇷🇺 Russian",
  sk: "🇸🇰 Slovak", sl: "🇸🇮 Slovenian", sr: "🇷🇸 Serbian", sv: "🇸🇪 Swedish",
  th: "🇹🇭 Thai", tr: "🇹🇷 Turkish", uk: "🇺🇦 Ukrainian", vi: "🇻🇳 Vietnamese",
  zh: "🇨🇳 Chinese",
};

function renderMoves(moves) {
  if (!moves || moves.length === 0) return "<span class='muted'>no moves yet</span>";
  // Drop moves older than 24h; keep newest first.
  const cutoff = Date.now() - MOVES_MAX_AGE_MS;
  const all = moves.slice().reverse().filter(m => (m.ts || 0) >= cutoff);
  if (all.length === 0) return "<span class='muted'>no moves in the last 24h</span>";
  const recent = paginate(all, MOVES_PAGE_SIZE, movesPage);
  // Track which engines actually appeared in this window (from a live race
  // or as a cache-hit source) so dormant engines can stay hidden.
  const seen = new Set();
  recent.forEach(m => {
    (m.engineResults || []).forEach(r => seen.add(r.engine));
    if (typeof m.engine === "string" && m.engine.startsWith("cache:")) {
      seen.add(m.engine.slice("cache:".length));
    }
  });
  // Always show the standard (non-dormant) race engines so the table stays
  // consistent — otherwise a window of only realtime moves (which use just
  // the local js-chess-engine) collapses every other column. Engines not
  // consulted for a given move render "—". The dormant stockfish-container
  // only appears if it was actually seen.
  const cols = MOVE_ENGINE_COLUMNS.filter(e =>
    e === "stockfish-container" ? seen.has(e) : true,
  );
  const headers = cols.map(e =>
    '<th class="mono" style="font-size: 10px" title="' + esc(e) + '">' + esc(shortEngine(e)) + '</th>'
  ).join("");
  const legend = '<div class="legend">'
    + '<span class="sw winner">👉 e2e4</span> chosen move · '
    + '<span class="sw">⊘ <span class="rejected">e2e4</span></span> engine move BGA refused · '
    + '<span class="sw">💾 e2e4</span> served from that engine\\'s cached verdict'
    + '</div>';
  const rows = recent.map(m => {
    const byEngine = new Map((m.engineResults || []).map(r => [r.engine, r]));
    // Race winner = leftmost (highest-precedence) engine that returned a non-error move.
    let raceWinner = null;
    for (const e of cols) {
      const r = byEngine.get(e);
      if (r && !r.error && r.move) { raceWinner = e; break; }
    }
    const chosenIsListed = cols.includes(m.engine);
    const fellThrough = chosenIsListed && raceWinner && raceWinner !== m.engine;
    // Cache hits carry engine = "cache:<name>" and no engineResults. Mark
    // the move in that engine's own column rather than leaving the whole
    // row blank.
    const cacheEngine = typeof m.engine === "string" && m.engine.startsWith("cache:")
      ? m.engine.slice("cache:".length) : null;
    const cells = cols.map(e => {
      const r = byEngine.get(e);
      if (cacheEngine && e === cacheEngine && !r) {
        return '<td title="served from cache (prior ' + esc(e) + ' verdict)">'
          + '<span class="mono muted">💾 ' + esc(m.from + m.to) + '</span></td>';
      }
      const isChosen = m.engine === e;
      const isRejectedWinner = fellThrough && e === raceWinner;
      return renderEngineCell(r, isChosen, isRejectedWinner);
    });
    const movePill = m.engine === "random-fallback"
      ? ' <span class="pill warn" title="no engine produced a usable move">🎲 Random</span>'
      : "";
    return '<tr>'
      + '<td class="muted">' + fmtTime(m.ts) + '</td>'
      + '<td>' + tableLink(m.tableId) + '</td>'
      + '<td class="mono">' + esc(m.from) + ' → ' + esc(m.to) + movePill + '</td>'
      + cells.join("")
      + '</tr>';
  }).join("");
  return legend
    + '<table><thead><tr>'
    + '<th>When</th><th>Table</th><th>Move</th>' + headers
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + pager(all.length, MOVES_PAGE_SIZE, movesPage, "setMovesPage", "moves (24h)");
}

// A clean, BGA-scored game (win/loss/draw). Everything else (tally "none":
// concedes, opponent-quits, aborts, premium-gate voids, unparseable finishes)
// is split out into the troubleshooting table — see renderNonResults.
function isScored(r) {
  return r.tally === "win" || r.tally === "loss" || r.tally === "draw";
}

// Premium marker shown before an opponent's name in the games tables.
// oppPremium is boolean | undefined (read from the opponent's game-page
// profile): filled green dot = BGA Premium, hollow muted dot = free member,
// nothing = unknown (entries predating the field). Trailing space separates
// the dot from the name that follows.
function premiumDot(oppPremium) {
  if (oppPremium === true) {
    return '<span class="premdot" title="BGA Premium member">●</span>';
  }
  if (oppPremium === false) {
    return '<span class="freedot" title="Free member">○</span>';
  }
  return "";
}

function renderResults(results) {
  // Only clean win/loss/draw games belong in Past Games; non-scored games
  // live in the "Non-scored games" troubleshooting table under Technical
  // details so they don't muddy the win-rate view.
  const all = (results || []).filter(isScored).reverse();
  if (all.length === 0) {
    return "<span class='muted'>no finished games yet</span>";
  }
  // Newest first, paginated.
  const page = paginate(all, RESULTS_PAGE_SIZE, resultsPage);
  const dash = '<span class="muted">—</span>';
  const rows = page.map(r => {
    const tallyClass = r.tally === "win" ? "ok"
      : r.tally === "loss" ? "err"
      : r.tally === "draw" ? "" : "warn";
    // Fold the old Status / Raw score / Parsed columns into the tally
    // pill's hover so they stay auditable without three dedicated columns.
    const tip = 'status: ' + (r.status || "?")
      + ' · raw: ' + (r.rawScore == null ? "null" : r.rawScore)
      + ' · parsed: ' + (r.parsedScore == null ? "null" : r.parsedScore);
    const tallyLabel = r.tally === "none"
      ? '<span class="pill warn" title="' + esc(tip) + ' (did not match 0 / 0.5 / 1)">uncounted</span>'
      : '<span class="pill ' + tallyClass + '" title="' + esc(tip) + '">' + esc(r.tally) + '</span>';
    const oppNameDec = decodeName(r.oppName);
    const opp = r.oppName
      ? premiumDot(r.oppPremium) + (r.oppId
        ? '<a href="https://boardgamearena.com/player?id=' + esc(r.oppId) + '" target="_blank" rel="noopener">' + esc(oppNameDec) + '</a>'
        : esc(oppNameDec))
      : dash;
    const lang = r.oppLanguage ? (LANG_DISPLAY[r.oppLanguage] || ('🏳️ ' + esc(r.oppLanguage))) : dash;
    const color = r.botColor ? '<span class="mono muted">' + esc(r.botColor) + '</span>' : dash;
    // Entries predating the difficulty feature are grandmaster by default.
    const diff = '<span class="mono">' + esc(r.difficulty || "grandmaster") + '</span>';
    const moves = r.moveCount == null ? dash : '<span class="mono">' + esc(r.moveCount) + '</span>';
    const dur = r.durationMs == null ? dash : '<span class="mono">' + esc(fmtClock(r.durationMs / 1000)) + '</span>';
    // Live = realtime game (orange dot); blank for turn-based; dash if the
    // entry predates the field / status was ambiguous.
    const live = r.realtime === true
      ? '<span class="livedot" title="Realtime game">●</span>'
      : r.realtime === false ? '' : dash;
    return '<tr>'
      + '<td class="muted">' + fmtTime(r.ts) + '</td>'
      + '<td>' + tableLink(r.tableId) + '</td>'
      + '<td style="text-align:center">' + live + '</td>'
      + '<td>' + opp + '</td>'
      + '<td>' + lang + '</td>'
      + '<td>' + color + '</td>'
      + '<td>' + diff + '</td>'
      + '<td>' + moves + '</td>'
      + '<td>' + dur + '</td>'
      + '<td>' + tallyLabel + '</td>'
      + '</tr>';
  }).join("");
  return '<table><thead><tr>'
    + '<th>When</th><th>Table</th><th title="Orange = realtime game">Live</th><th>Opponent</th><th>Lang</th><th>Color</th><th>Difficulty</th><th>Moves</th><th>Duration</th><th>Tally</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + pager(all.length, RESULTS_PAGE_SIZE, resultsPage, "setResultsPage", "games");
}

// Human-readable label for a non-scored game's reason code (see
// recordNonResult / ConcedeReason in bot-do.ts).
const NONRESULT_REASONS = {
  "errors": "Bot errored out",
  "tableAge": "Game expired",
  "lostSeat": "Lost seat",
  "oppQuit": "Opponent quit",
  "opponentInactivity": "Opponent inactive",
  "premium:realtime-free": "Premium gate: realtime",
  "premium:async-limit": "Premium gate: 2nd async",
  // Legacy uncountedReason codes from a since-removed scorer guard.
  "no-moves": "No moves played",
  "neutralized": "Neutralized / abandoned",
};
function nonResultReason(r) {
  if (r.reason) return NONRESULT_REASONS[r.reason] || r.reason;
  // Legacy backlog: a since-removed guard force-marked some scored games
  // "none" and recorded why in uncountedReason. /bot/retally-unscored
  // re-tallies the ones with a clean score; the rest surface their reason.
  if (r.uncountedReason) return NONRESULT_REASONS[r.uncountedReason] || r.uncountedReason;
  // Truly unscored: a BGA finish whose score didn't parse to 0/0.5/1.
  return "Unscored finish (raw: " + (r.rawScore == null ? "null" : r.rawScore) + ")";
}

// Troubleshooting table: every game that did NOT end in a clean win/loss/draw
// — concedes, opponent-quits, aborts, premium-gate voids, unparseable BGA
// finishes. Kept out of Past Games (and the win-rate stats) but logged here so
// odd terminations are auditable.
function renderNonResults(results) {
  const all = (results || []).filter(r => !isScored(r)).reverse();
  if (all.length === 0) {
    return "<span class='muted'>no non-scored games — every finished game was a clean win/loss/draw</span>";
  }
  const page = paginate(all, NONRESULTS_PAGE_SIZE, nonResultsPage);
  const dash = '<span class="muted">—</span>';
  const rows = page.map(r => {
    const oppNameDec = decodeName(r.oppName);
    const opp = r.oppName
      ? premiumDot(r.oppPremium) + (r.oppId
        ? '<a href="https://boardgamearena.com/player?id=' + esc(r.oppId) + '" target="_blank" rel="noopener">' + esc(oppNameDec) + '</a>'
        : esc(oppNameDec))
      : dash;
    const reason = '<span class="pill warn" title="' + esc('status: ' + (r.status || "?")) + '">' + esc(nonResultReason(r)) + '</span>';
    const diff = '<span class="mono">' + esc(r.difficulty || "grandmaster") + '</span>';
    const moves = r.moveCount == null ? dash : '<span class="mono">' + esc(r.moveCount) + '</span>';
    const dur = r.durationMs == null ? dash : '<span class="mono">' + esc(fmtClock(r.durationMs / 1000)) + '</span>';
    const live = r.realtime === true
      ? '<span class="livedot" title="Realtime game">●</span>'
      : r.realtime === false ? '' : dash;
    return '<tr>'
      + '<td class="muted">' + fmtTime(r.ts) + '</td>'
      + '<td>' + tableLink(r.tableId) + '</td>'
      + '<td style="text-align:center">' + live + '</td>'
      + '<td>' + opp + '</td>'
      + '<td>' + reason + '</td>'
      + '<td>' + diff + '</td>'
      + '<td>' + moves + '</td>'
      + '<td>' + dur + '</td>'
      + '</tr>';
  }).join("");
  return '<table><thead><tr>'
    + '<th>When</th><th>Table</th><th title="Orange = realtime game">Live</th><th>Opponent</th><th>Reason</th><th>Difficulty</th><th>Moves</th><th>Duration</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + pager(all.length, NONRESULTS_PAGE_SIZE, nonResultsPage, "setNonResultsPage", "nonresults");
}

function renderEngineCell(r, isChosen, isRejectedWinner) {
  if (!r) return '<td class="muted">—</td>';
  if (r.error) {
    return '<td class="err" title="' + esc(r.error) + '">fail <span class="muted">' + r.ms + 'ms</span></td>';
  }
  if (!r.move) return '<td class="muted">no move</td>';
  if (isChosen) {
    return '<td><span class="winner mono">👉 ' + esc(r.move) + '</span>'
      + ' <span class="muted">' + r.ms + 'ms</span></td>';
  }
  if (isRejectedWinner) {
    return '<td title="BGA refused this move; bot fell through to the next engine"><span class="mono">⊘ </span>'
      + '<span class="mono rejected">' + esc(r.move) + '</span>'
      + ' <span class="muted">' + r.ms + 'ms</span></td>';
  }
  return '<td class="muted"><span class="mono">' + esc(r.move) + '</span>'
    + ' <span class="muted">' + r.ms + 'ms</span></td>';
}

// Colors chosen to stay legible on both light + dark backgrounds and to
// echo the wood / accent palette already on the page.
const PIE_COLORS = [
  "#b85c38", "#5b8a72", "#8a6fb0", "#c9a23a", "#3a7ca5",
  "#a8554a", "#6f8a4a", "#5e4a8a", "#b07f3f", "#4a8a8a",
];

// Shared donut/pie renderer. entries: array of [key, count]. opts:
//   label(key)  -> legend-cell HTML for the slice (default: mono span)
//   ariaLabel   -> SVG aria-label
//   unit/unit1  -> plural / singular count noun (default "moves"/"move")
// Slices are sorted by count desc and coloured from PIE_COLORS.
function pieChart(entries, opts) {
  opts = opts || {};
  const label = opts.label || (k => '<span class="mono">' + esc(k) + '</span>');
  const unit = opts.unit || "moves", unit1 = opts.unit1 || "move";
  const sorted = entries.slice().sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return null;
  const cx = 100, cy = 100, r = 95;
  let angle = -Math.PI / 2;
  const paths = sorted.map(([k, n], i) => {
    const frac = n / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const color = PIE_COLORS[i % PIE_COLORS.length];
    const pct = (100 * frac).toFixed(1);
    // Edge case: single 100% slice can't be drawn as an arc — use a circle.
    if (frac >= 0.9999) {
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + color + '"><title>' + esc(k) + ' · ' + n + ' · 100%</title></circle>';
    }
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const largeArc = (a1 - a0) > Math.PI ? 1 : 0;
    const d = "M " + cx + " " + cy
      + " L " + x0.toFixed(2) + " " + y0.toFixed(2)
      + " A " + r + " " + r + " 0 " + largeArc + " 1 " + x1.toFixed(2) + " " + y1.toFixed(2)
      + " Z";
    return '<path d="' + d + '" fill="' + color + '"><title>' + esc(k) + ' · ' + n + ' · ' + pct + '%</title></path>';
  }).join("");
  const legend = sorted.map(([k, n], i) => {
    const pct = (100 * n / total).toFixed(1);
    const count = n === 1 ? "1 " + unit1 : esc(n) + " " + unit;
    return '<tr>'
      + '<td><span class="pie-sw" style="background:' + PIE_COLORS[i % PIE_COLORS.length] + '"></span>' + label(k) + '</td>'
      + '<td class="right">' + count + '</td>'
      + '<td class="right muted">' + pct + '%</td>'
      + '</tr>';
  }).join("");
  return '<div class="pie-wrap">'
    + '<svg class="pie-svg" viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="' + esc(opts.ariaLabel || "pie chart") + '">' + paths + '</svg>'
    + '<div class="pie-legend"><table><tbody>' + legend + '</tbody></table></div>'
    + '</div>';
}

function renderEngines(uses) {
  const chart = pieChart(Object.entries(uses || {}), {
    label: k => engineNameHtml(k),
    ariaLabel: "engine usage pie chart",
    unit: "moves", unit1: "move",
  });
  return chart || "<span class='muted'>no engine calls yet</span>";
}

// Count finished games by a per-result key (e.g. opponent language). Only
// games with the field set are counted, so the chart reflects detected data.
function countResults(results, keyOf) {
  const counts = {};
  for (const r of results || []) {
    const k = keyOf(r);
    if (k == null || k === "") continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts);
}

function renderLanguages(results) {
  const chart = pieChart(countResults(results, r => r.oppLanguage), {
    label: k => '<span>' + (LANG_DISPLAY[k] || ('🏳️ ' + esc(k))) + '</span>',
    ariaLabel: "opponents by language pie chart",
    unit: "games", unit1: "game",
  });
  return chart || "<span class='muted'>no opponent languages recorded yet</span>";
}

function renderPremium(results) {
  // oppPremium is boolean | undefined; bucket the two known states and ignore
  // games where membership wasn't detected.
  const chart = pieChart(
    countResults(results, r => r.oppPremium === true ? "Premium"
      : r.oppPremium === false ? "Free" : null),
    {
      label: k => '<span class="' + (k === "Premium" ? "ok" : "muted") + '">' + esc(k) + '</span>',
      ariaLabel: "opponents by membership pie chart",
      unit: "games", unit1: "game",
    },
  );
  return chart || "<span class='muted'>no opponent membership recorded yet</span>";
}

function renderErrors(errors) {
  if (!errors || errors.length === 0) return "<span class='muted'>no recent errors</span>";
  const all = errors.slice().reverse();
  const page = paginate(all, ERRORS_PAGE_SIZE, errorsPage);
  const rows = page.map(e => {
    const tcell = e.tableId ? tableLink(e.tableId) : '<span class="muted">—</span>';
    return '<tr><td class="muted">' + fmtTime(e.ts) + '</td><td class="mono">' + esc(e.scope) + '</td><td>' + tcell + '</td><td class="mono err">' + esc(e.msg) + '</td></tr>';
  }).join("");
  return '<table><thead><tr><th>When</th><th>Scope</th><th>Table</th><th>Message</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + pager(all.length, ERRORS_PAGE_SIZE, errorsPage, "setErrorsPage", "errors");
}

// Advance the "Loading…" invite count-up timers every second (the status
// poll is only every 10s). A normal setup clears within a few seconds; a hung
// one keeps climbing and goes amber (>30s) then red (>120s) so it's obvious.
function tickCountups() {
  const now = Date.now();
  document.querySelectorAll(".countup").forEach(el => {
    const since = Number(el.getAttribute("data-since"));
    if (!since) return;
    const secs = (now - since) / 1000;
    el.textContent = fmtClock(secs);
    el.classList.toggle("muted", secs < 30);
    el.classList.toggle("warn", secs >= 30 && secs < 120);
    el.classList.toggle("err", secs >= 120);
  });
}

load();
setInterval(load, 10000);
setInterval(tickCountups, 1000);
</script>
</body>
</html>`;
}
