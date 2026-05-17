/**
 * Reconnaissance pass: drive a full friendly chess game between
 * bot_stockfish (white) and bot_stockfish2 (black) to capture the in-game
 * BGA API surface that we couldn't see from lobby-only recon:
 *
 *   - table creation        (POST /table/table/createnew.html)
 *   - invitation send       (POST /table/table/invitebyid?ish?)
 *   - invitation accept     (POST /table/table/acceptInvit*.html)
 *   - move submission       (POST /<game>/<game>/playMove.html?table=...)
 *   - chat send             (POST /table/table/say.html?table=...)
 *   - resign / decision     (POST /table/table/decide*.html or
 *                            /chess/chess/resign.html)
 *   - centrifuge connect    (POST /notif/notif/getCentrifugeToken... ish)
 *   - realtime WS frames    (wss://ws-x{1,2}.boardgamearena.com/...)
 *
 * Output goes under recon/game/:
 *   - game-bot1.har          (full network trace of bot 1's context)
 *   - game-bot2.har          (full network trace of bot 2's context)
 *   - captured-requests-bot1.json + -bot2.json
 *   - ws-frames-bot1.json    + -bot2.json
 *   - inline-config-bot1.json (centrifugeConfiguration + g_gamedatas if found)
 *   - screenshots/
 *   - game-summary.md
 *
 * The script is intentionally chatty (console.log everything) — recon is
 * not the place to be subtle. Errors do NOT abort; we capture whatever we
 * can and keep going so a partial trace is still useful.
 */
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
  type WebSocket,
} from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loginViaUI } from "./lib/login-flow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reconDir = path.join(root, "recon", "game");
const shotsDir = path.join(reconDir, "screenshots");

const START_CHAT = "I am a nerfed version of stockfish, https://stockfishchess.org/ . Good luck!";
const END_CHAT = "Good Game!";

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

interface CapturedRequest {
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

interface CaptureBundle {
  label: string;
  context: BrowserContext;
  page: Page;
  requests: CapturedRequest[];
  wsFrames: CapturedWSFrame[];
  inlineConfigs: Record<string, unknown>;
  shotsPrefix: string;
}

const INTERESTING_URL_RX = /(\/account\/|\/table\/|\/tablemanager\/|\/chess\/|\/lobby\/|\/notif\/|\/notification|\/message\/|\/community\/|\/player\/|\/gameranking|invit|getCentrifuge|getConnection|websocket|emulation)/i;
const SKIP_URL_RX = /\.(png|jpg|jpeg|svg|gif|webp|css|woff2?|ico|map|mp4|apng)(\?|$)/i;

async function setupCapture(
  browser: Browser,
  label: string,
  start: number,
): Promise<CaptureBundle> {
  const harPath = path.join(reconDir, `${label}.har`);
  const context = await browser.newContext({
    recordHar: { path: harPath, content: "embed" },
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const requests: CapturedRequest[] = [];
  const wsFrames: CapturedWSFrame[] = [];

  context.on("request", (req: Request) => {
    if (SKIP_URL_RX.test(req.url())) return;
    requests.push({
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
    const rec = requests.find(
      (r) => r.url === resp.url() && r.status === undefined,
    );
    if (!rec) return;
    rec.status = resp.status();
    rec.contentType = resp.headers()["content-type"];
    try {
      if (
        rec.contentType?.includes("json") ||
        rec.contentType?.includes("text") ||
        rec.contentType?.includes("html")
      ) {
        const body = await resp.text().catch(() => "");
        rec.responsePreview = body.slice(0, 1500);
      }
    } catch {
      // best-effort
    }
  });
  context.on("websocket", (ws: WebSocket) => {
    console.log(`[${label}] WS opened: ${ws.url()}`);
    ws.on("framesent", (data) => {
      const payload = typeof data.payload === "string" ? data.payload : data.payload.toString("utf8");
      wsFrames.push({ url: ws.url(), direction: "sent", payload, timing: Date.now() - start });
    });
    ws.on("framereceived", (data) => {
      const payload = typeof data.payload === "string" ? data.payload : data.payload.toString("utf8");
      wsFrames.push({ url: ws.url(), direction: "received", payload, timing: Date.now() - start });
    });
    ws.on("close", () => console.log(`[${label}] WS closed: ${ws.url()}`));
  });

  return {
    label,
    context,
    page,
    requests,
    wsFrames,
    inlineConfigs: {},
    shotsPrefix: label,
  };
}

async function screenshot(b: CaptureBundle, name: string) {
  const p = path.join(shotsDir, `${b.shotsPrefix}-${name}.png`);
  await b.page.screenshot({ path: p, fullPage: false }).catch((e) => {
    console.warn(`[${b.label}] screenshot ${name} failed:`, e.message);
  });
}

/**
 * Read the page's inline window variables that BGA uses to bootstrap UI
 * (we want g_gamedatas, gameui_chess.gamedatas, centrifugeConfiguration,
 * etc.). Captures whatever exists; missing keys are silently skipped.
 */
async function captureInlineConfig(b: CaptureBundle, label: string) {
  const cfg = await b.page
    .evaluate(() => {
      const w = window as Window & Record<string, unknown>;
      function safe(k: string): unknown {
        try {
          return JSON.parse(JSON.stringify(w[k]));
        } catch {
          return typeof w[k];
        }
      }
      return {
        centrifugeConfiguration: safe("centrifugeConfiguration"),
        g_gamedatas: safe("g_gamedatas"),
        g_user_id: w.g_user_id,
        g_userid: w.g_userid,
        g_table_id: w.g_table_id,
        g_player_id: w.g_player_id,
        g_chess_pieces: safe("g_chess_pieces"),
        requestToken: w.requestToken,
        bgaConfig: safe("bgaConfig"),
        url: location.href,
      };
    })
    .catch((err) => ({ _error: String(err) }));
  b.inlineConfigs[label] = cfg;
}

async function dump(b: CaptureBundle) {
  fs.writeFileSync(
    path.join(reconDir, `captured-requests-${b.label}.json`),
    JSON.stringify(b.requests, null, 2),
  );
  fs.writeFileSync(
    path.join(reconDir, `ws-frames-${b.label}.json`),
    JSON.stringify(b.wsFrames, null, 2),
  );
  fs.writeFileSync(
    path.join(reconDir, `inline-config-${b.label}.json`),
    JSON.stringify(b.inlineConfigs, null, 2),
  );
}

/**
 * Heuristic invite flow: open chess gamepanel, click the realtime "Play"
 * button. BGA's UI uses lots of nested divs; we try multiple selectors and
 * fall back to clicking anything that says "Play" / "Create".
 */
async function bot1CreateTable(b: CaptureBundle): Promise<string | null> {
  console.log("[bot1] navigating to chess gamepanel...");
  await b.page.goto("https://en.boardgamearena.com/gamepanel?game=chess", {
    waitUntil: "domcontentloaded",
  });
  await b.page.waitForTimeout(3_000);
  await screenshot(b, "10-gamepanel");

  // 1. Try the obvious "Play" button labels.
  const playSelectors = [
    'a:has-text("Play now")',
    'div[role="button"]:has-text("Play now")',
    'button:has-text("Play now")',
    'a:has-text("Play")',
    'div[role="button"]:has-text("Play")',
    'button:has-text("Play")',
    'a:has-text("Create a table")',
    'a:has-text("New table")',
  ];
  let clicked = false;
  for (const sel of playSelectors) {
    const loc = b.page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      console.log(`[bot1] clicking ${sel}`);
      await loc.click({ timeout: 5_000 }).catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    console.warn("[bot1] no Play button found on gamepanel — dumping buttons");
    const btns = await b.page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("a, button, div[role='button'], span[role='button']"),
      )
        .map((el) => ({
          tag: el.tagName,
          text: (el.textContent || "").trim().slice(0, 50),
          id: el.id,
          cls: el.className,
        }))
        .filter((x) => x.text && x.text.length < 50);
    });
    fs.writeFileSync(
      path.join(reconDir, "bot1-gamepanel-buttons.json"),
      JSON.stringify(btns, null, 2),
    );
  }

  await b.page.waitForTimeout(5_000);
  await screenshot(b, "11-after-play");

  // We may now be at a popup ("How many players?", "Friend / Anyone"), or
  // at a table page. Try to click "2 players" then "Friend" / "Friends only".
  for (const sel of [
    'div[role="button"]:has-text("2 players")',
    'button:has-text("2 players")',
    'a:has-text("2 players")',
    'div:has-text("2 players"):not(:has(div))',
  ]) {
    const loc = b.page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      console.log(`[bot1] clicking ${sel}`);
      await loc.click({ timeout: 3_000 }).catch(() => {});
      break;
    }
  }
  await b.page.waitForTimeout(2_000);
  await screenshot(b, "12-after-players");

  for (const sel of [
    'div[role="button"]:has-text("Friend")',
    'button:has-text("Friend")',
    'a:has-text("Friend")',
    'div[role="button"]:has-text("Private")',
    'button:has-text("Private")',
    'div[role="button"]:has-text("With friends")',
  ]) {
    const loc = b.page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      console.log(`[bot1] clicking ${sel}`);
      await loc.click({ timeout: 3_000 }).catch(() => {});
      break;
    }
  }
  await b.page.waitForTimeout(5_000);
  await screenshot(b, "13-after-friend");

  // Extract table id from the URL (the table page is /1/chess?table=<id>
  // or /<server>/chess?table=<id>).
  const m = /[?&]table=(\d+)/.exec(b.page.url());
  const tableId = m ? m[1] : null;
  console.log(`[bot1] post-create URL: ${b.page.url()} (tableId=${tableId})`);
  return tableId;
}

async function bot1InviteBot2(b: CaptureBundle, bot2UserId: string | null) {
  if (!bot2UserId) {
    console.warn("[bot1] no bot2 user id — skipping invite step");
    return;
  }
  console.log(`[bot1] attempting to invite bot2 (id=${bot2UserId})`);

  // BGA's table-setup page has an "Invite a player" search box. Click it
  // and type bot_stockfish2.
  for (const sel of [
    'input[placeholder*="layer"]',
    'input[placeholder*="riend"]',
    'input[placeholder*="ame"]',
    'input[type="search"]',
  ]) {
    const loc = b.page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      console.log(`[bot1] typing into ${sel}`);
      await loc.fill("bot_stockfish2").catch(() => {});
      await b.page.waitForTimeout(1_500);
      // Click the resulting search result (often shown as a div with the username).
      const result = b.page.locator('text=bot_stockfish2').first();
      if (await result.count().catch(() => 0)) {
        await result.click({ timeout: 3_000 }).catch(() => {});
      }
      break;
    }
  }
  await b.page.waitForTimeout(2_000);
  await screenshot(b, "14-after-invite");
}

async function bot2AcceptInvite(b: CaptureBundle): Promise<string | null> {
  console.log("[bot2] navigating to lobby to look for invite...");
  await b.page.goto("https://en.boardgamearena.com/welcome", {
    waitUntil: "domcontentloaded",
  });
  await b.page.waitForTimeout(5_000);
  await screenshot(b, "20-welcome");

  // Click any "Accept" button (invite notification toast).
  for (const sel of [
    'a:has-text("Accept")',
    'button:has-text("Accept")',
    'div[role="button"]:has-text("Accept")',
    'a:has-text("Join")',
  ]) {
    const loc = b.page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      console.log(`[bot2] clicking ${sel}`);
      await loc.click({ timeout: 3_000 }).catch(() => {});
      await b.page.waitForTimeout(3_000);
      break;
    }
  }
  await screenshot(b, "21-after-accept");

  const m = /[?&]table=(\d+)/.exec(b.page.url());
  const tableId = m ? m[1] : null;
  console.log(`[bot2] post-accept URL: ${b.page.url()} (tableId=${tableId})`);
  return tableId;
}

async function navigateToTable(b: CaptureBundle, tableId: string) {
  console.log(`[${b.label}] navigating to table ${tableId}`);
  await b.page.goto(`https://boardgamearena.com/4/chess?table=${tableId}`, {
    waitUntil: "domcontentloaded",
  });
  await b.page.waitForTimeout(5_000);
  await screenshot(b, "30-table");
  await captureInlineConfig(b, "table");
}

async function startGame(b: CaptureBundle) {
  // Click "Start" on the table setup page once both seats are filled.
  for (const sel of [
    'a:has-text("Start")',
    'button:has-text("Start")',
    'div[role="button"]:has-text("Start")',
    'a:has-text("Begin")',
    'div[role="button"]:has-text("Accept")',
  ]) {
    const loc = b.page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      console.log(`[${b.label}] clicking ${sel}`);
      await loc.click({ timeout: 3_000 }).catch(() => {});
      await b.page.waitForTimeout(3_000);
      break;
    }
  }
  await screenshot(b, "31-after-start");
}

/**
 * Best-effort: click e2, then click e4 on the chess board. BGA renders
 * squares as positioned divs with class names like `square square-e2` or
 * data attributes — we try a handful.
 */
async function bot1PlayMove(b: CaptureBundle, from: string, to: string) {
  console.log(`[bot1] attempting move ${from}->${to}`);
  for (const sq of [from, to]) {
    const sel = [
      `.square-${sq}`,
      `[data-square="${sq}"]`,
      `#square_${sq}`,
      `[id$="_${sq}"]`,
    ];
    let clicked = false;
    for (const s of sel) {
      const loc = b.page.locator(s).first();
      if (await loc.count().catch(() => 0)) {
        await loc.click({ timeout: 2_000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) console.warn(`[bot1] couldn't find square ${sq}`);
    await b.page.waitForTimeout(800);
  }
  await screenshot(b, `40-move-${from}${to}`);
}

async function sendChat(b: CaptureBundle, msg: string) {
  console.log(`[${b.label}] sending chat: ${msg.slice(0, 40)}...`);
  for (const sel of [
    'input[placeholder*="essage"]',
    'textarea[placeholder*="essage"]',
    'input.chatinput',
    'textarea.chatinput',
    'input[name="message"]',
  ]) {
    const loc = b.page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      await loc.fill(msg).catch(() => {});
      await loc.press("Enter").catch(() => {});
      await b.page.waitForTimeout(1_500);
      return;
    }
  }
  console.warn(`[${b.label}] no chat input found`);
}

async function bot1Resign(b: CaptureBundle) {
  console.log("[bot1] attempting to resign");
  // BGA's "leave" / "abandon" / "resign" usually lives in a menu under
  // the gear icon or as a button on the right side panel.
  for (const sel of [
    'a:has-text("Resign")',
    'button:has-text("Resign")',
    'div[role="button"]:has-text("Resign")',
    'a:has-text("Quit")',
    'a:has-text("Abandon")',
    'a:has-text("Give up")',
  ]) {
    const loc = b.page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      console.log(`[bot1] clicking ${sel}`);
      await loc.click({ timeout: 3_000 }).catch(() => {});
      await b.page.waitForTimeout(2_000);
      // Confirm dialog
      for (const confirm of [
        'button:has-text("Yes")',
        'a:has-text("Yes")',
        'div[role="button"]:has-text("Yes")',
        'button:has-text("Confirm")',
        'button:has-text("OK")',
      ]) {
        const c = b.page.locator(confirm).first();
        if (await c.count().catch(() => 0)) {
          await c.click({ timeout: 2_000 }).catch(() => {});
          break;
        }
      }
      await b.page.waitForTimeout(3_000);
      await screenshot(b, "50-resigned");
      return;
    }
  }
  console.warn("[bot1] no resign button found");
}

async function main() {
  fs.mkdirSync(shotsDir, { recursive: true });
  const env = loadEnv();
  for (const k of ["BGA_USERNAME", "BGA_PASSWORD", "BGA_USERNAME2", "BGA_PASSWORD2"]) {
    if (!env[k]) throw new Error(`${k} missing from .env.local`);
  }

  console.log("launching chromium for two parallel contexts...");
  const browser = await chromium.launch({ headless: true });
  const start = Date.now();

  const bot1 = await setupCapture(browser, "bot1", start);
  const bot2 = await setupCapture(browser, "bot2", start);

  try {
    console.log("logging in as bot1...");
    await loginViaUI(bot1.context, env.BGA_USERNAME, env.BGA_PASSWORD);
    console.log("logging in as bot2...");
    await loginViaUI(bot2.context, env.BGA_USERNAME2, env.BGA_PASSWORD2);

    // Each loginViaUI closes its page; bot1.page/bot2.page from setupCapture
    // are different pages — verify they still exist or open new ones.
    if (bot1.page.isClosed()) bot1.page = await bot1.context.newPage();
    if (bot2.page.isClosed()) bot2.page = await bot2.context.newPage();

    // Grab user IDs by visiting /player on each context.
    async function grabUserId(b: CaptureBundle): Promise<string | null> {
      await b.page.goto("https://en.boardgamearena.com/player", {
        waitUntil: "domcontentloaded",
      });
      await b.page.waitForTimeout(2_000);
      const id = await b.page.evaluate(() => {
        const w = window as Window & Record<string, unknown>;
        return (w.g_user_id ?? w.g_userid ?? null) as string | number | null;
      });
      console.log(`[${b.label}] user_id=${id}`);
      return id != null ? String(id) : null;
    }
    const bot1UserId = await grabUserId(bot1);
    const bot2UserId = await grabUserId(bot2);

    await captureInlineConfig(bot1, "after-login");
    await captureInlineConfig(bot2, "after-login");

    // Bot 1 creates the table + invites
    const tableIdCreated = await bot1CreateTable(bot1);
    await bot1InviteBot2(bot1, bot2UserId);

    // Bot 2 sees and accepts
    const tableIdAccepted = await bot2AcceptInvite(bot2);
    const tableId = tableIdCreated ?? tableIdAccepted;
    console.log(`final tableId=${tableId}`);

    if (tableId) {
      // Ensure both are on the table (bot2 may already be there post-accept)
      await navigateToTable(bot1, tableId);
      await navigateToTable(bot2, tableId);

      // Start the game (creator usually needs to confirm)
      await startGame(bot1);
      await bot2.page.waitForTimeout(2_000);

      await captureInlineConfig(bot1, "in-game");
      await captureInlineConfig(bot2, "in-game");

      // Bot 1 (white) opens with e2-e4
      await bot1PlayMove(bot1, "e2", "e4");
      await bot2.page.waitForTimeout(2_000);

      // Send the welcome chat
      await sendChat(bot1, START_CHAT);

      // Bot 1 resigns immediately so we capture the resign endpoint
      await bot1Resign(bot1);
      await bot2.page.waitForTimeout(2_000);

      // Both send GG
      await sendChat(bot1, END_CHAT);
      await sendChat(bot2, END_CHAT);

      await screenshot(bot1, "99-final");
      await screenshot(bot2, "99-final");
    }
  } catch (err) {
    console.error("recon error (continuing to dump partial state):", err);
  } finally {
    await dump(bot1);
    await dump(bot2);

    // Write a short summary highlighting the most interesting requests.
    const summary = makeSummary(bot1, bot2);
    fs.writeFileSync(path.join(reconDir, "game-summary.md"), summary);

    await bot1.context.close().catch(() => {});
    await bot2.context.close().catch(() => {});
    await browser.close();
    console.log("done. see recon/game/ for HARs, requests, ws frames, screenshots, summary.");
  }
}

function makeSummary(bot1: CaptureBundle, bot2: CaptureBundle): string {
  function filterInteresting(reqs: CapturedRequest[]) {
    return reqs.filter(
      (r) => INTERESTING_URL_RX.test(r.url) && !SKIP_URL_RX.test(r.url),
    );
  }
  function formatReq(r: CapturedRequest): string {
    const tok = r.reqHeaders?.["x-request-token"] ? " [csrf]" : "";
    return [
      `### ${r.method} ${r.url}${tok}`,
      `- t=+${r.timing}ms status=${r.status} content-type=${r.contentType ?? "-"}`,
      r.hasBody ? `- body: \`${(r.bodyPreview ?? "").replace(/\n/g, " ")}\`` : "- body: —",
      `- response: \`${(r.responsePreview ?? "").replace(/\n/g, " ").slice(0, 400)}\``,
    ].join("\n");
  }
  const ints1 = filterInteresting(bot1.requests);
  const ints2 = filterInteresting(bot2.requests);
  return `# Chess game recon

Captured a friendly chess game between bot_stockfish (bot1) and
bot_stockfish2 (bot2). Below: interesting endpoints + WS frame counts.

## Bot1 — ${ints1.length} interesting requests
${ints1.map(formatReq).join("\n\n")}

## Bot2 — ${ints2.length} interesting requests
${ints2.map(formatReq).join("\n\n")}

## WS frames
- bot1: ${bot1.wsFrames.length} frames across ${new Set(bot1.wsFrames.map((f) => f.url)).size} sockets
- bot2: ${bot2.wsFrames.length} frames across ${new Set(bot2.wsFrames.map((f) => f.url)).size} sockets

See \`ws-frames-bot1.json\` / \`ws-frames-bot2.json\` for the raw payloads
(Centrifuge protocol — JSON over WS with method/result/push envelopes).
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
