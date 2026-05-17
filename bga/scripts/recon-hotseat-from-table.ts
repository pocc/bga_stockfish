/**
 * Visit an existing table in setup mode and look for the hotseat-add
 * affordance. Logs every visible "Invite" / "Hotseat" / "Add" control
 * with its href / data-* attrs, then attempts to click anything that
 * looks like a hotseat trigger and captures the resulting XHR.
 *
 *   TABLE=<id> npx tsx scripts/recon-hotseat-from-table.ts
 *
 * Output: recon/hotseat-from-table/{summary.md, requests.json, dom.html}
 */
import { chromium, type Request, type Response } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "recon", "hotseat-from-table");
const shotsDir = path.join(outDir, "screenshots");
const authStatePath = path.join(root, "recon", "auth-state.json");

const SKIP = /\.(png|jpe?g|svg|gif|webp|css|woff2?|ico|map|mp4|apng)(\?|$)/i;

interface Req {
  step: string;
  method: string;
  url: string;
  body?: string;
  status?: number;
  preview?: string;
  t: number;
}

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

  step = "01-table-load";
  console.log(`navigating to table ${table}`);
  await page.goto(`https://boardgamearena.com/table?table=${table}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6_000);
  console.log("URL:", page.url());
  await page.screenshot({ path: path.join(shotsDir, "01-load.png"), fullPage: true });

  // Dump full DOM
  const dom = await page.content();
  fs.writeFileSync(path.join(outDir, "dom.html"), dom);

  // Find candidate controls: links / buttons whose text or attrs mention
  // hotseat, invite, add player, second player, etc.
  step = "02-scan";
  const candidates = await page.evaluate(() => {
    const want = /(hotseat|invite|add.*player|second.*player|add.*seat|add.*bot|local.*player)/i;
    const els = Array.from(document.querySelectorAll<HTMLElement>("a, button, [role='button'], [onclick], .bgabutton"));
    const out: Array<{ tag: string; id: string; cls: string; text: string; href: string; onclick: string; visible: boolean }> = [];
    for (const el of els) {
      const text = (el.textContent ?? "").trim().slice(0, 80);
      const onclick = el.getAttribute("onclick") ?? "";
      const href = (el as HTMLAnchorElement).href ?? "";
      const blob = `${text} ${onclick} ${href} ${el.id} ${el.className}`;
      if (!want.test(blob)) continue;
      const rect = el.getBoundingClientRect();
      out.push({
        tag: el.tagName,
        id: el.id,
        cls: typeof el.className === "string" ? el.className.slice(0, 80) : "",
        text,
        href,
        onclick: onclick.slice(0, 200),
        visible: rect.width > 0 && rect.height > 0,
      });
    }
    return out;
  });
  console.log(`found ${candidates.length} candidate controls`);
  fs.writeFileSync(path.join(outDir, "candidates.json"), JSON.stringify(candidates, null, 2));
  for (const c of candidates) console.log(`  [${c.visible ? "v" : "h"}] ${c.tag}#${c.id} .${c.cls.slice(0, 30)} text="${c.text}" onclick=${c.onclick.slice(0, 80)}`);

  // Click each visible "hotseat"-mentioning element in turn.
  step = "03-click-hotseat";
  const hotseatRefs = candidates.filter((c) => c.visible && /hotseat/i.test(`${c.text} ${c.onclick} ${c.id} ${c.cls}`));
  console.log(`\nclicking ${hotseatRefs.length} hotseat element(s)`);
  for (const [i, ref] of hotseatRefs.entries()) {
    step = `03-hotseat-${i}`;
    const sel = ref.id ? `#${ref.id}` : `${ref.tag.toLowerCase()}:has-text("${ref.text.replace(/"/g, '\\"').slice(0, 30)}")`;
    console.log(`  click ${sel}`);
    try {
      await page.locator(sel).first().click({ timeout: 4_000 });
      await page.waitForTimeout(2_500);
      await page.screenshot({ path: path.join(shotsDir, `03-after-${i}.png`), fullPage: true });
    } catch (e) {
      console.log(`  click failed: ${String(e).slice(0, 120)}`);
    }
  }

  // If no hotseat element exists, click "invite" first to open whatever modal
  // it produces, then look again.
  if (hotseatRefs.length === 0) {
    step = "04-click-invite";
    const inviteRefs = candidates.filter((c) => c.visible && /invite/i.test(c.text));
    for (const [i, ref] of inviteRefs.entries()) {
      step = `04-invite-${i}`;
      const sel = ref.id ? `#${ref.id}` : `${ref.tag.toLowerCase()}:has-text("${ref.text.replace(/"/g, '\\"').slice(0, 30)}")`;
      console.log(`  click invite ${sel}`);
      try {
        await page.locator(sel).first().click({ timeout: 4_000 });
        await page.waitForTimeout(2_500);
        await page.screenshot({ path: path.join(shotsDir, `04-after-invite-${i}.png`), fullPage: true });

        // Re-scan for hotseat after invite modal opens
        const after = await page.evaluate(() => {
          const want = /hotseat/i;
          const els = Array.from(document.querySelectorAll<HTMLElement>("a, button, [role='button']"));
          return els
            .filter((e) => want.test(`${e.textContent ?? ""} ${e.getAttribute("onclick") ?? ""} ${e.id} ${e.className}`))
            .map((e) => ({ id: e.id, text: (e.textContent ?? "").trim().slice(0, 60), html: e.outerHTML.slice(0, 200) }));
        });
        console.log(`  post-invite hotseat candidates: ${after.length}`);
        for (const a of after) console.log(`    ${a.id} "${a.text}"`);
        if (after.length > 0) {
          const a = after[0];
          const hsSel = a.id ? `#${a.id}` : `:has-text("${a.text.replace(/"/g, '\\"').slice(0, 20)}")`;
          await page.locator(hsSel).first().click({ timeout: 4_000 }).catch(() => {});
          await page.waitForTimeout(2_500);
          await page.screenshot({ path: path.join(shotsDir, `04-after-hotseat-click.png`), fullPage: true });
        }
      } catch (e) {
        console.log(`  invite click failed: ${String(e).slice(0, 120)}`);
      }
    }
  }

  step = "99-dwell";
  await page.waitForTimeout(2_000);
  fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(reqs, null, 2));

  // Build summary of interesting POSTs that look like state changes.
  const interesting = reqs.filter((r) => r.method === "POST" && /\.html/.test(r.url) && !/\/log\//.test(r.url));
  const lines = [`# Hotseat-from-table recon (table ${table})`, "", `${reqs.length} total requests, ${interesting.length} interesting POSTs`, ""];
  for (const r of interesting) {
    lines.push(`### [${r.step}] ${r.method} ${r.url}`);
    lines.push(`- status=${r.status} body=\`${(r.body ?? "").slice(0, 200)}\``);
    if (r.preview) lines.push(`- preview: \`${r.preview.replace(/\n/g, " ").slice(0, 240)}\``);
    lines.push("");
  }
  fs.writeFileSync(path.join(outDir, "summary.md"), lines.join("\n"));

  await context.close();
  await browser.close();
  console.log(`\ndone. summary: ${path.relative(root, path.join(outDir, "summary.md"))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
