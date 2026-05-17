/**
 * Reconnaissance pass: figure out how BGA exposes "ongoing games for the
 * logged-in user" so the bot can poll for tables it's been invited to or
 * is currently playing, and detect when it's its turn to move.
 *
 * Strategy:
 *  - reuse the saved auth-state.json from recon-login.ts (bot_stockfish)
 *  - visit a handful of pages that *should* surface active tables:
 *      /gameinprogress    — "Games in progress" page
 *      /welcome           — homepage (has a "your current games" widget)
 *      /player            — own profile
 *      /lobby             — main lobby (may carry invite toasts)
 *  - capture every XHR/JSON request + response made during each visit
 *  - also try a few suspected POST endpoints directly via page.evaluate +
 *    fetch (so the request rides the page's CSRF token / cookies)
 *
 * Output: recon/ongoing/captured.json + summary.md
 *
 * If a game already exists (e.g. someone invited bot_stockfish manually),
 * the same trace will show how the table page bootstraps — which is
 * exactly what we need to capture playMove / chat / resign endpoints
 * without orchestrating a 2-bot game.
 */
import { chromium, type Request, type Response, type WebSocket } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reconDir = path.join(root, "recon", "ongoing");
const shotsDir = path.join(reconDir, "screenshots");
const authStatePath = path.join(root, "recon", "auth-state.json");

interface CapturedRequest {
  step: string;
  method: string;
  url: string;
  status?: number;
  contentType?: string;
  reqHeaders?: Record<string, string>;
  hasBody: boolean;
  bodyPreview?: string;
  responsePreview?: string;
  timing: number;
}

interface CapturedWSFrame {
  url: string;
  direction: "sent" | "received";
  payload: string;
  timing: number;
}

const SKIP_URL_RX = /\.(png|jpg|jpeg|svg|gif|webp|css|woff2?|ico|map|mp4|apng)(\?|$)/i;
const INTERESTING_RX = /(\/account\/|\/table\/|\/tablemanager\/|\/chess\/|\/lobby\/|\/notif\/|\/notification|\/message\/|\/community\/|\/player\/|\/gameranking|invit|getCentrifuge|getConnection|websocket|emulation|\.html)/i;

async function main() {
  if (!fs.existsSync(authStatePath)) {
    throw new Error(
      "recon/auth-state.json not found — run `npm run recon:login` first",
    );
  }
  fs.mkdirSync(shotsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authStatePath,
    recordHar: { path: path.join(reconDir, "ongoing.har"), content: "embed" },
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const requests: CapturedRequest[] = [];
  const wsFrames: CapturedWSFrame[] = [];
  let currentStep = "init";
  const start = Date.now();

  context.on("request", (req: Request) => {
    if (SKIP_URL_RX.test(req.url())) return;
    requests.push({
      step: currentStep,
      method: req.method(),
      url: req.url(),
      reqHeaders: req.headers(),
      hasBody: !!req.postData(),
      bodyPreview: req.postData()?.slice(0, 1500),
      timing: Date.now() - start,
    });
  });
  context.on("response", async (resp: Response) => {
    if (SKIP_URL_RX.test(resp.url())) return;
    const rec = requests
      .slice()
      .reverse()
      .find((r) => r.url === resp.url() && r.status === undefined);
    if (!rec) return;
    rec.status = resp.status();
    rec.contentType = resp.headers()["content-type"];
    try {
      if (
        rec.contentType?.includes("json") ||
        rec.contentType?.includes("text") ||
        rec.contentType?.includes("html")
      ) {
        rec.responsePreview = (await resp.text().catch(() => "")).slice(0, 2000);
      }
    } catch {}
  });
  context.on("websocket", (ws: WebSocket) => {
    console.log(`WS opened: ${ws.url()}`);
    ws.on("framesent", (d) => {
      const p = typeof d.payload === "string" ? d.payload : d.payload.toString("utf8");
      wsFrames.push({ url: ws.url(), direction: "sent", payload: p, timing: Date.now() - start });
    });
    ws.on("framereceived", (d) => {
      const p = typeof d.payload === "string" ? d.payload : d.payload.toString("utf8");
      wsFrames.push({
        url: ws.url(),
        direction: "received",
        payload: p,
        timing: Date.now() - start,
      });
    });
  });

  async function visit(step: string, url: string, screenshot?: string) {
    currentStep = step;
    console.log(`\n=== ${step}: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch((e) => {
      console.warn(`goto failed:`, e.message);
    });
    await page.waitForTimeout(4_000); // let XHRs settle
    if (screenshot) {
      await page
        .screenshot({ path: path.join(shotsDir, screenshot), fullPage: true })
        .catch(() => {});
    }
    // Capture some inline window vars that BGA uses to bootstrap UI.
    const inline = await page
      .evaluate(() => {
        const w = window as Window & Record<string, unknown>;
        function safe(k: string) {
          try { return JSON.parse(JSON.stringify(w[k])); } catch { return typeof w[k]; }
        }
        return {
          g_user_id: w.g_user_id ?? w.g_userid,
          g_table_id: w.g_table_id,
          g_player_id: w.g_player_id,
          centrifugeConfiguration: safe("centrifugeConfiguration"),
          g_gamedatas: safe("g_gamedatas"),
          requestToken: w.requestToken,
          // BGA's "your games" widget often hangs off a global like `gameInProgressBoard`
          // or stuffs initial data in a div with data-* attrs — grab a snapshot of the
          // common ones if present.
          dataYourGames: document.querySelector("#myGames, .yourGames, [data-your-games]")?.outerHTML?.slice(0, 1000),
          url: location.href,
          title: document.title,
        };
      })
      .catch((e) => ({ _error: String(e) }));
    fs.writeFileSync(
      path.join(reconDir, `inline-${step}.json`),
      JSON.stringify(inline, null, 2),
    );
  }

  // 1. /gameinprogress — known to render a list of games-in-progress.
  await visit("01-gameinprogress", "https://en.boardgamearena.com/gameinprogress", "01-gameinprogress.png");

  // 2. Welcome page (homepage when logged in) often shows your current tables.
  await visit("02-welcome", "https://en.boardgamearena.com/welcome", "02-welcome.png");

  // 3. Player profile — sometimes lists ongoing public tables.
  await visit("03-player", "https://en.boardgamearena.com/player", "03-player.png");

  // 4. Lobby — may push invite notifications via WS.
  await visit("04-lobby", "https://en.boardgamearena.com/lobby", "04-lobby.png");

  // 5. Direct probes for suspected JSON endpoints. We do these from the
  //    page context so they ride the existing cookies + CSRF token.
  currentStep = "05-direct-probes";
  const probeUrls = [
    "https://boardgamearena.com/tablemanager/tablemanager/myTables.html",
    "https://boardgamearena.com/tablemanager/tablemanager/getMyTables.html",
    "https://boardgamearena.com/tablemanager/tablemanager/getTables.html",
    "https://boardgamearena.com/player/player/myCurrentTables.html",
    "https://boardgamearena.com/player/player/getPlayerTables.html",
    "https://boardgamearena.com/player/player/getCurrentTables.html",
    "https://boardgamearena.com/tablemanager/tablemanager/tableinfos.html",
    "https://boardgamearena.com/gameinprogress/gameinprogress/getCurrentGames.html",
    "https://boardgamearena.com/gameinprogress/gameinprogress/getMyGames.html",
    "https://boardgamearena.com/notif/notif/getNotifs.html",
    "https://boardgamearena.com/notif/notif/getConnectionToken.html",
    "https://boardgamearena.com/notif/notif/getCentrifugeToken.html",
  ];
  for (const url of probeUrls) {
    const result = await page.evaluate(async (probeUrl) => {
      try {
        const idt = document.cookie.match(/TournoiEnLigneidt=([^;]+)/)?.[1] ?? "";
        const r = await fetch(probeUrl, {
          method: "POST",
          headers: {
            "x-request-token": idt,
            "x-requested-with": "XMLHttpRequest",
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            accept: "application/json, text/javascript, */*; q=0.01",
          },
          body: "",
          credentials: "include",
        });
        const text = await r.text();
        return { status: r.status, ct: r.headers.get("content-type"), preview: text.slice(0, 600) };
      } catch (e) {
        return { error: String(e) };
      }
    }, url);
    console.log(`  ${url} →`, result);
  }
  await page.waitForTimeout(3_000);

  // Dump
  fs.writeFileSync(
    path.join(reconDir, "captured-requests.json"),
    JSON.stringify(requests, null, 2),
  );
  fs.writeFileSync(
    path.join(reconDir, "ws-frames.json"),
    JSON.stringify(wsFrames, null, 2),
  );

  const interesting = requests.filter(
    (r) => INTERESTING_RX.test(r.url) && !SKIP_URL_RX.test(r.url),
  );
  const lines: string[] = [];
  lines.push("# Ongoing-games recon\n");
  lines.push(`Captured ${requests.length} total requests; ${interesting.length} interesting; ${wsFrames.length} WS frames.\n`);
  for (const r of interesting) {
    lines.push(`### [${r.step}] ${r.method} ${r.url}`);
    lines.push(`- t=+${r.timing}ms status=${r.status} ct=${r.contentType ?? "-"}`);
    if (r.hasBody) lines.push(`- body: \`${(r.bodyPreview ?? "").replace(/\n/g, " ")}\``);
    if (r.responsePreview) {
      lines.push(`- response: \`${r.responsePreview.replace(/\n/g, " ").slice(0, 400)}\``);
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(reconDir, "summary.md"), lines.join("\n"));

  await context.close();
  await browser.close();
  console.log("\ndone. see recon/ongoing/{summary.md,captured-requests.json,ws-frames.json}");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
