/**
 * Probe BGA's table-creation endpoints directly. The lobby-create flow is
 * UI-heavy and our click-walks have been fragile; if we can find the
 * underlying `createnew` endpoint shape we can create a friendly chess
 * table in one POST and skip the clicking entirely.
 *
 * Run inside a page context (so we ride the existing cookies + CSRF
 * token) and try a handful of likely body shapes. Print status + first
 * 600 chars of every response.
 *
 * Output: recon/createnew/probe-results.json
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reconDir = path.join(root, "recon", "createnew");
const authStatePath = path.join(root, "recon", "auth-state.json");

async function main() {
  fs.mkdirSync(reconDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authStatePath,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // Land on a real BGA page so the page context has cookies and a token.
  await page.goto("https://en.boardgamearena.com/welcome", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);

  // Define probes: (url, body) pairs.
  const baseBodies = [
    "game=81",
    "game=81&gamemode=realtime",
    "game=81&gamemode=realtime&mode=async",
    "game=81&gamemode=realtime&forceManual=true",
    "game=81&gamemode=realtime&access=friend",
    "game=81&gamemode=realtime&access=invitation",
    "game=81&gamemode=async",
    "game=81&gamemode=async&access=friend",
    "game=81&gamemode=realtime&numplayers=2",
    "game=81&gamemode=realtime&numplayers=2&access=friend",
    "game=81&gamemode=realtime&numplayers=2&access=friend&simple=true",
    "game=81&gamemode=realtime&numplayers=2&access=friend&realtimemode=normal",
    "game=81&gamemode=realtime&minplayers=2&maxplayers=2",
    // Hotseat-specific guesses
    "game=81&gamemode=realtime&hotseat=true",
    "game=81&gamemode=async&hotseat=true",
  ];
  const urls = [
    "https://boardgamearena.com/table/table/createnew.html",
    "https://en.boardgamearena.com/table/table/createnew.html",
    "https://boardgamearena.com/table/table/createNew.html",
    "https://boardgamearena.com/tablemanager/tablemanager/createnew.html",
    "https://boardgamearena.com/table/table/quickGame.html",
    "https://boardgamearena.com/table/table/createTable.html",
    "https://boardgamearena.com/tablemanager/tablemanager/createTable.html",
  ];

  const results: Array<{
    url: string;
    body: string;
    status: number | string;
    ct: string | null;
    preview: string;
  }> = [];

  for (const url of urls) {
    for (const body of baseBodies) {
      const r = await page.evaluate(
        async ({ url, body }) => {
          try {
            // TournoiEnLigneidt is HttpOnly; can't be read from JS. BGA
            // inlines the CSRF as window.requestToken on every page.
            const w = window as Window & Record<string, unknown>;
            const tok = String(w.requestToken ?? "");
            const resp = await fetch(url, {
              method: "POST",
              credentials: "include",
              headers: {
                "x-request-token": tok,
                "x-requested-with": "XMLHttpRequest",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                accept: "application/json, text/javascript, */*; q=0.01",
              },
              body,
            });
            return {
              status: resp.status,
              ct: resp.headers.get("content-type"),
              tokLen: tok.length,
              preview: (await resp.text()).slice(0, 600),
            };
          } catch (e) {
            return { status: "ERR", ct: null, tokLen: 0, preview: String(e) };
          }
        },
        { url, body },
      );
      results.push({ url, body, ...r });
      const ok = typeof r.status === "number" && r.status < 300;
      const tag = ok ? "✓" : r.status === 404 ? "404" : "✗";
      console.log(`${tag} ${url} :: ${body} → ${r.status} (${r.preview.slice(0, 80).replace(/\n/g, " ")})`);
      if (ok && /table_id|\"id\"|status\":1/.test(r.preview)) {
        console.log("    HIT! body=", body);
      }
    }
  }

  fs.writeFileSync(path.join(reconDir, "probe-results.json"), JSON.stringify(results, null, 2));
  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
