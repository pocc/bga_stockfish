/**
 * Reconnaissance pass: create a friendly chess table in HOTSEAT mode
 * (two players on one device) so we can capture the in-game API surface
 * without orchestrating a 2-account flow.
 *
 * Sequence:
 *   1. Log in as bot_stockfish (re-use auth-state.json).
 *   2. Navigate to chess gamepanel → click "Play" → friend / private.
 *   3. On the table-setup page, click "Invite a friend" → "Hotseat".
 *      (BGA wires the hotseat player up as a fake second seat owned by us.)
 *   4. Click "Start".
 *   5. Print the spectator URL so the user can watch in their own browser.
 *   6. Keep the page open for ~3 minutes so we can:
 *        - capture g_gamedatas + centrifuge config + WS frames
 *        - have the human / a follow-up script play moves while we record
 *      OR play one move via the UI (e2-e4) and then resign, to grab
 *      playMove + resign endpoints.
 *
 * Output: recon/hotseat/{captured.json, ws-frames.json, summary.md, screenshots/}
 */
import { chromium, type Request, type Response, type WebSocket } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reconDir = path.join(root, "recon", "hotseat");
const shotsDir = path.join(reconDir, "screenshots");
const authStatePath = path.join(root, "recon", "auth-state.json");

const SKIP_URL_RX = /\.(png|jpg|jpeg|svg|gif|webp|css|woff2?|ico|map|mp4|apng)(\?|$)/i;
const INTERESTING_RX = /(\/account\/|\/table\/|\/tablemanager\/|\/chess\/|\/lobby\/|\/notif\/|\/notification|\/message\/|\/player\/|\/gameranking|invit|getCentrifuge|getConnection|websocket|emulation|hotseat|\.html)/i;

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

async function main() {
  if (!fs.existsSync(authStatePath)) {
    throw new Error("recon/auth-state.json missing — run `npm run recon:login` first");
  }
  fs.mkdirSync(shotsDir, { recursive: true });

  const headless = process.env.HEADFUL !== "1";
  console.log(`launching chromium (headless=${headless})...`);
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    storageState: authStatePath,
    recordHar: { path: path.join(reconDir, "hotseat.har"), content: "embed" },
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const start = Date.now();
  const requests: CapturedRequest[] = [];
  const wsFrames: CapturedWSFrame[] = [];
  let step = "init";

  context.on("request", (req: Request) => {
    if (SKIP_URL_RX.test(req.url())) return;
    requests.push({
      step,
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
      wsFrames.push({ url: ws.url(), direction: "received", payload: p, timing: Date.now() - start });
    });
  });

  async function shot(name: string) {
    await page.screenshot({ path: path.join(shotsDir, name) }).catch(() => {});
  }

  async function tryClick(label: string, selectors: string[]): Promise<boolean> {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        console.log(`  click [${label}] via ${sel}`);
        try {
          await loc.click({ timeout: 5_000 });
          return true;
        } catch (e) {
          console.warn(`  click failed (${e instanceof Error ? e.message : e})`);
        }
      }
    }
    console.warn(`  no element matched for [${label}]`);
    return false;
  }

  async function dumpInline(name: string) {
    const inline = await page
      .evaluate(() => {
        const w = window as Window & Record<string, unknown>;
        function safe(k: string) {
          try { return JSON.parse(JSON.stringify(w[k])); } catch { return typeof w[k]; }
        }
        return {
          url: location.href,
          title: document.title,
          g_user_id: w.g_user_id ?? w.g_userid,
          g_table_id: w.g_table_id,
          g_player_id: w.g_player_id,
          centrifugeConfiguration: safe("centrifugeConfiguration"),
          g_gamedatas: safe("g_gamedatas"),
          requestToken: w.requestToken,
        };
      })
      .catch((e) => ({ _err: String(e) }));
    fs.writeFileSync(path.join(reconDir, `inline-${name}.json`), JSON.stringify(inline, null, 2));
    return inline;
  }

  function tableIdFromUrl(): string | null {
    return /[?&]table=(\d+)/.exec(page.url())?.[1] ?? null;
  }

  try {
    // 1. Land on chess gamepanel
    step = "01-gamepanel";
    console.log("[1] gamepanel");
    await page.goto("https://en.boardgamearena.com/gamepanel?game=chess", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3_000);
    await shot("01-gamepanel.png");

    // 2. Click Play (any variant — we'll funnel through whatever modal appears)
    step = "02-play";
    console.log("[2] Play");
    await tryClick("Play", [
      'a:has-text("Play now")',
      'div[role="button"]:has-text("Play now")',
      'a:has-text("Play")',
      'div[role="button"]:has-text("Play")',
      'button:has-text("Play")',
    ]);
    await page.waitForTimeout(4_000);
    await shot("02-after-play.png");

    // 3. Modal: "How many players?" Click 2 players if it's there.
    step = "03-2players";
    await tryClick("2 players", [
      'div[role="button"]:has-text("2 players")',
      'button:has-text("2 players")',
      'a:has-text("2 players")',
    ]);
    await page.waitForTimeout(2_000);
    await shot("03-after-2players.png");

    // 4. Modal: "With whom?" Try Friend / Private.
    step = "04-friend";
    await tryClick("Friend / Private", [
      'div[role="button"]:has-text("Friend")',
      'button:has-text("Friend")',
      'div[role="button"]:has-text("Private")',
      'button:has-text("Private")',
      'a:has-text("Friend")',
    ]);
    await page.waitForTimeout(4_000);
    await shot("04-after-friend.png");

    let tableId = tableIdFromUrl();
    console.log(`  → table id (post-create): ${tableId}`);

    // 5. On the table-setup page, click "Invite a friend" then "Hotseat".
    step = "05-invite-hotseat";
    console.log("[5] invite → Hotseat");
    await tryClick("Invite a friend", [
      'div[role="button"]:has-text("Invite a friend")',
      'button:has-text("Invite a friend")',
      'a:has-text("Invite a friend")',
    ]);
    await page.waitForTimeout(1_500);
    await shot("05a-invite-modal.png");
    await tryClick("Hotseat", [
      'a:has-text("Hotseat")',
      'div[role="button"]:has-text("Hotseat")',
      'button:has-text("Hotseat")',
      'span:has-text("Hotseat")',
      'text=Hotseat',
    ]);
    await page.waitForTimeout(3_000);
    await shot("05b-after-hotseat.png");

    if (!tableId) tableId = tableIdFromUrl();
    if (tableId) {
      console.log("");
      console.log("==============================================");
      console.log("Spectator URLs (open one in your browser):");
      console.log(`  https://boardgamearena.com/table?table=${tableId}`);
      console.log(`  https://boardgamearena.com/4/chess?table=${tableId}`);
      console.log("==============================================");
      console.log("");
    }
    await dumpInline("table-setup");

    // 6. Click Start
    step = "06-start";
    await tryClick("Start", [
      'a:has-text("Start")',
      'button:has-text("Start")',
      'div[role="button"]:has-text("Start")',
      'a:has-text("Begin")',
      'a:has-text("Accept")',
    ]);
    await page.waitForTimeout(6_000);
    await shot("06-after-start.png");
    await dumpInline("in-game");

    // 7. Idle while WS is alive — give us time to capture frames and let
    //    the human spectate. Default 180s; override with HOTSEAT_DWELL_MS.
    step = "07-dwell";
    const dwellMs = Number(process.env.HOTSEAT_DWELL_MS ?? 180_000);
    console.log(`[7] dwelling ${dwellMs}ms (set HOTSEAT_DWELL_MS to change)`);
    await page.waitForTimeout(dwellMs);
    await shot("07-end.png");
  } catch (err) {
    console.error("recon error (continuing to dump):", err);
  } finally {
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
    const lines = [`# Hotseat recon\n`, `Total req: ${requests.length}, interesting: ${interesting.length}, WS frames: ${wsFrames.length}\n`];
    for (const r of interesting) {
      lines.push(`### [${r.step}] ${r.method} ${r.url}`);
      lines.push(`- t=+${r.timing}ms status=${r.status} ct=${r.contentType ?? "-"}`);
      if (r.hasBody) lines.push(`- body: \`${(r.bodyPreview ?? "").replace(/\n/g, " ")}\``);
      if (r.responsePreview) lines.push(`- response: \`${r.responsePreview.replace(/\n/g, " ").slice(0, 400)}\``);
      lines.push("");
    }
    fs.writeFileSync(path.join(reconDir, "summary.md"), lines.join("\n"));
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    console.log("done. recon/hotseat/{summary.md,captured-requests.json,ws-frames.json}");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
