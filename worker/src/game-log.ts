/**
 * Reconstruct a finished chess game's move list from BGA's archive replay
 * log (`archive/archive/logs.html`). Pure functions, no network — the bot
 * driver fetches the log and feeds it here at finish so historical games
 * carry a replayable move list and final FEN.
 *
 * BGA logs each move as a `pieceMoved` notification whose `notation` is a
 * long-algebraic string with unicode piece glyphs, e.g. "♙e2-e4",
 * "♛d8×d5♙", "0-0". Castling is emitted as TWO consecutive pieceMoved
 * entries (king then rook) that share the same "0-0"/"0-0-0" notation.
 */
import { Game } from "js-chess-engine";

export interface RawMoveEntry {
  player_id: string;
  notation: string;
}

export interface Reconstruction {
  /** UCI-style coordinate moves: "e2e4", "e1g1" (castle), "g7g8q" (promo). */
  uci: string[];
  /** Final position FEN, or null if the moves couldn't be cleanly replayed. */
  finalFen: string | null;
}

const PAWN_GLYPHS = new Set(["♙", "♟"]); // ♙ ♟

function strip(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

/**
 * Walk the archive-log JSON in document order and pull out every
 * `pieceMoved` notification as {player_id, notation}. Order is preserved,
 * which is what makes a faithful replay possible.
 */
export function parseGameLog(json: unknown): RawMoveEntry[] {
  const out: RawMoveEntry[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const v of node) visit(v); return; }
    const rec = node as Record<string, unknown>;
    if (rec.type === "pieceMoved" && rec.args && typeof rec.args === "object") {
      const a = rec.args as Record<string, unknown>;
      const notation = strip(String(a.notation ?? rec.log ?? ""));
      const player_id = String(a.player_id ?? "");
      if (notation) out.push({ player_id, notation });
    }
    for (const k of Object.keys(rec)) visit(rec[k]);
  };
  visit(json);
  return out;
}

interface ParsedMove {
  playerId: string;
  castle?: "k" | "q";
  from?: string; // uppercase, e.g. "E2"
  to?: string;
  promo?: "q"; // BGA logs promotion implicitly; default to queen
}

function parseOne(entry: RawMoveEntry): ParsedMove | null {
  const n = entry.notation;
  if (/0-0-0/.test(n)) return { playerId: entry.player_id, castle: "q" };
  if (/0-0/.test(n)) return { playerId: entry.player_id, castle: "k" };
  const sqs = n.match(/[a-h][1-8]/g);
  if (!sqs || sqs.length < 2) return null;
  const from = sqs[0].toUpperCase();
  const to = sqs[sqs.length - 1].toUpperCase();
  // Promotion: a pawn (leading glyph) reaching the back rank. BGA omits the
  // "=Q" suffix, so assume a queen (matches BGA's own auto-promotion).
  const leadGlyph = [...n][0];
  const toRank = to[1];
  const promo = PAWN_GLYPHS.has(leadGlyph) && (toRank === "8" || toRank === "1")
    ? "q" as const
    : undefined;
  return { playerId: entry.player_id, from, to, promo };
}

/**
 * Turn ordered pieceMoved entries into a UCI move list and (best-effort)
 * the final FEN. The first mover is White, which fixes the castling ranks.
 */
export function reconstructMoves(entries: RawMoveEntry[]): Reconstruction {
  if (entries.length === 0) return { uci: [], finalFen: null };
  const whiteId = entries[0].player_id;

  const moves: ParsedMove[] = [];
  let clean = true;
  for (const e of entries) {
    const p = parseOne(e);
    if (!p) { clean = false; continue; }
    // Collapse the rook half of a castle: BGA emits the same "0-0" notation
    // twice (king move + rook move) for one castling action.
    const prev = moves[moves.length - 1];
    if (p.castle && prev && prev.castle === p.castle && prev.playerId === p.playerId) {
      continue;
    }
    moves.push(p);
  }

  const uci: string[] = [];
  for (const m of moves) {
    if (m.castle) {
      const rank = m.playerId === whiteId ? "1" : "8";
      const to = (m.castle === "k" ? "g" : "c") + rank;
      uci.push("e" + rank + to);
    } else if (m.from && m.to) {
      uci.push(m.from.toLowerCase() + m.to.toLowerCase() + (m.promo ?? ""));
    }
  }

  let finalFen: string | null = null;
  if (clean) {
    try {
      const g = new Game();
      for (const m of moves) {
        if (m.castle) {
          const rank = m.playerId === whiteId ? "1" : "8";
          const to = (m.castle === "k" ? "G" : "C") + rank;
          g.move("E" + rank, to);
        } else if (m.from && m.to) {
          g.move(m.from, m.to);
        }
      }
      finalFen = g.exportFEN();
    } catch {
      finalFen = null;
    }
  }

  return { uci, finalFen };
}
