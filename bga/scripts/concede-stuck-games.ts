/**
 * Concede in-progress chess tables where the bot never sent its opening
 * "I am a nerfed version of stockfish..." chat. Those tables represent
 * games where the bot wired up but failed to fully engage.
 *
 * Usage:
 *   tsx bga/scripts/concede-stuck-games.ts            # dry run (default)
 *   tsx bga/scripts/concede-stuck-games.ts --apply    # actually resign
 */
import { BGAClient } from "../src/client.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OPENING_PREFIX = "I am a nerfed version of stockfish";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const apply = process.argv.includes("--apply");

const c = new BGAClient({
  username: env.BGA_USERNAME,
  password: env.BGA_PASSWORD,
  cookieJarPath: path.join(root, "recon", "client-cookies.json"),
});

await c.login();
const uid = await c.resolveUserId();
console.log(`logged in as uid=${uid}`);

const all = await c.myTables(81);
const byStatus = all.reduce<Record<string, number>>((acc, t) => {
  acc[t.status] = (acc[t.status] ?? 0) + 1;
  return acc;
}, {});
console.log(`found ${all.length} bot table(s); status breakdown: ${JSON.stringify(byStatus)}`);
// "Games in progress" on the BGA UI includes anything that's not "finished"
// and where the seat is taken — covers play, asyncplay, async, etc.
const playing = all.filter((t) => t.status !== "finished" && t.status !== "open");
console.log(`${playing.length} table(s) are in-progress (anything not finished/open)`);

type Row = {
  id: string; status: string; sentOpening: boolean; chatCount: number;
  opponent: string | null; botTurn: boolean | null;
};
const rows: Row[] = [];

for (const t of playing) {
  const seatIds = Object.keys(t.players ?? {});
  const opponent = seatIds.find((s) => s !== uid) ?? null;
  // The lobby tableinfos endpoint doesn't populate `myturn`. Resolve the
  // gameserver and scrape `active_player` from the rendered chess page.
  let botTurn: boolean | null = null;
  try {
    const gs = await c.resolveGameserver(t.id);
    if (gs != null) {
      const resp = await (c as any).request(
        "GET",
        `https://boardgamearena.com/${gs}/chess?table=${t.id}`,
        undefined,
        { referer: `https://boardgamearena.com/table?table=${t.id}` },
      );
      const html = await resp.text();
      const m = /"active_player"\s*:\s*"(\d+)"/.exec(html);
      if (m) botTurn = m[1] === uid;
    }
  } catch (e) {
    console.warn(`  [${t.id}] gameserver/page fetch failed: ${String(e).slice(0, 120)}`);
  }
  let sentOpening = false;
  let chatCount = 0;
  try {
    const history = await c.chatHistory(t.id);
    chatCount = history.length;
    sentOpening = history.some(
      (h) => h.sender === uid && typeof h.msg === "string" && h.msg.startsWith(OPENING_PREFIX),
    );
  } catch (e) {
    console.warn(`  [${t.id}] chatHistory failed: ${String(e).slice(0, 120)}`);
  }
  rows.push({ id: t.id, status: t.status, sentOpening, chatCount, opponent, botTurn });
}

// "Stuck" criterion: bot is on move AND opening was sent — i.e. the bot is
// engaged but not moving. Plus any table where the opening never went out.
const stuck = rows.filter((r) => !r.sentOpening || r.botTurn === true);

console.log(`\n--- summary ---`);
for (const r of rows) {
  const tag = !r.sentOpening ? "NO_OPEN"
            : r.botTurn === true ? "BOT_TRN"
            : r.botTurn === false ? "opp_trn"
            : "?      ";
  console.log(`  ${tag} table=${r.id} status=${r.status} opp=${r.opponent ?? "?"} chats=${r.chatCount}`);
}
const noOpen = rows.filter((r) => !r.sentOpening).length;
const botTurn = rows.filter((r) => r.botTurn === true).length;
const oppTurn = rows.filter((r) => r.botTurn === false).length;
console.log(`\nno-opening=${noOpen}  bot's-turn=${botTurn}  opp's-turn=${oppTurn}  total=${rows.length}`);
console.log(`stuck (would concede): ${stuck.length}`);

if (!apply) {
  console.log(`\nDRY RUN. Re-run with --apply to resign the ${stuck.length} stuck table(s).`);
  process.exit(0);
}

if (stuck.length === 0) {
  console.log(`nothing to do.`);
  process.exit(0);
}

console.log(`\n--- applying ---`);
for (const r of stuck) {
  try {
    const resp = await c.quitTable(r.id);
    console.log(`  resigned ${r.id} → ${JSON.stringify(resp).slice(0, 160)}`);
  } catch (e) {
    console.log(`  resign ${r.id} FAILED: ${String(e).slice(0, 200)}`);
  }
}
console.log(`done.`);
