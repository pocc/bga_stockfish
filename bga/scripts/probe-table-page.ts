/**
 * Visit an existing chess table in Playwright with full capture so we can
 * (a) see which gameserver host the in-game requests go to and
 * (b) read window.g_gamedatas / centrifugeConfiguration / the move
 *     payloads sent over WebSocket.
 *
 * TABLE=<id> npx tsx scripts/probe-table-page.ts
 */
import { chromium, type Request, type Response, type WebSocket } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "recon", "table-page");
const authStatePath = path.join(root, "recon", "auth-state.json");

async function main() {
  const table = process.env.TABLE;
  if (!table) throw new Error("set TABLE=<id>");
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authStatePath,
    recordHar: { path: path.join(outDir, `table-${table}.har`), content: "embed" },
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const start = Date.now();
  const reqs: Array<{ method: string; url: string; status?: number; ct?: string; body?: string; preview?: string; t: number }> = [];
  const wsFrames: Array<{ url: string; dir: "sent" | "received"; payload: string; t: number }> = [];

  context.on("request", (r: Request) => {
    if (/\.(png|jpe?g|svg|gif|webp|css|woff2?|ico|map|mp4|apng)(\?|$)/i.test(r.url())) return;
    reqs.push({ method: r.method(), url: r.url(), body: r.postData()?.slice(0, 1000), t: Date.now() - start });
  });
  context.on("response", async (resp: Response) => {
    if (/\.(png|jpe?g|svg|gif|webp|css|woff2?|ico|map|mp4|apng)(\?|$)/i.test(resp.url())) return;
    const r = reqs.slice().reverse().find((x) => x.url === resp.url() && x.status === undefined);
    if (!r) return;
    r.status = resp.status();
    r.ct = resp.headers()["content-type"];
    if (r.ct?.includes("json") || r.ct?.includes("text") || r.ct?.includes("html")) {
      r.preview = (await resp.text().catch(() => "")).slice(0, 1500);
    }
  });
  context.on("websocket", (ws: WebSocket) => {
    console.log("WS:", ws.url());
    ws.on("framesent", (d) => {
      const p = typeof d.payload === "string" ? d.payload : d.payload.toString("utf8");
      wsFrames.push({ url: ws.url(), dir: "sent", payload: p, t: Date.now() - start });
    });
    ws.on("framereceived", (d) => {
      const p = typeof d.payload === "string" ? d.payload : d.payload.toString("utf8");
      wsFrames.push({ url: ws.url(), dir: "received", payload: p, t: Date.now() - start });
    });
  });

  // /table?table=ID is the canonical table URL — BGA redirects to the
  // proper /<server>/<game>?table=ID page.
  console.log(`navigating to https://boardgamearena.com/table?table=${table}`);
  await page.goto(`https://boardgamearena.com/table?table=${table}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8_000);
  console.log("final URL:", page.url());
  await page.screenshot({ path: path.join(outDir, `table-${table}.png`), fullPage: true });

  // Dump globals
  // Use a plain string so tsx doesn't inject __name / decorator helpers
  // (Playwright runs this in the page, where those helpers don't exist).
  const inlineJS = `(() => {
    const w = window;
    function safe(k) { try { return JSON.parse(JSON.stringify(w[k])); } catch { return typeof w[k]; } }
    const out = { url: location.href, title: document.title };
    for (const k of Object.keys(w)) {
      if (k.startsWith('g_') || /centrifuge/i.test(k) || k === 'requestToken' || k === 'bgaConfig') {
        out[k] = safe(k);
      }
    }
    for (const k of ['gameui_chess','gameui','ebg','dojo']) {
      if (w[k]) out['_typeof_'+k] = typeof w[k];
    }
    return out;
  })()`;
  const inline = await page.evaluate(inlineJS).catch((e: Error) => ({ _err: String(e) }));
  fs.writeFileSync(path.join(outDir, `inline-${table}.json`), JSON.stringify(inline, null, 2));

  // Wait a bit more so any background XHRs / WS frames land.
  const dwell = Number(process.env.DWELL_MS ?? 30_000);
  console.log(`dwelling ${dwell}ms (set DWELL_MS to change)`);
  await page.waitForTimeout(dwell);
  await page.screenshot({ path: path.join(outDir, `table-${table}-end.png`), fullPage: true });

  fs.writeFileSync(path.join(outDir, `requests-${table}.json`), JSON.stringify(reqs, null, 2));
  fs.writeFileSync(path.join(outDir, `ws-${table}.json`), JSON.stringify(wsFrames, null, 2));

  await context.close();
  await browser.close();
  console.log("done. wrote requests, ws frames, inline globals, screenshots in recon/table-page/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
