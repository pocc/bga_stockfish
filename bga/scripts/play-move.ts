/** One-shot: play a single chess move via selectCell. Usage:
 *   TABLE=<id> GS=<gameserver> PIECE=<id> X=<0-7> Y=<0-7> npx tsx scripts/play-move.ts
 */
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
  const TABLE = process.env.TABLE!;
  const GS = process.env.GS!;
  const PIECE = process.env.PIECE!;
  const X = Number(process.env.X);
  const Y = Number(process.env.Y);
  if (!TABLE || !GS || !PIECE || Number.isNaN(X) || Number.isNaN(Y)) {
    throw new Error("required env: TABLE GS PIECE X Y");
  }
  const c = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await c.login();
  console.log(`selectCell: table=${TABLE} gs=${GS} piece=${PIECE} → (${X},${Y})`);
  const r = await c.selectCell(GS, TABLE, X, Y, PIECE);
  console.log("→", JSON.stringify(r).slice(0, 300));
  const w = await c.wakeup(GS, TABLE);
  console.log("wakeup →", JSON.stringify(w).slice(0, 200));
}
main().catch((e) => { console.error(e); process.exit(1); });
