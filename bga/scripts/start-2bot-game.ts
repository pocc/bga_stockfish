/**
 * Seat bot_stockfish2 at TABLE then start the game from bot_stockfish.
 * Once started, we can run probe-table-page.ts against the live table
 * to capture playMove / resign / WS frames.
 *
 *   TABLE=<id> npx tsx scripts/start-2bot-game.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { BGAClient } from "../src/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  const tableArg = process.env.TABLE;
  const env = loadEnv();

  const bot1 = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await bot1.login();
  const uid1 = await bot1.resolveUserId();
  console.log(`bot1: ${env.BGA_USERNAME} uid=${uid1}`);

  // 0. Resolve table — create one if not provided.
  let table: number;
  if (tableArg) {
    table = Number(tableArg);
    console.log(`using existing table ${table}`);
  } else {
    table = await bot1.createTable(81);
    console.log(`created table ${table}`);
  }
  console.log(`SPECTATE: https://boardgamearena.com/table?table=${table}`);

  // 1. bot2 logs in to its own cookie jar + joins.
  const bot2 = new BGAClient({
    username: env.BGA_USERNAME2,
    password: env.BGA_PASSWORD2,
    cookieJarPath: path.join(root, "recon", "client-cookies-bot2.json"),
  });
  await bot2.login();
  const uid2 = await bot2.resolveUserId();
  console.log(`bot2: ${env.BGA_USERNAME2} uid=${uid2}`);

  const joinResp = await bot2.joinTable(table);
  console.log(`join: ${JSON.stringify(joinResp).slice(0, 300)}`);

  // 2. Confirm both seated via bot1's view.
  const beforeStart = await bot1.myTables(81);
  const t = beforeStart.find((x) => x.id === String(table));
  console.log(`seats: ${JSON.stringify(t?.players ?? {}).slice(0, 400)}`);

  // 3. bot1 starts the game.
  const startResp = await bot1.startTable(table);
  console.log(`start: ${JSON.stringify(startResp).slice(0, 300)}`);

  // 4. Poll once more to confirm state moved to "play".
  await new Promise((r) => setTimeout(r, 2_000));
  const afterStart = await bot1.myTables(81);
  const t2 = afterStart.find((x) => x.id === String(table));
  console.log(`post-start status=${t2?.status} progression=${t2?.progression}`);
  console.log(`\nDone. Now run: TABLE=${table} npx tsx scripts/probe-table-page.ts`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
