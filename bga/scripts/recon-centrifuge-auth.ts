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

  // 1. Load the lobby — the cheapest page that opens a Centrifuge connection.
  console.log("loading /lobby");
  await page.goto("https://boardgamearena.com/lobby", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(10_000);

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

  const matches: Array<{ url: string; where: number }> = [];
  if (cred) {
    for (const r of reqs) {
      if (!r.respBody) continue;
      const idx = r.respBody.indexOf(cred);
      if (idx >= 0) matches.push({ url: r.url, where: idx });
    }
  }

  fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(reqs, null, 2));
  fs.writeFileSync(path.join(outDir, "ws.json"), JSON.stringify(frames, null, 2));

  const lines = [`# Centrifuge auth recon`, ""];
  lines.push(`URL: ${page.url()}`);
  lines.push(`WS sent connect: ${firstConnect ? "yes" : "no"}`);
  lines.push(`Credentials value (HMAC): \`${cred ?? "(none)"}\``);
  lines.push("");
  lines.push(`## Responses containing that credentials string`);
  if (matches.length === 0) {
    lines.push("- (none — credentials probably arrived via HttpOnly cookie or hashed differently)");
  } else {
    for (const m of matches) lines.push(`- ${m.url} (offset ${m.where})`);
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
