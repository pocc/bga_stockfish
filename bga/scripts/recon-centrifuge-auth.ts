/**
 * Find where BGA's Centrifuge `credentials` HMAC comes from.
 *
 * Hypotheses:
 *   A) inlined in the page HTML as window.bgaConfig.centrifuge.credentials
 *      (or window.g_centrifuge / window.centrifugeConfiguration.credentials)
 *   B) fetched from a small XHR like /centrifuge/getToken.html before the
 *      WS connects
 *
 * Strategy: load a few BGA pages with cookies, dump:
 *   - the WS connect frame (so we know which value the page used)
 *   - any HTTP response whose body contains a hex-token-shaped string
 *     that matches the WS credentials value
 *   - the full set of window globals matching /centrifuge|credential|token/i
 *
 * Output: recon/centrifuge-auth/{summary.md, requests.json, ws.json, inline.json}
 */
import { chromium, type Request, type Response, type WebSocket } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "recon", "centrifuge-auth");
const authStatePath = path.join(root, "recon", "auth-state.json");

const SKIP = /\.(png|jpe?g|svg|gif|webp|css|woff2?|ico|map|mp4|apng)(\?|$)/i;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authStatePath,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const t0 = Date.now();
  type Req = { method: string; url: string; status?: number; reqBody?: string; respBody?: string; t: number };
  const reqs: Req[] = [];
  type Frame = { url: string; dir: "send" | "recv"; payload: string; t: number };
  const frames: Frame[] = [];

  context.on("request", (r: Request) => {
    if (SKIP.test(r.url())) return;
    reqs.push({ method: r.method(), url: r.url(), reqBody: r.postData()?.slice(0, 800), t: Date.now() - t0 });
  });
  context.on("response", async (resp: Response) => {
    if (SKIP.test(resp.url())) return;
    const rec = reqs.slice().reverse().find((x) => x.url === resp.url() && x.status === undefined);
    if (!rec) return;
    rec.status = resp.status();
    const ct = resp.headers()["content-type"] ?? "";
    if (ct.includes("json") || ct.includes("text") || ct.includes("html") || ct.includes("javascript")) {
      try {
        rec.respBody = (await resp.text()).slice(0, 200_000);
      } catch {}
    }
  });
  context.on("websocket", (ws: WebSocket) => {
    console.log("WS:", ws.url());
    ws.on("framesent", (d) => {
      const p = typeof d.payload === "string" ? d.payload : d.payload.toString("utf8");
      frames.push({ url: ws.url(), dir: "send", payload: p, t: Date.now() - t0 });
    });
    ws.on("framereceived", (d) => {
      const p = typeof d.payload === "string" ? d.payload : d.payload.toString("utf8");
      frames.push({ url: ws.url(), dir: "recv", payload: p, t: Date.now() - t0 });
    });
  });

  // 1. Open a page that actually establishes the Centrifuge connection.
  //    The lobby alone didn't reliably open the WS in the time window, so
  //    prefer a live TABLE page (set TABLE=<id>) — a game page always opens
  //    the connection and subscribes to /table/t<id>. Falls back to lobby.
  //    Wait until we see the `connect` frame (up to 45s) instead of a fixed
  //    sleep, so we don't miss a slow handshake.
  // The /table? page is just the management page — it loads centrifuge.js
  // but never opens the game socket or fetches the token. The realtime
  // connection only opens on the actual GAME page: /<gs>/chess?table=<id>.
  // Provide TABLE and GS (gameserver number) to hit it directly.
  const table = process.env.TABLE;
  const gs = process.env.GS;
  const startUrl = table && gs
    ? `https://boardgamearena.com/${gs}/chess?table=${table}`
    : table
      ? `https://boardgamearena.com/table?table=${table}`
      : "https://boardgamearena.com/lobby";
  // Capture worker-opened websockets too: BGA may open the socket from a
  // web worker, which page-level websocket events miss. A CDP session with
  // Network.enable surfaces Network.webSocketCreated / frame events for the
  // whole target, including workers.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable").catch(() => {});
  const wsUrls: string[] = [];
  cdp.on("Network.webSocketCreated", (e: { url: string }) => { wsUrls.push(e.url); console.log("WS created:", e.url); });
  cdp.on("Network.webSocketFrameSent", (e: { response?: { payloadData?: string } }) => {
    const p = e.response?.payloadData; if (p) frames.push({ url: "cdp", dir: "send", payload: p, t: Date.now() - t0 });
  });
  cdp.on("Network.webSocketFrameReceived", (e: { response?: { payloadData?: string } }) => {
    const p = e.response?.payloadData; if (p) frames.push({ url: "cdp", dir: "recv", payload: p, t: Date.now() - t0 });
  });
  console.log(`loading ${startUrl}`);
  await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch((e) => console.log("goto:", String(e).slice(0, 120)));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (frames.some((f) => f.dir === "send" && /"connect"/.test(f.payload))) break;
    await page.waitForTimeout(1_000);
  }
  // Dump the loaded document HTML too — if the token is inlined in the page
  // rather than fetched, it'll be in here.
  await page.content().then((html) => fs.writeFileSync(path.join(outDir, "page.html"), html)).catch(() => {});

  // 2. Read every global that mentions centrifuge / credential / token
  const inlineJS = `(() => {
    const w = window;
    const out = { url: location.href };
    for (const k of Object.keys(w)) {
      if (!/centrifug|cred|token|bgaConfig|gameConfig/i.test(k)) continue;
      try { out[k] = JSON.parse(JSON.stringify(w[k])); } catch { out[k] = typeof w[k]; }
    }
    return out;
  })()`;
  const inline = await page.evaluate(inlineJS).catch((e: Error) => ({ _err: String(e) }));
  fs.writeFileSync(path.join(outDir, "inline.json"), JSON.stringify(inline, null, 2));

  // 3. Pull the credentials value out of the first connect frame and grep
  //    every recorded response body for it. Whichever HTML/JS contains it
  //    is the source.
  const firstConnect = frames.find((f) => f.dir === "send" && /"connect"/.test(f.payload));
  let cred: string | null = null;
  if (firstConnect) {
    const m = /"credentials":"([0-9a-f]{16,})"/.exec(firstConnect.payload);
    cred = m?.[1] ?? null;
    console.log("connect credentials:", cred);
  } else {
    console.log("no connect frame captured — WS may not have opened");
  }

  // Trace the token to its delivery: scan every captured response body,
  // request body, and the inline document HTML. Whichever contains the
  // exact credentials string is where the browser got it (the endpoint we
  // need to replicate from the Worker).
  const matches: Array<{ url: string; where: "response" | "request" | "page-html"; at: number }> = [];
  if (cred) {
    for (const r of reqs) {
      if (r.respBody) {
        const i = r.respBody.indexOf(cred);
        if (i >= 0) matches.push({ url: r.url, where: "response", at: i });
      }
      if (r.reqBody) {
        const i = r.reqBody.indexOf(cred);
        if (i >= 0) matches.push({ url: r.url, where: "request", at: i });
      }
    }
    try {
      const pageHtml = fs.readFileSync(path.join(outDir, "page.html"), "utf8");
      const i = pageHtml.indexOf(cred);
      if (i >= 0) matches.push({ url: startUrl, where: "page-html", at: i });
    } catch {}
  }

  fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(reqs, null, 2));
  fs.writeFileSync(path.join(outDir, "ws.json"), JSON.stringify(frames, null, 2));

  const lines = [`# Centrifuge auth recon`, ""];
  lines.push(`URL: ${page.url()}`);
  lines.push(`WS sent connect: ${firstConnect ? "yes" : "no"}`);
  lines.push(`Credentials value (HMAC): \`${cred ?? "(none)"}\``);
  lines.push("");
  lines.push(`## Where the credentials string was delivered`);
  if (matches.length === 0) {
    lines.push("- (none — token fetch may not have been captured; check ws.json for the connect frame and requests.json for an XHR fired just before it)");
  } else {
    for (const m of matches) lines.push(`- [${m.where}] ${m.url} (offset ${m.at})`);
  }
  lines.push("");
  lines.push(`## Inline globals matching /centrifug|cred|token|bgaConfig/`);
  lines.push("```json");
  lines.push(JSON.stringify(inline, null, 2).slice(0, 6000));
  lines.push("```");
  fs.writeFileSync(path.join(outDir, "summary.md"), lines.join("\n"));

  await context.close();
  await browser.close();
  console.log(`done. ${path.relative(root, outDir)}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
