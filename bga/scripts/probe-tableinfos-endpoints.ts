/**
 * One-off probe: compare the two `tableinfos.html?id=<id>` variants for a
 * recently-finished game and see which one returns a usable status
 * (finished + scores) so the worker can detect game-end after the lobby
 * snapshot has rolled the table off.
 *
 * Usage:
 *   npx tsx scripts/probe-tableinfos-endpoints.ts <tableId>
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loginViaUI } from "./lib/login-flow";

// Minimal .env.local loader so we don't need the dotenv package.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

async function main() {
  const tableId = process.argv[2] ?? "852863829";
  const username = process.env.BGA_USERNAME;
  const password = process.env.BGA_PASSWORD;
  if (!username || !password) throw new Error("BGA_USERNAME/PASSWORD missing in bga/.env.local");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    await loginViaUI(context, username, password);
    const page = await context.newPage();

    // BGA's "Invalid session" guard requires a fresh request token bound to
    // the current page. Navigate to the table page first so subsequent
    // fetches inherit the in-page token via the same execution context.
    await page.goto(`https://boardgamearena.com/table?table=${tableId}`, {
      waitUntil: "domcontentloaded",
    }).catch(() => {});
    await page.waitForTimeout(2_000);
    // Also try the gamepanel + lobby — at least one should set a working token.
    await page.goto("https://boardgamearena.com/gamelist", {
      waitUntil: "domcontentloaded",
    }).catch(() => {});
    await page.waitForTimeout(1_500);

    const urls = [
      // (A) what the worker currently uses
      `https://en.boardgamearena.com/tablemanager/tablemanager/tableinfos.html?id=${tableId}&dojo.preventCache=${Date.now()}`,
      // (B) what BGA's per-table page uses post-game (from HAR)
      `https://boardgamearena.com/table/table/tableinfos.html?id=${tableId}&nosuggest=true&table=${tableId}&noerrortracking=true&dojo.preventCache=${Date.now()}`,
      // (C) en. mirror of (B) in case of geo redirect
      `https://en.boardgamearena.com/table/table/tableinfos.html?id=${tableId}&nosuggest=true&table=${tableId}&noerrortracking=true&dojo.preventCache=${Date.now()}`,
      // (D) tableratingsupdate — also called post-game
      `https://boardgamearena.com/table/table/tableratingsupdate.html?id=${tableId}&table=${tableId}&dojo.preventCache=${Date.now()}`,
    ];

    // BGA uses the TournoiEnLigneidt cookie value as the x-request-token
    // header for AJAX endpoints — same pattern as worker/src/bga-client.ts.
    const cookies = await context.cookies();
    const idt = cookies.find((c) => c.name === "TournoiEnLigneidt")?.value;
    console.log("idt token present:", !!idt, idt ? `(${idt.length} chars)` : "");

    for (const url of urls) {
      console.log("=".repeat(70));
      console.log("URL:", url);
      try {
        // page.request inherits the context's cookies. We add x-request-token
        // manually from the idt cookie.
        const resp = await context.request.get(url, {
          headers: {
            "x-requested-with": "XMLHttpRequest",
            ...(idt ? { "x-request-token": idt } : {}),
            accept: "application/json, text/javascript, */*; q=0.01",
          },
        });
        const status = resp.status();
        const text = await resp.text();
        console.log(`status=${status} bytes=${text.length}`);
        try {
          const j = JSON.parse(text);
          console.log("status field:", j.status, "  error:", j.error?.slice?.(0, 200));
          const data = j.data ?? j;
          // Try multiple shapes BGA uses.
          if (data && typeof data === "object") {
            // (a) lobby shape: data.tables[<id>]
            const tables = data.tables;
            if (tables && typeof tables === "object") {
              for (const [tid, t] of Object.entries<any>(tables)) {
                const seats = Object.entries<any>(t.players ?? {}).map(([pid, p]: [string, any]) => ({
                  pid, status: p.table_status, score: p.score, gamewinner: p.gamewinner,
                }));
                console.log(`  table ${tid}: status=${t.status} game=${t.game_id} seats=${JSON.stringify(seats)}`);
              }
            } else {
              // (b) per-table shape: data is the table itself
              const interesting = [
                "id", "status", "game_id", "table_creator", "game_name",
                "result", "gamestate", "scores", "table_status",
              ];
              for (const k of interesting) {
                if (data[k] !== undefined) console.log(`  ${k}: ${typeof data[k] === "object" ? JSON.stringify(data[k]).slice(0, 200) : data[k]}`);
              }
              if (data.players) {
                console.log("  players:");
                for (const [pid, p] of Object.entries<any>(data.players)) {
                  const keys = ["table_status","score","gamewinner","name","rank_winner"];
                  const out: any = { pid };
                  for (const k of keys) if (p[k] !== undefined) out[k] = p[k];
                  console.log("    ", JSON.stringify(out));
                }
              }
              console.log("  all top-level keys:", Object.keys(data).slice(0, 40));
            }
          }
        } catch {
          console.log("  not JSON, first 500 chars:", text.slice(0, 500));
        }
      } catch (e: any) {
        console.log("  FAILED:", e?.message);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
