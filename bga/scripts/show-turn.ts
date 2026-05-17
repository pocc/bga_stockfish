/** Fetch the chess game page, parse pieces + destinations_by_piece, print summary. */
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

const FILES = ["a","b","c","d","e","f","g","h"];
// pieces are at y=6/7 for the bot (white) → from white's POV rank 1=y=7, rank 2=y=6,
// so rank = 8 - y. Confirm against piece_id=9 white pawn at (4,6) which is e2 → rank=8-6=2 ✓
function sq(x: number, y: number) { return `${FILES[x]}${8 - y}`; }

async function main() {
  const TABLE = process.env.TABLE ?? "852792152";
  const GS = process.env.GS ?? "11";
  const c = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await c.login();
  const resp = await (c as any).request(
    "GET",
    `https://boardgamearena.com/${GS}/chess?table=${TABLE}`,
    undefined,
    { referer: `https://boardgamearena.com/table?table=${TABLE}` },
  );
  const html = await resp.text();
  fs.writeFileSync(path.join(root, "recon", "game-page.html"), html);

  // Pull g_gamethemeurl-adjacent JSON: it's huge but the keys we care about are stable.
  const pieces = parseJsonAtKey(html, '"pieces":');
  const gamestate = parseJsonAtKey(html, '"gamestate":');
  if (!gamestate) {
    console.log("no gamestate found");
    return;
  }
  const active = gamestate.active_player;
  const stateId = gamestate.id;
  const destByPiece = gamestate?.args?.destinations_by_piece ?? {};
  console.log(`active=${active} state.id=${stateId} (3=play, 2=preMove?)`);
  console.log("--- pieces on board ---");
  if (pieces) {
    for (const p of Object.values(pieces) as any[]) {
      if (p.piece_captured === "1") continue;
      console.log(`  #${p.piece_id.padStart(2,"0")} ${p.piece_color.padEnd(5)} ${p.piece_type.padEnd(6)} @ ${sq(+p.piece_x, +p.piece_y)} (${p.piece_x},${p.piece_y})`);
    }
  }
  console.log("--- legal moves ---");
  for (const [pid, moves] of Object.entries(destByPiece) as any) {
    if (!moves?.length) continue;
    const p = pieces?.[pid];
    const from = p ? sq(+p.piece_x, +p.piece_y) : "?";
    for (const m of moves) {
      const to = sq(m.dest_x, m.dest_y);
      const cap = m.captured?.length ? " x" + m.captured.map((c: any) => sq(c.piece_x, c.piece_y)).join(",") : "";
      const cas = m.queensideCastling ? " O-O-O" : m.kingsideCastling ? " O-O" : "";
      console.log(`  piece=${pid} (${p?.piece_type}) ${from}→${to}${cap}${cas}  X=${m.dest_x} Y=${m.dest_y}`);
    }
  }
}

// Extract the JSON object starting right after `<key>` (key includes `"foo":`).
function parseJsonAtKey(html: string, key: string): any | null {
  const i = html.indexOf(key);
  if (i < 0) return null;
  let start = i + key.length;
  while (start < html.length && /\s/.test(html[start])) start++;
  if (html[start] !== "{") return null;
  // walk braces respecting strings
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < html.length; k++) {
    const ch = html[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, k + 1));
    }
  }
  return null;
}

main().catch((e) => { console.error(e); process.exit(1); });
