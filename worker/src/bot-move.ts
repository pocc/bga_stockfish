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
  stateId: number | string | null;
}

/** Parse the chess game HTML into the structures we need to pick a move. */
export function parseGameHtml(html: string): GameStateParsed | null {
  const pieces = parseJsonAtKey<Record<string, Piece>>(html, '"pieces":');
  const gamestate = parseJsonAtKey<{
    active_player?: string;
    id?: number | string;
    args?: { destinations_by_piece?: Record<string, Destination[]> };
  }>(html, '"gamestate":');
  if (!gamestate || !pieces) return null;
  return {
    pieces,
    destinationsByPiece: gamestate.args?.destinations_by_piece ?? {},
    activePlayer: gamestate.active_player ?? null,
    stateId: gamestate.id ?? null,
  };
}

/**
 * Build a FEN from the live pieces table. Coordinates: BGA uses x=file
 * (0..7 = a..h) and y rows from black's perspective (white pieces start
 * at y=6/7 → ranks 2/1, so rank = 8 - y).
 *
 * Castling rights are a heuristic: include each side only if king is home
 * AND that side's rook is home. False positives (king/rook returned to
 * home without ever having moved) are rare and stockfish self-corrects
 * by simply not playing the illegal castle.
 *
 * En passant target is left as '-'. Halfmove clock = 0, fullmove = 1.
 */
export function buildFen(pieces: Record<string, Piece>, activeColor: "white" | "black"): string {
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

  // Castling rights heuristic
  const at = (color: "white" | "black", type: Piece["piece_type"], x: number, y: number) =>
    Object.values(pieces).some(
      (p) => p.piece_captured !== "1" && p.piece_color === color && p.piece_type === type
        && Number(p.piece_x) === x && Number(p.piece_y) === y,
    );
  let castling = "";
  // White king home is e1 = (4,7); rooks a1=(0,7), h1=(7,7).
  if (at("white", "king", 4, 7)) {
    if (at("white", "rook", 7, 7)) castling += "K";
    if (at("white", "rook", 0, 7)) castling += "Q";
  }
  // Black king home is e8 = (4,0); rooks a8=(0,0), h8=(7,0).
  if (at("black", "king", 4, 0)) {
    if (at("black", "rook", 7, 0)) castling += "k";
    if (at("black", "rook", 0, 0)) castling += "q";
  }
  if (!castling) castling = "-";

  return `${placement} ${turn} ${castling} - 0 1`;
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
