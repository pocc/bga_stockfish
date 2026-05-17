/**
 * Reproduce the bot's exact create→changeOption→publish sequence from inside
 * a real Chrome (Playwright) page so we get real cookies + CSRF for free.
 *
 * For each variant we record the actual table.status BGA returns via
 * tableinfos, then leave the table. This isolates whether changeOption
 * (Training/Friendly toggle) is what's demoting realtime→async, or
 * whether the bot's HTTP environment is.
 *
 * Run:  cd bga && npx tsx scripts/probe-friendly-flow.ts
 * Output: recon/friendly-flow/results.json + console table
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "recon", "friendly-flow");
const authStatePath = path.join(root, "recon", "auth-state.json");

type ChangeOption = { id: number; value: number; method?: "GET" | "POST" };
type Variant = {
  label: string;
  changeOptions: ChangeOption[];
};

const VARIANTS: Variant[] = [
  { label: "createnew only (no changeOption)", changeOptions: [] },
  { label: "POST changeoption(201,1) [our current bot code]", changeOptions: [{ id: 201, value: 1, method: "POST" }] },
  { label: "GET changeoption(201,1) [matches real UI HAR]", changeOptions: [{ id: 201, value: 1, method: "GET" }] },
  { label: "GET changeoption(201,0) then GET (201,1) [HAR toggle sequence]", changeOptions: [{ id: 201, value: 0, method: "GET" }, { id: 201, value: 1, method: "GET" }] },
];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authStatePath,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // Land somewhere where the HTML contains the request_token. BGA
  // inlines it but no longer exposes it as window.requestToken, so we
  // scrape the rendered DOM/HTML to fetch a valid CSRF.
  await page.goto("https://en.boardgamearena.com/account", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_500);
  const tok = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    // BGA tokens are now short (~15 char) base62, not the old long hex.
    const m =
      /requestToken\s*[:=]\s*['"]([A-Za-z0-9_-]{10,128})['"]/.exec(html) ??
      /name=["']request_token["']\s+value=["']([A-Za-z0-9_-]{10,128})["']/i.exec(html) ??
      /["']request_token["']\s*[:=]\s*["']([A-Za-z0-9_-]{10,128})['"]/i.exec(html);
    return m?.[1] ?? null;
  });
  if (!tok) {
    console.error("Could not scrape request_token from /account HTML — login expired?");
    process.exit(1);
  }
  console.log(`Got requestToken (${tok.length} chars)`);

  const results = [];
  for (const v of VARIANTS) {
    console.log(`\n=== ${v.label} ===`);
    const result = await page.evaluate(
      async ({ cos, tok }: { cos: { id: number; value: number; method?: "GET" | "POST" }[]; tok: string }) => {
        const headers = {
          "x-request-token": tok,
          "x-requested-with": "XMLHttpRequest",
          accept: "application/json, text/javascript, */*; q=0.01",
        };
        const formHeaders = {
          ...headers,
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        };

        const createQs = new URLSearchParams({
          game: "81",
          gamemode: "realtime",
          forceManual: "true",
          is_meeting: "false",
          "dojo.preventCache": String(Date.now()),
        });
        const createResp = await fetch(
          `https://boardgamearena.com/table/table/createnew.html?${createQs}`,
          { method: "GET", credentials: "include", headers },
        );
        const createJson = (await createResp.json()) as { status?: number; data?: { table?: number } };
        const tableId = createJson?.data?.table;
        if (!tableId) {
          return { error: "createnew failed", createBody: JSON.stringify(createJson).slice(0, 300) };
        }

        const changeOptionResps: { method: string; id: number; value: number; status: number; body: string }[] = [];
        for (const co of cos) {
          const method = co.method ?? "POST";
          let r: Response;
          if (method === "GET") {
            const qs = new URLSearchParams({
              table: String(tableId),
              id: String(co.id),
              value: String(co.value),
              "dojo.preventCache": String(Date.now()),
            });
            r = await fetch(
              `https://boardgamearena.com/table/table/changeoption.html?${qs}`,
              { method: "GET", credentials: "include", headers },
            );
          } else {
            r = await fetch(
              "https://boardgamearena.com/table/table/changeoption.html",
              {
                method: "POST",
                credentials: "include",
                headers: formHeaders,
                body: new URLSearchParams({
                  table: String(tableId),
                  id: String(co.id),
                  value: String(co.value),
                }).toString(),
              },
            );
          }
          changeOptionResps.push({ method, id: co.id, value: co.value, status: r.status, body: (await r.text()).slice(0, 200) });
        }

        const pubResp = await fetch(
          "https://boardgamearena.com/table/table/openTableNow.html",
          {
            method: "POST",
            credentials: "include",
            headers: formHeaders,
            body: new URLSearchParams({ table: String(tableId) }).toString(),
          },
        );
        const pubBody = (await pubResp.text()).slice(0, 200);

        // Poll tableinfos across status filters.
        let actualStatus: string | null = null;
        for (let i = 0; i < 6 && !actualStatus; i++) {
          await new Promise((r) => setTimeout(r, 400));
          for (const s of ["open", "asyncopen", "init", "setup"]) {
            const r = await fetch(
              "https://boardgamearena.com/tablemanager/tablemanager/tableinfos.html",
              {
                method: "POST",
                credentials: "include",
                headers: formHeaders,
                body: new URLSearchParams({ status: s, games: "81", turninfo: "false" }).toString(),
              },
            );
            const j = (await r.json()) as
              { data?: { tables?: Record<string, { status?: string }> } };
            const t = j?.data?.tables?.[String(tableId)];
            if (t?.status) { actualStatus = t.status; break; }
          }
        }

        // Leave so BGA doesn't accumulate stale invites.
        await fetch("https://boardgamearena.com/table/table/quitgame.html", {
          method: "POST",
          credentials: "include",
          headers: formHeaders,
          body: new URLSearchParams({ table: String(tableId), neutralized: "true" }).toString(),
        });

        return {
          tableId,
          createOk: createJson?.status === 1,
          changeOptions: changeOptionResps,
          openTableNowStatus: pubResp.status,
          openTableNowBody: pubBody,
          actualStatus,
        };
      },
      { cos: v.changeOptions, tok },
    );
    const r = result as Record<string, unknown>;
    const verdict =
      r.actualStatus === "open" ? "REALTIME ✓"
      : r.actualStatus === "asyncopen" ? "ASYNC ✗"
      : `?(${r.actualStatus ?? "not-found"})`;
    console.log(`  table=${r.tableId} actualStatus=${r.actualStatus} → ${verdict}`);
    if (Array.isArray(r.changeOptions) && r.changeOptions.length) console.log(`  changeOption resps:`, r.changeOptions);
    results.push({ label: v.label, verdict, ...r });
  }

  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  console.log("\nSummary:");
  for (const r of results) {
    console.log(`  ${(r.verdict as string).padEnd(20)} ${r.label}`);
  }

  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
