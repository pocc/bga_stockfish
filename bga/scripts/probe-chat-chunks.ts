/**
 * Validate that the bot's chunked greeting actually lands on BGA: replicate
 * the worker's sendChat() chunking (LIMIT=220, word-boundary) + 2s spacing,
 * send a real multi-chunk greeting to a throwaway table, then read chat
 * history back and confirm every chunk arrived (BGA's anti-flood silently
 * drops chats fired too fast — this proves 2s clears it).
 *
 *   npx tsx scripts/probe-chat-chunks.ts            # creates a throwaway table
 *   TABLE=<id> npx tsx scripts/probe-chat-chunks.ts # use an existing table
 *   GAP_MS=100 npx tsx scripts/probe-chat-chunks.ts # prove a short gap drops chunks
 */
import { BGAClient } from "../src/client.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

// Mirror of worker/src/chat.ts chunkChat (sentence/line-aligned).
function splitLongLine(line: string, limit: number): string[] {
  const out: string[] = [];
  for (const sentence of line.split(/(?<=[.!?])\s+/)) {
    if (sentence.length <= limit) { out.push(sentence); continue; }
    let cur = "";
    for (const word of sentence.split(" ")) {
      if (cur && cur.length + 1 + word.length > limit) { out.push(cur); cur = word; }
      else cur = cur ? `${cur} ${word}` : word;
    }
    if (cur) out.push(cur);
  }
  return out;
}
function chunk(msg: string, limit = 220): string[] {
  const chunks: string[] = [];
  let cur = "";
  const flush = () => { const t = cur.trim(); if (t) chunks.push(t); cur = ""; };
  const addLine = (line: string) => {
    const candidate = cur === "" ? line : `${cur}\n${line}`;
    if (candidate.length <= limit) { cur = candidate; return; }
    flush();
    if (line.length <= limit) { cur = line; return; }
    for (const seg of splitLongLine(line, limit)) {
      if (cur && cur.length + 1 + seg.length > limit) flush();
      cur = cur ? `${cur} ${seg}` : seg;
    }
  };
  for (const line of msg.split("\n")) addLine(line);
  flush();
  return chunks;
}

// The live EN realtime greeting (multi-chunk on purpose).
const GREETING =
  "Hi! I'm bot_stockfish, a chess bot on Board Game Arena https://stockfish.ross.gg/ \n" +
  "In realtime games I default to expert level (~1800) with a fast local engine, so my moves are instant.\n\n" +
  "Want to change the difficulty? Before your first move, type one of these five words to set my level:\n\n" +
  "beginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\ngrandmaster (~2800)\n\nGood luck!";

async function main() {
  const env = loadEnv();
  const gapMs = Number(process.env.GAP_MS ?? 2000);
  const client = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  const me = await client.login();
  console.log(`logged in as ${me.username} (${me.userId})`);

  let table = process.env.TABLE;
  let created = false;
  if (!table) {
    table = String(await client.createTable(81));
    created = true;
    console.log(`created throwaway table ${table}`);
  } else {
    console.log(`using existing table ${table}`);
  }

  const chunks = chunk(GREETING);
  // A unique ASCII tag so we can find exactly these chunks in history and not
  // confuse them with prior runs (avoid non-ASCII: BGA may HTML-encode it).
  const tag = `RUN${Date.now() % 100000}`;
  console.log(`\nsending ${chunks.length} chunks, ${gapMs}ms apart, tag=${tag}`);
  const sent: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
    const text = `${tag}-${i + 1}of${chunks.length} ${chunks[i]}`;
    const env2 = await client.chat(table, text);
    const status = (env2 as { status?: number | string }).status;
    console.log(`  chunk ${i + 1}: ${text.length} chars · status=${status}`);
    sent.push(text);
  }

  // Let BGA settle, then read history back.
  await new Promise((r) => setTimeout(r, 2500));
  const history = await client.chatHistory(table);
  console.log(`\nraw history (${history.length} msgs):`);
  for (const m of history) console.log("  •", JSON.stringify(m.msg ?? "").slice(0, 120));
  const landed = sent.map((s, i) => {
    const found = history.some((m) => (m.msg ?? "").includes(`${tag}-${i + 1}of`));
    return { chunk: i + 1, landed: found };
  });

  console.log(`\nchat history has ${history.length} messages`);
  for (const l of landed) console.log(`  chunk ${l.chunk}: ${l.landed ? "LANDED ✓" : "MISSING ✗"}`);
  const ok = landed.every((l) => l.landed);
  console.log(`\nRESULT: ${ok ? "ALL CHUNKS LANDED" : "SOME CHUNKS DROPPED"} (gap=${gapMs}ms)`);

  if (created) {
    await client.quitTable(table).catch((e) => console.log("cleanup quit failed:", String(e).slice(0, 100)));
    console.log(`cleaned up table ${table}`);
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
