import { chromium } from "playwright";
import fs from "node:fs";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: "/Users/rj/code/bga_stockfish/bga/recon/auth-state.json" });
const page = await ctx.newPage();
for (const url of [
  "https://en.boardgamearena.com/account",
  "https://boardgamearena.com/account",
  "https://en.boardgamearena.com/welcome",
  "https://boardgamearena.com/lobby",
]) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const html = await page.content();
  const matches = [...html.matchAll(/request[_-]?token/gi)].slice(0, 5);
  console.log(`${url} → ${page.url()} matches:${matches.length} len=${html.length}`);
  for (const m of matches) {
    const i = m.index!;
    console.log(`  ...${html.slice(Math.max(0, i - 30), i + 80).replace(/\n/g, " ")}...`);
  }
  if (matches.length === 0) {
    fs.writeFileSync(`/tmp/page-${url.replace(/[^a-z]/gi, "_")}.html`, html.slice(0, 5000));
  }
}
await browser.close();
