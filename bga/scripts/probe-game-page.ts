/** Probe the in-game chess page for g_gamedatas (piece IDs + initial board). */
import { BGAClient } from "../src/client.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

async function main() {
  const c = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await c.login();
  const TABLE = process.env.TABLE ?? "852792152";
  const N = process.env.GS ?? "11";
  const resp = await (c as any).request(
    "GET",
    `https://boardgamearena.com/${N}/chess?table=${TABLE}`,
    undefined,
    { referer: `https://boardgamearena.com/table?table=${TABLE}` },
  );
  const html = await resp.text();
  console.log("status", resp.status, "len", html.length);
  const idx = html.indexOf("g_gamedatas");
  console.log("g_gamedatas idx:", idx);
  fs.writeFileSync(path.join(root, "recon", "game-page.html"), html);
  console.log("wrote recon/game-page.html");
  // grep for known data hooks
  for (const tok of ["gamedatas", "completesetup", "boardpos", "piece_id", "g_game", "g_user", "infos\":", "board\":", "pieces\":", "destinations_by_piece"]) {
    const i = html.indexOf(tok);
    console.log(`  ${tok}: ${i}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
