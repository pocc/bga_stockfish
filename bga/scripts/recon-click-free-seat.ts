/**
 * Click the empty "free" seat in the seating panel and capture whatever
 * modal/menu/XHR appears. That's where BGA exposes the hotseat option
 * (per the seating panel UI screenshot).
 *
 *   TABLE=<id> npx tsx scripts/recon-click-free-seat.ts
 */
import { chromium, type Request, type Response } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "recon", "free-seat");
const shotsDir = path.join(outDir, "screenshots");
const authStatePath = path.join(root, "recon", "auth-state.json");
const SKIP = /\.(png|jpe?g|svg|gif|webp|css|woff2?|ico|map|mp4|apng)(\?|$)/i;

async function main() {
  const table = process.env.TABLE;
  if (!table) throw new Error("set TABLE=<id>");
  fs.mkdirSync(shotsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authStatePath,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const start = Date.now();
  type Req = { step: string; method: string; url: string; body?: string; status?: number; preview?: string; t: number };
  const reqs: Req[] = [];
  let step = "init";

  context.on("request", (r: Request) => {
    if (SKIP.test(r.url())) return;
    reqs.push({ step, method: r.method(), url: r.url(), body: r.postData()?.slice(0, 1500), t: Date.now() - start });
  });
  context.on("response", async (resp: Response) => {
    if (SKIP.test(resp.url())) return;
    const rec = reqs.slice().reverse().find((x) => x.url === resp.url() && x.status === undefined);
    if (!rec) return;
    rec.status = resp.status();
    const ct = resp.headers()["content-type"] ?? "";
    if (ct.includes("json") || ct.includes("text") || ct.includes("html")) {
      rec.preview = (await resp.text().catch(() => "")).slice(0, 1500);
    }
  });

  step = "01-load";
  await page.goto(`https://boardgamearena.com/table?table=${table}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5_000);
  await page.screenshot({ path: path.join(shotsDir, "01-load.png"), fullPage: true });

  // 1. Find every free seat slot. The DOM uses BGA's svelte components:
  //    .bga-lobby-player-slots__slot--free
  step = "02-free-seats";
  const freeSeats = await page.locator(".bga-lobby-player-slots__slot--free").count();
  console.log(`free seats: ${freeSeats}`);

  if (freeSeats === 0) {
    console.log("no free seats — table may already be full");
  } else {
    // Click the first free seat
    step = "03-click-seat";
    console.log("clicking first free seat");
    await page.locator(".bga-lobby-player-slots__slot--free").first().click({ timeout: 5_000 }).catch((e) => console.log(`click err: ${e}`));
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: path.join(shotsDir, "03-after-click.png"), fullPage: true });

    // What appeared? Dump any popover/modal text.
    const popover = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(
        "[class*='popover'], [class*='popper'], [class*='modal'], [class*='dialog'], [role='dialog'], [role='menu']",
      ));
      return candidates
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((e) => ({
          cls: typeof e.className === "string" ? e.className.slice(0, 100) : "",
          text: (e.textContent ?? "").trim().slice(0, 400),
          html: e.outerHTML.slice(0, 600),
        }));
    });
    console.log(`visible popovers: ${popover.length}`);
    for (const p of popover) console.log(`  cls=${p.cls.slice(0, 60)} text="${p.text.slice(0, 100)}"`);
    fs.writeFileSync(path.join(outDir, "popovers.json"), JSON.stringify(popover, null, 2));

    // 2. If a hotseat affordance is visible, click it.
    step = "04-click-hotseat";
    const hotseatLoc = page.locator("text=/hotseat/i").first();
    if (await hotseatLoc.count().catch(() => 0)) {
      console.log("clicking 'hotseat'");
      await hotseatLoc.click({ timeout: 4_000 }).catch((e) => console.log(`hotseat click err: ${e}`));
      await page.waitForTimeout(3_000);
      await page.screenshot({ path: path.join(shotsDir, "04-after-hotseat.png"), fullPage: true });
    } else {
      console.log("no 'hotseat' affordance found on popover");
      // Save the full DOM for inspection
      fs.writeFileSync(path.join(outDir, "dom-after-seat-click.html"), await page.content());
    }
  }

  step = "99-end";
  await page.waitForTimeout(1_000);
  fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(reqs, null, 2));

  // Summary of POSTs that look like state changes
  const lines = [`# Free-seat click recon (table ${table})`, ""];
  const interesting = reqs.filter((r) => r.method === "POST" && /\.html/.test(r.url));
  for (const r of interesting) {
    lines.push(`### [${r.step}] ${r.method} ${r.url}`);
    lines.push(`- status=${r.status} body=\`${(r.body ?? "").slice(0, 200)}\``);
    if (r.preview) lines.push(`- preview: \`${r.preview.replace(/\n/g, " ").slice(0, 240)}\``);
    lines.push("");
  }
  fs.writeFileSync(path.join(outDir, "summary.md"), lines.join("\n"));

  await context.close();
  await browser.close();
  console.log(`\ndone. ${path.relative(root, path.join(outDir, "summary.md"))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
