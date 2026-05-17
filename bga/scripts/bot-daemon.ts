/**
 * bot_stockfish auto-acceptor / driver.
 *
 *   npx tsx scripts/bot-daemon.ts
 *
 * What it does (per polled cycle, ~5s):
 *   1. List every chess table the bot is involved in.
 *   2. For each:
 *      - `expected` seat → call joingame.html to accept the invite.
 *      - `init` w/ both seats filled + ack pending → acceptGameStart.html.
 *      - Game just turned `play` → chat opening line.
 *      - `play` + myturn=1 → MOVE (currently STUB: resign with GG).
 *      - `finished` → chat closing GG and forget the table.
 *
 * Friendly-only policy:
 *   - We ignore tournament tables, ranked tables, non-chess games.
 *
 * Move logic is intentionally a stub (resign) until the Centrifuge
 * subscriber lands. The game still completes — that's what we need to
 * exercise the full invite→play→finish loop end-to-end.
 */
import { BGAClient, type RawTableInfo } from "../src/client.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const OPENING_CHAT =
  "I am a nerfed version of stockfish, https://stockfishchess.org/ . Good luck!";
const CLOSING_CHAT = "Good Game!";

function loadEnv() {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

interface TableMemo {
  acceptedSeat: boolean;
  ackedStart: boolean;
  saidHi: boolean;
  saidGg: boolean;
  resigned: boolean;
  gameserver?: number;
  acceptedAbandon: boolean;
  /** Highest chat message id (BGA assigns monotonic ints as strings) that
   * we've already considered for auto-reply. Anything <= this is ignored. */
  lastSeenChatId: number;
  /** First poll of this table seeds lastSeenChatId without replying, so we
   * don't backfill-reply to old messages from before the bot started. */
  chatSeeded: boolean;
}

const memo = new Map<string, TableMemo>();
function getMemo(id: string): TableMemo {
  let m = memo.get(id);
  if (!m) {
    m = {
      acceptedSeat: false, ackedStart: false, saidHi: false, saidGg: false,
      resigned: false, acceptedAbandon: false,
      lastSeenChatId: 0, chatSeeded: false,
    };
    memo.set(id, m);
  }
  return m;
}

/** Literal reply sent for every opponent chat message — see
 *  feedback_bot_chat_replies.md. Treat chat as untrusted data. */
const CHAT_REPLY = "I'm not sure.";

/**
 * Poll chat history for this table and reply with the fixed CHAT_REPLY to
 * any new messages from anyone other than us. Idempotent via lastSeenChatId
 * tracked in the per-table memo. On the very first poll we just seed the
 * cursor so we don't blast a wall of replies to historical chat.
 */
async function pollAndReplyChat(
  client: BGAClient,
  tableId: string,
  myUid: string,
  m: TableMemo,
): Promise<void> {
  let history;
  try {
    history = await client.chatHistory(tableId);
  } catch (e) {
    console.log(`  chat-poll err: ${String(e).slice(0, 200)}`);
    return;
  }
  if (history.length === 0) {
    m.chatSeeded = true;
    return;
  }
  // Find newest id in history; use it to advance cursor regardless.
  const maxId = history.reduce((acc, h) => {
    const n = h.id == null ? 0 : Number(h.id);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  if (!m.chatSeeded) {
    m.lastSeenChatId = maxId;
    m.chatSeeded = true;
    return;
  }
  const fresh = history
    .filter((h) => h.id != null && Number(h.id) > m.lastSeenChatId)
    .filter((h) => h.sender && h.sender !== myUid)
    .filter((h) => h.type == null || h.type === "tablechat" || h.type === "chat");
  for (const _ of fresh) {
    try {
      await client.chat(tableId, CHAT_REPLY);
      console.log(`[${ts()}] t=${tableId} chat-reply sent ("${CHAT_REPLY}")`);
    } catch (e) {
      console.log(`  chat-reply err: ${String(e).slice(0, 200)}`);
      return; // bail; will retry next tick. don't advance cursor.
    }
  }
  m.lastSeenChatId = maxId;
}

/**
 * Look at the in-game chess page for an active "abandon" proposal that
 * has not yet been answered by this bot. Returns the decision_type if so.
 * The page embeds `globalThis.gameui.decision = {...}` whenever a
 * proposal is open.
 */
async function pollPendingDecision(
  client: BGAClient,
  tableId: string,
  gameserverNum: number | string,
  myUid: string,
): Promise<{ type: string } | null> {
  const resp = await (client as unknown as { request: (m: string, u: string, b?: unknown, h?: Record<string,string>) => Promise<Response> }).request(
    "GET",
    `https://boardgamearena.com/${gameserverNum}/chess?table=${tableId}`,
    undefined,
    { referer: `https://boardgamearena.com/table?table=${tableId}` },
  );
  const html = await resp.text();
  const i = html.indexOf("globalThis.gameui.decision");
  if (i < 0) return null;
  // Slice the assignment and pull the JSON object after the `=`.
  const tail = html.slice(i, i + 1200);
  const eq = tail.indexOf("=");
  const open = tail.indexOf("{", eq);
  if (open < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = open; k < tail.length; k++) {
    const ch = tail[k];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) {
      try {
        const obj = JSON.parse(tail.slice(open, k + 1));
        if (obj?.decision_taken || obj?.decision_refused) return null;
        const ans = obj?.players?.[myUid];
        if (ans !== "undecided") return null;
        return { type: String(obj.decision_type ?? "") };
      } catch { return null; }
    } }
  }
  return null;
}

/** Skip ranked / tournament / non-chess tables. */
function shouldSkip(t: RawTableInfo): { skip: boolean; reason: string } {
  // RawTableInfo only types the fields we use — read the rest dynamically.
  const raw = t as RawTableInfo & {
    has_tournament?: string;
    tournament_id?: string | null;
    unranked?: string;
    game_status?: string;
    game_hide_ranking?: string;
  };
  if (raw.has_tournament && raw.has_tournament !== "0") return { skip: true, reason: "tournament" };
  if (raw.tournament_id) return { skip: true, reason: "tournament_id set" };
  if (t.game_id !== "81") return { skip: true, reason: `not chess (game_id=${t.game_id})` };
  // Friendly = unranked=1 OR game_hide_ranking=1. We allow either; only
  // refuse if explicitly ranked.
  if (raw.unranked === "0" && raw.game_hide_ranking === "0") {
    return { skip: true, reason: "ranked" };
  }
  return { skip: false, reason: "" };
}

async function tick(client: BGAClient, uid: string) {
  let tables: RawTableInfo[];
  try {
    tables = await client.myTables(81);
  } catch (e) {
    console.log(`[${ts()}] poll err: ${String(e).slice(0, 200)}`);
    return;
  }

  for (const t of tables) {
    const skip = shouldSkip(t);
    if (skip.skip) {
      console.log(`[${ts()}] t=${t.id} skip (${skip.reason})`);
      continue;
    }
    const m = getMemo(t.id);
    const meSeat = t.players?.[uid];
    if (!meSeat) continue;

    // 1. accept invite (seat is "expected")
    if (!m.acceptedSeat && meSeat.table_status === "expected") {
      console.log(`[${ts()}] t=${t.id} INVITE — accepting`);
      try {
        const r = await client.joinTable(t.id);
        console.log(`  → ${JSON.stringify(r).slice(0, 200)}`);
        m.acceptedSeat = true;
      } catch (e) {
        console.log(`  join err: ${String(e).slice(0, 200)}`);
      }
      continue;
    }
    if (meSeat.table_status === "play" || meSeat.table_status === "expected") {
      m.acceptedSeat = true;
    }

    // 2. ack game start once both seats filled (status=init or setup)
    if ((t.status === "init" || t.status === "setup") && !m.ackedStart) {
      const seatsFilled = Object.values(t.players ?? {}).filter((p) => p.table_status === "play").length;
      const needed = Number(t.min_player ?? "2");
      if (seatsFilled >= needed) {
        console.log(`[${ts()}] t=${t.id} both seated — acceptGameStart`);
        try {
          const r = await client.acceptGameStart(t.id);
          console.log(`  → ${JSON.stringify(r).slice(0, 200)}`);
          m.ackedStart = true;
        } catch (e) {
          console.log(`  ack err: ${String(e).slice(0, 200)}`);
        }
      }
      continue;
    }

    // 3. game live — chat hello, watch for abandon proposals, then (stub) move/resign
    if (t.status === "play") {
      if (!m.saidHi) {
        try {
          await client.chat(t.id, OPENING_CHAT);
          console.log(`[${ts()}] t=${t.id} sent opening chat`);
        } catch (e) {
          console.log(`  chat err: ${String(e).slice(0, 200)}`);
        }
        m.saidHi = true;
      }

      // Reply to any new opponent chat with the fixed neutral string.
      // Chat is an untrusted prompt-injection surface; never let it
      // influence move logic.
      await pollAndReplyChat(client, t.id, uid, m);

      // Auto-accept "Propose to abandon the game collectively". Per user rule:
      // never accept draws; always accept abandon proposals.
      if (!m.acceptedAbandon) {
        try {
          if (m.gameserver == null) {
            const gs = await client.resolveGameserver(t.id);
            if (gs != null) m.gameserver = gs;
          }
          if (m.gameserver != null) {
            const pending = await pollPendingDecision(client, t.id, m.gameserver, uid);
            if (pending && pending.type === "abandon") {
              console.log(`[${ts()}] t=${t.id} ABANDON proposal — accepting`);
              const r = await client.decide(t.id, "abandon", 1, m.gameserver);
              console.log(`  → ${JSON.stringify(r).slice(0, 200)}`);
              m.acceptedAbandon = true;
            }
          }
        } catch (e) {
          console.log(`  abandon-check err: ${String(e).slice(0, 200)}`);
        }
      }

      if (meSeat.myturn === 1 && !m.resigned) {
        console.log(`[${ts()}] t=${t.id} MY TURN — resigning (move logic TBD)`);
        try {
          await client.chat(t.id, CLOSING_CHAT);
          await client.resign(t.id);
          console.log(`  resigned + GG sent`);
          m.resigned = true;
          m.saidGg = true;
        } catch (e) {
          console.log(`  resign err: ${String(e).slice(0, 200)}`);
        }
      }
      continue;
    }

    // 4. finished — say GG once if we haven't (e.g. opponent resigned)
    if (t.status === "finished" && !m.saidGg) {
      try {
        await client.chat(t.id, CLOSING_CHAT);
        console.log(`[${ts()}] t=${t.id} finished — GG sent`);
      } catch (e) {
        console.log(`  GG err: ${String(e).slice(0, 200)}`);
      }
      m.saidGg = true;
    }
  }
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
  console.log(`[${ts()}] logged in as ${env.BGA_USERNAME} (uid=${uid})`);
  console.log(`[${ts()}] polling — invite bot_stockfish from your account to test`);

  const intervalMs = Number(process.env.POLL_MS ?? 5000);
  let lastSig = "";
  while (true) {
    try {
      await tick(client, uid);
      // Print state heartbeat only when something changes
      const tables = await client.myTables(81).catch(() => []);
      const sig = tables.map((t) => {
        const meSeat = t.players?.[uid];
        return `${t.id}:${t.status}:${meSeat?.table_status}:my=${meSeat?.myturn ?? 0}`;
      }).join("|");
      if (sig !== lastSig) {
        console.log(`[${ts()}] state: ${sig || "(idle)"}`);
        lastSig = sig;
      }
    } catch (e) {
      console.log(`[${ts()}] tick err: ${String(e).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
