import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: "/Users/rj/code/bga_stockfish/bga/recon/auth-state.json" });
const page = await ctx.newPage();
for (const url of [
  "https://en.boardgamearena.com/welcome",
  "https://boardgamearena.com/lobby",
  "https://en.boardgamearena.com/gamepanel?game=chess",
]) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const probe = await page.evaluate(() => {
    const w = window as any;
    return {
      url: location.href,
      title: document.title,
      requestToken: w.requestToken ? String(w.requestToken).slice(0, 20) + "..." : null,
      requestTokenLen: String(w.requestToken ?? "").length,
      bgaUser: w.bgaUser ?? null,
      keys: Object.keys(w).filter(k => /token|csrf|auth/i.test(k)),
      htmlHasToken: /requestToken\s*[:=]/.test(document.documentElement.outerHTML) ||
                    /request_token/.test(document.documentElement.outerHTML),
    };
  });
  console.log(JSON.stringify(probe, null, 2));
}
await browser.close();
