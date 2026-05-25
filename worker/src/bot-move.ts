/**
 * Move selection helpers for the BGA chess bot.
 *
 * The in-game HTML embeds (when it's the bot's turn) two crucial blobs:
 *
 *   "pieces": { "<piece_id>": {piece_id, piece_color, piece_type, piece_x, piece_y, piece_captured } }
 *   "gamestate": { active_player, args: { destinations_by_piece: { "<piece_id>": [{dest_x,dest_y,kingsideCastling?,queensideCastling?,captured?},...] } } }
 *
 * Strategy:
 *   1. Parse pieces + destinations_by_piece from HTML.
 *   2. Build a FEN from the pieces table (placement + active color + castling heuristic).
 *   3. POST that FEN to the local /bestmove engine and get a UCI move ("e2e4").
 *   4. Find the piece on the from-square and the matching destination entry,
 *      return piece_id + dest_x/dest_y for selectCell.
 *   5. If the engine returned a move that doesn't appear in the legal table
 *      (mismatched castling rights, en passant, etc.), fall back to ANY
 *      legal move from the destinations table.
 */

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

export interface Piece {
  piece_id: string;
  piece_color: "white" | "black";
  piece_type: "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
  piece_x: string | number;
  piece_y: string | number;
  piece_captured?: string;
}

export interface Destination {
  dest_x: number;
  dest_y: number;
  kingsideCastling?: boolean;
  queensideCastling?: boolean;
  promotion?: boolean;
  captured?: Array<{ piece_x: number; piece_y: number; piece_id?: string | number }>;
}

export interface GameStateParsed {
  pieces: Record<string, Piece>;
  destinationsByPiece: Record<string, Destination[]>;
  activePlayer: string | null;
  /** Per-player seconds remaining on the chess clock. BGA reports this
   *  as `reflexion.total[playerId]`. Counts down only while it's that
   *  player's turn; goes negative once they overdraw. We use it to
   *  detect opponents who ghosted mid-game on realtime tables. */
  reflexion: Record<string, number> | null;
  /** BGA gamestate.id. For chess: 3 = playerSelectPiece (our normal
   *  move), 4 = playerPromotePawn (must call promotePawn instead of
   *  selectCell), 5 = playerAgreeToDraw, 99 = gameEnd. Used to branch
   *  the play loop when BGA puts the table in a state selectCell can't
   *  resolve (e.g. a pawn that just reached the back rank). */
  gamestateId: number | null;
  /** Map of playerId → BGA zombie flag (1 = zombie). BGA flips this to
   *  1 once a player has left/timed out long enough that BGA itself
   *  starts auto-passing their turns. */
  zombieByPlayer: Record<string, number> | null;
  /** BGA's `neutralized_player_id` field — the player ID BGA has
   *  unilaterally forfeited (most commonly an opponent who quit
   *  mid-game in friendly mode). null when no one has been forfeited. */
  neutralizedPlayerId: string | null;
}

/** Parse the chess game HTML into the structures we need to pick a move. */
export function parseGameHtml(html: string): GameStateParsed | null {
  const pieces = parseJsonAtKey<Record<string, Piece>>(html, '"pieces":');
  const gamestate = parseJsonAtKey<{
    id?: number | string;
    active_player?: string;
    args?: { destinations_by_piece?: Record<string, Destination[]> };
  }>(html, '"gamestate":');
  if (!gamestate || !pieces) return null;
  const reflexionRaw = parseJsonAtKey<{ total?: Record<string, string | number> }>(
    html, '"reflexion":',
  );
  let reflexion: Record<string, number> | null = null;
  if (reflexionRaw?.total && typeof reflexionRaw.total === "object") {
    reflexion = {};
    for (const [pid, secs] of Object.entries(reflexionRaw.total)) {
      const n = Number(secs);
      if (Number.isFinite(n)) reflexion[pid] = n;
    }
  }
  // Players blob carries per-seat zombie flag. The first `"players":`
  // in the HTML is the in-game gamedata copy and reliably has it.
  const playersRaw = parseJsonAtKey<Record<string, { zombie?: number | string }>>(
    html, '"players":',
  );
  let zombieByPlayer: Record<string, number> | null = null;
  if (playersRaw && typeof playersRaw === "object") {
    zombieByPlayer = {};
    for (const [pid, p] of Object.entries(playersRaw)) {
      const z = Number(p?.zombie ?? 0);
      if (Number.isFinite(z)) zombieByPlayer[pid] = z;
    }
  }
  // Top-level scalar field — capture via a narrow regex rather than
  // walking the whole gamedata blob. BGA emits it as
  // `"neutralized_player_id":"99813153"` or `:null`.
  let neutralizedPlayerId: string | null = null;
  const nMatch = /"neutralized_player_id"\s*:\s*("(\d+)"|null|"")/.exec(html);
  // BGA emits "0" (and bare 0 / null / "") to mean "nobody is neutralized".
  // "0" is a truthy string, so it MUST be excluded or every game looks like
  // the opponent quit — which would resign every live game.
  if (nMatch && nMatch[2] && nMatch[2] !== "0") neutralizedPlayerId = nMatch[2];
  const gsId = gamestate.id != null ? Number(gamestate.id) : null;
  return {
    pieces,
    destinationsByPiece: gamestate.args?.destinations_by_piece ?? {},
    activePlayer: gamestate.active_player ?? null,
    reflexion,
    gamestateId: Number.isFinite(gsId) ? gsId : null,
    zombieByPlayer,
    neutralizedPlayerId,
  };
}

/**
 * Pull the opponent's id, display name, and BGA interface-language code out
 * of the live game page. Each player block embeds them as
 * `"user_id":"<id>",…,"language":"xx","player_name":"Name"`. We return the
 * first player block whose id is NOT the bot's — the game page is
 * authoritative, so this corrects a stale name/id cached from an earlier
 * lobby snapshot. That snapshot can be the WRONG player entirely: an open
 * invite may have one player join (and get cached) before that game falls
 * through, then a different player joins the same table id and actually
 * plays. Returns null when no opponent block is found. Non-ASCII names that
 * BGA \\u-escapes won't decode here but still yield a usable id + language.
 */
export function parseOpponent(
  html: string, botUserId: string | undefined,
): { id: string; name: string; language?: string; premium?: boolean } | null {
  const re = /"user_id":"(\d+)"[^{}]*?"language":"([a-z]{2})"[^{}]*?"player_name":"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, id, language, name] = m;
    if (botUserId && id === botUserId) continue;
    // The player object continues past player_name with flat metadata
    // ("grade", "rank", "country", "is_premium", ...) before any nested
    // object. Read is_premium from a bounded slice of this same blob; the
    // window is far shorter than the distance to the next player object, so
    // it can't pick up a neighbour's flag.
    const tail = html.slice(m.index, m.index + 600);
    const prem = /"is_premium":(true|false)/.exec(tail);
    return {
      id, name: decodeBgaName(name), language,
      premium: prem ? prem[1] === "true" : undefined,
    };
  }
  return null;
}

/**
 * Decode the \\u-escaped JSON string escapes BGA leaves in player names that
 * we pull straight out of the page HTML by regex (e.g. "laglo\\u00efre" →
 * "lagloïre"). The captured text came from a JSON string literal, so we
 * re-wrap and JSON.parse it; on any oddity we keep the raw text.
 */
function decodeBgaName(name: string): string {
  if (!name.includes("\\")) return name;
  try {
    return JSON.parse(`"${name.replace(/"/g, "")}"`) as string;
  } catch {
    return name;
  }
}

/**
 * Build a FEN from the live pieces table. Coordinates: BGA uses x=file
 * (0..7 = a..h) and y rows from black's perspective (white pieces start
 * at y=6/7 → ranks 2/1, so rank = 8 - y).
 *
 * Castling rights are derived from BGA's `destinations_by_piece`: a side
 * gets `K`/`k` only when the king actually has a `kingsideCastling`
 * destination available this turn (and similarly for queenside). A
 * static "king on e1 + rook on h1" heuristic produced bogus rights
 * whenever the king moved off and returned, leading the engine to
 * suggest castles BGA refused — and forcing a random fallback. We may
 * understate rights on turns where castling is blocked by check or
 * intermediate attacks, but the engine never proposes an illegal castle.
 *
 * En passant target is derived from BGA's legal-move table (see below).
 * Halfmove clock = 0, fullmove = 1 (BGA doesn't expose move history here, so
 * the engine can't reason about the 50-move rule — acceptable for play).
 */
export function buildFen(
  pieces: Record<string, Piece>,
  activeColor: "white" | "black",
  destinationsByPiece: Record<string, Destination[]> = {},
): string {
  // 8x8 board indexed as [rank=8..1][file=a..h] → board[r][f]
  const board: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const p of Object.values(pieces)) {
    if (p.piece_captured === "1") continue;
    const x = Number(p.piece_x), y = Number(p.piece_y);
    if (x < 0 || x > 7 || y < 0 || y > 7) continue;
    const rankIdx = y; // y=0 → rank 8 → board[0], y=7 → rank 1 → board[7]
    board[rankIdx][x] = pieceLetter(p);
  }
  const ranks: string[] = [];
  for (let r = 0; r < 8; r++) {
    let s = "", blanks = 0;
    for (let f = 0; f < 8; f++) {
      const c = board[r][f];
      if (c == null) blanks++;
      else { if (blanks) { s += String(blanks); blanks = 0; } s += c; }
    }
    if (blanks) s += String(blanks);
    ranks.push(s);
  }
  const placement = ranks.join("/");
  const turn = activeColor === "white" ? "w" : "b";

  // Castling rights — only what BGA says the king can legally do right now.
  let castling = "";
  for (const [pid, dests] of Object.entries(destinationsByPiece)) {
    const p = pieces[pid];
    if (!p || p.piece_type !== "king" || p.piece_captured === "1") continue;
    const isWhite = p.piece_color === "white";
    for (const d of dests ?? []) {
      if (d.kingsideCastling) castling += isWhite ? "K" : "k";
      if (d.queensideCastling) castling += isWhite ? "Q" : "q";
    }
  }
  if (!castling) castling = "-";

  // En passant target, derived from BGA's own legal-move table: an en-passant
  // capture is a pawn destination whose `captured` piece sits on a DIFFERENT
  // square than the destination (the enemy pawn is behind the target square,
  // not on it). The FEN en-passant target is that destination square. Because
  // it comes straight from a move BGA already deems legal, chess.js / the
  // engines always accept it — so the engine can actually find en-passant
  // captures instead of overlooking them (and falling back to a random move).
  // destinationsByPiece only ever holds the side-to-move's moves, matching
  // FEN semantics (ep target is for the player to move).
  let enPassant = "-";
  outer:
  for (const [pid, dests] of Object.entries(destinationsByPiece)) {
    const p = pieces[pid];
    if (!p || p.piece_type !== "pawn" || p.piece_captured === "1") continue;
    for (const d of dests ?? []) {
      for (const cap of d.captured ?? []) {
        if (Number(cap.piece_x) !== d.dest_x || Number(cap.piece_y) !== d.dest_y) {
          enPassant = xyToSq(d.dest_x, d.dest_y);
          break outer;
        }
      }
    }
  }

  return `${placement} ${turn} ${castling} ${enPassant} 0 1`;
}

function pieceLetter(p: Piece): string {
  const map: Record<Piece["piece_type"], string> = {
    pawn: "p", knight: "n", bishop: "b", rook: "r", queen: "q", king: "k",
  };
  const l = map[p.piece_type] ?? "?";
  return p.piece_color === "white" ? l.toUpperCase() : l;
}

export function sqToXY(sq: string): { x: number; y: number } | null {
  if (sq.length < 2) return null;
  const f = sq.charCodeAt(0) - 97; // 'a' = 0
  const r = Number(sq[1]);
  if (f < 0 || f > 7 || !(r >= 1 && r <= 8)) return null;
  return { x: f, y: 8 - r };
}

export function xyToSq(x: number, y: number): string {
  return `${FILES[x]}${8 - y}`;
}

/**
 * Match a UCI move ("e2e4", "e7e8q") to a (piece_id, dest_x, dest_y) tuple
 * by looking up the piece on the from-square and finding a destination
 * entry that matches the to-square. Returns null if no match.
 */
export function lookupUciMove(
  uci: string,
  pieces: Record<string, Piece>,
  destinationsByPiece: Record<string, Destination[]>,
): { pieceId: string; dest: Destination } | null {
  const from = sqToXY(uci.slice(0, 2));
  const to = sqToXY(uci.slice(2, 4));
  if (!from || !to) return null;
  for (const [pid, dests] of Object.entries(destinationsByPiece)) {
    const p = pieces[pid];
    if (!p) continue;
    if (Number(p.piece_x) !== from.x || Number(p.piece_y) !== from.y) continue;
    for (const d of dests) {
      if (d.dest_x === to.x && d.dest_y === to.y) return { pieceId: pid, dest: d };
    }
  }
  return null;
}

/** Pick any legal (piece, destination) from the legal moves table — fallback. */
export function anyLegalMove(
  pieces: Record<string, Piece>,
  destinationsByPiece: Record<string, Destination[]>,
): { pieceId: string; dest: Destination } | null {
  for (const [pid, dests] of Object.entries(destinationsByPiece)) {
    if (!pieces[pid]) continue;
    if (dests && dests.length > 0) return { pieceId: pid, dest: dests[0] };
  }
  return null;
}

/**
 * Walk braces respecting JSON string escaping to extract the first JSON
 * object that appears immediately after `key` in the HTML. Tolerates
 * surrounding whitespace.
 */
function parseJsonAtKey<T>(html: string, key: string): T | null {
  const i = html.indexOf(key);
  if (i < 0) return null;
  let start = i + key.length;
  while (start < html.length && /\s/.test(html[start])) start++;
  if (html[start] !== "{") return null;
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
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, k + 1)) as T; }
        catch { return null; }
      }
    }
  }
  return null;
}
