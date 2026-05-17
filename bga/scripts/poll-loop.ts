/**
 * Poll BGA for tables that involve the bot, log seat/turn state.
 *
 * Usage:
 *   npx tsx scripts/poll-loop.ts             # every 5s, forever
 *   POLL_MS=10000 npx tsx scripts/poll-loop.ts
 *
 * Just observation for now — once we capture the move endpoint, this
 * loop becomes the bot driver (call playMove when myturn === 1).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { BGAClient, type RawTableInfo } from "../src/client.js";

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

function summarize(t: RawTableInfo, myUid: string): string {
  const meSeat = t.players?.[myUid];
  const others = Object.entries(t.players ?? {})
    .filter(([uid]) => uid !== myUid)
    .map(([uid, p]) => `${p.fullname ?? uid}(${p.table_status ?? "?"})`)
    .join(", ");
  const myTurn = meSeat?.myturn === 1 ? "  ← MY TURN" : "";
  return `t=${t.id} status=${t.status} prog=${t.progression ?? "-"}% meSeat=${meSeat?.table_status ?? "-"} vs ${others || "(none)"}${myTurn}`;
}

async function main() {
  const env = loadEnv();
  const client = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await client.login();
  const uid = await client.resolveUserId();
  console.log(`logged in as ${env.BGA_USERNAME} (uid=${uid})`);

  const intervalMs = Number(process.env.POLL_MS ?? 5000);
  console.log(`polling every ${intervalMs}ms — Ctrl-C to stop\n`);

  let lastSignature = "";
  while (true) {
    try {
      const tables = await client.myTables(81);
      const sig = tables.map((t) => `${t.id}:${t.status}:${t.players?.[uid]?.myturn ?? 0}`).join("|");
      if (sig !== lastSignature) {
        const ts = new Date().toISOString().slice(11, 19);
        console.log(`[${ts}] ${tables.length} table(s)`);
        for (const t of tables) console.log(`  ${summarize(t, uid)}`);
        if (tables.length === 0) console.log("  (no tables involving the bot right now)");
        lastSignature = sig;
      }
    } catch (e) {
      console.log(`poll err: ${String(e).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
