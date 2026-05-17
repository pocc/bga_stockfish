import { StockfishEngine } from "./stockfish-do";
import { BotDriver } from "./bot-do";

export { StockfishEngine, BotDriver };

export interface Env {
  ENGINE: DurableObjectNamespace;
  BOT: DurableObjectNamespace;
  /** BGA bot credentials — set with `wrangler secret put`. */
  BGA_USERNAME: string;
  BGA_PASSWORD: string;
  /** Admin secret for mutating /bot/* endpoints. Set with `wrangler secret put BOT_ADMIN_SECRET`.
   *  When unset, mutating endpoints are blocked from external callers. */
  BOT_ADMIN_SECRET?: string;
}

function botStub(env: Env) {
  // Single global bot singleton — one account, one driver.
  return env.BOT.get(env.BOT.idFromName("singleton"));
}

/** Returns true when the request carries the admin secret (header or query). */
function isAdmin(req: Request, env: Env): boolean {
  const expected = env.BOT_ADMIN_SECRET;
  if (!expected) return false;
  const url = new URL(req.url);
  const fromHeader = req.headers.get("x-admin-secret");
  const fromQuery = url.searchParams.get("secret");
  return fromHeader === expected || fromQuery === expected;
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
          "POST /bestmove": "{ fen: string, movetime?: number, depth?: number, gameId?: string }",
          "GET /health": "this",
          "GET /bot/status": "public bot diagnostic snapshot",
        },
      });
    }

    if (url.pathname === "/bestmove" && req.method === "POST") {
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

    // Mutating bot endpoints require the admin secret. The internal cron
    // handler calls the DO stub directly and bypasses this fetch handler,
    // so it doesn't need the secret.
    const mutatingBot = new Set([
      "/bot/start", "/bot/stop", "/bot/tick", "/bot/cleanup",
      "/bot/probe", "/bot/wipe",
    ]);
    if (mutatingBot.has(url.pathname)) {
      if (!isAdmin(req, env)) return unauthorized();
      const subpath = url.pathname.replace(/^\/bot/, "");
      const method = url.pathname === "/bot/status" ? "GET" : "POST";
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
    // /start is idempotent; it ensures running=true and arms the alarm.
    await stub.fetch("https://do/start", { method: "POST" });
    await stub.fetch("https://do/tick");
  },
};

function landingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>stockfish.ross.gg</title>
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
  .card { background: var(--code-bg); padding: 10px 12px; border-radius: 6px; }
  .card .label { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  .card .val { font-size: 22px; font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--rule); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  .ok { color: var(--ok); }
  .warn { color: var(--warn); }
  .err { color: var(--err); }
  .muted { color: var(--muted); }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 10px; background: var(--code-bg); font-size: 11px; }
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
  <p class="sub">Autonomous chess bot on BGA. Friendly games only. <span id="ticked" class="muted"></span></p>

  <h2>Stats</h2>
  <div class="cards" id="stats"></div>

  <h2>Open invites</h2>
  <div id="invites" class="muted">…</div>

  <h2>Active games</h2>
  <div id="games" class="muted">…</div>

  <h2>Recent moves</h2>
  <div id="moves" class="muted">…</div>

  <h2>Engine usage</h2>
  <div id="engines" class="muted">…</div>

  <h2>Recent errors</h2>
  <div id="errors" class="muted">…</div>

  <h2>Bot rules</h2>
  <ul style="padding-left: 22px; margin: 0; font-size: 13px;">
    <li>Friendly games only. Ranked invites declined.</li>
    <li>Maintains one open invite per gamemode (realtime + turn-based).</li>
    <li>Always accepts draw offers and collective-abandon proposals.</li>
    <li>Replies <span class="mono">"I'm not sure."</span> to every opponent chat message (chat treated as untrusted).</li>
    <li>After 3 consecutive errors on a table, sends a polite concession message and resigns.</li>
  </ul>

  <h2>Engine API</h2>
  <pre><code>curl -X POST https://stockfish.ross.gg/bestmove \\
  -H 'content-type: application/json' \\
  -d '{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","depth":12}'</code></pre>

  <footer>
    Worker + Durable Objects on Cloudflare. Engine fallback chain: chess-api.com → bundled WASM Stockfish → random legal move.
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
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

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
  const stateEl = document.getElementById("state");
  stateEl.textContent = s.running ? (s.loggedIn ? "running" : "running (not logged in)") : "stopped";
  stateEl.className = "pill " + (s.running && s.loggedIn ? "ok" : "warn");
  document.getElementById("ticked").textContent = "last tick: " + fmtTime(s.lastTickAt);

  const st = s.stats || { wins: 0, losses: 0, draws: 0, concedes: 0, engineUses: {} };
  const liveTables = Object.values(s.tables || {}).filter(t => !t.finished).length;
  document.getElementById("stats").innerHTML = [
    card("Live games", liveTables),
    card("Wins", st.wins, "ok"),
    card("Losses", st.losses),
    card("Draws", st.draws),
    card("Concedes", st.concedes, st.concedes > 0 ? "warn" : ""),
  ].join("");

  document.getElementById("invites").innerHTML = renderInvites(s.openInvites);
  document.getElementById("games").innerHTML = renderGames(s);
  document.getElementById("moves").innerHTML = renderMoves(s.recentMoves);
  document.getElementById("engines").innerHTML = renderEngines(st.engineUses);
  document.getElementById("errors").innerHTML = renderErrors(s.recentErrors);
}

function card(label, val, cls) {
  return '<div class="card"><div class="label">' + esc(label) + '</div><div class="val ' + (cls||'') + '">' + esc(val) + '</div></div>';
}

function tableLink(id) {
  return '<a href="https://boardgamearena.com/table?table=' + encodeURIComponent(id) + '" target="_blank" class="mono">' + esc(id) + '</a>';
}

function renderInvites(invites) {
  if (!invites) return "<span class='muted'>none</span>";
  const rows = ["realtime", "async"].map(mode => {
    const v = invites[mode] || {};
    const idCell = v.id ? tableLink(v.id) : "<span class='muted'>—</span>";
    return '<tr><td>' + mode + '</td><td>' + idCell + '</td><td class="muted">' + (v.createdAt ? fmtTime(v.createdAt) : "") + '</td></tr>';
  }).join("");
  return '<table><thead><tr><th>Mode</th><th>Table</th><th>Created</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderGames(s) {
  const memo = s.tables || {};
  const seen = new Map((s.lastTablesSeen || []).map(t => [t.id, t]));
  const ids = Array.from(new Set([...Object.keys(memo), ...seen.keys()]));
  const live = ids.filter(id => {
    const m = memo[id] || {};
    if (m.finished || m.conceded) return false;
    const t = seen.get(id);
    return t && t.status !== "finished" && t.status !== "asyncfinished";
  });
  if (live.length === 0) return "<span class='muted'>no live games</span>";
  const rows = live.map(id => {
    const m = memo[id] || {};
    const t = seen.get(id) || {};
    const tags = [];
    if (m.saidHi) tags.push("opened");
    if (m.gameserver != null) tags.push("gs:" + m.gameserver);
    if (m.errorCount) tags.push("<span class='warn'>errors:" + m.errorCount + "</span>");
    return '<tr><td>' + tableLink(id) + '</td><td>' + esc(t.status || "?") + '</td><td class="muted">' + tags.join(" · ") + '</td></tr>';
  }).join("");
  return '<table><thead><tr><th>Table</th><th>Status</th><th>State</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderMoves(moves) {
  if (!moves || moves.length === 0) return "<span class='muted'>no moves yet</span>";
  const rows = moves.slice().reverse().slice(0, 20).map(m => {
    return '<tr><td class="muted">' + fmtTime(m.ts) + '</td><td>' + tableLink(m.tableId) + '</td><td class="mono">' + esc(m.from) + ' → ' + esc(m.to) + '</td><td class="muted">' + esc(m.engine) + '</td></tr>';
  }).join("");
  return '<table><thead><tr><th>When</th><th>Table</th><th>Move</th><th>Engine</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderEngines(uses) {
  const entries = Object.entries(uses || {});
  if (entries.length === 0) return "<span class='muted'>no engine calls yet</span>";
  entries.sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const rows = entries.map(([k, n]) => {
    const pct = total > 0 ? Math.round(100 * n / total) : 0;
    return '<tr><td class="mono">' + esc(k) + '</td><td class="right">' + esc(n) + '</td><td class="right muted">' + pct + '%</td></tr>';
  }).join("");
  return '<table><thead><tr><th>Engine</th><th class="right">Moves</th><th class="right">Share</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderErrors(errors) {
  if (!errors || errors.length === 0) return "<span class='muted'>no recent errors</span>";
  const rows = errors.slice().reverse().slice(0, 20).map(e => {
    const tcell = e.tableId ? tableLink(e.tableId) : '<span class="muted">—</span>';
    return '<tr><td class="muted">' + fmtTime(e.ts) + '</td><td class="mono">' + esc(e.scope) + '</td><td>' + tcell + '</td><td class="mono err">' + esc(e.msg) + '</td></tr>';
  }).join("");
  return '<table><thead><tr><th>When</th><th>Scope</th><th>Table</th><th>Message</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

load();
setInterval(load, 10000);
</script>
</body>
</html>`;
}
