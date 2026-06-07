/**
 * Pure engine-precedence + cache-eligibility + move-legality helpers.
 *
 * Extracted from stockfish-do.ts so unit tests can import them without
 * dragging in `cloudflare:workers` (stockfish-do.ts is a Durable Object and
 * imports that at module load). stockfish-do.ts re-exports these for its own
 * callers; bot-do.ts imports them through that re-export.
 */

/** A legal move as chess.js reports it (`chess.moves({ verbose: true })`). */
export interface VerboseMove {
  from: string;
  to: string;
  promotion?: string;
}

/**
 * Is `uci` ("e2e4", "e7e8q") present in chess.js's legal-move list for the
 * current position? The engine race takes the winning move verbatim from
 * whichever engine resolved first, but a remote API can answer for a slightly
 * stale/different position and a memory-pressured local search can emit
 * garbage. Submitting an illegal move makes BGA reject our whole turn
 * ("You can't expose your king to check…"), which burns the table's error
 * budget into a needless concede. Gating the winner on chess.js — the legality
 * ground truth for the exact FEN we searched — means the engine never proposes
 * a move BGA will refuse. A UCI that omits the promotion piece on a promoting
 * move is tolerated as a queen promotion (our local engine always appends `q`,
 * but a bare remote answer shouldn't be discarded).
 */
export function isUciLegal(legal: readonly VerboseMove[], uci: string): boolean {
  if (uci.length < 4) return false;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.slice(4).toLowerCase() || undefined;
  return legal.some(
    (m) =>
      m.from === from &&
      m.to === to &&
      ((m.promotion ?? undefined) === promo ||
        (promo === undefined && m.promotion === "q")),
  );
}

/**
 * True if the FEN's piece placement field has a pawn (of either color) on the
 * given square. Used by the local engine wrapper to decide whether to append a
 * queen-promotion suffix to a UCI move: js-chess-engine returns moves as
 * `{FROM: TO}` with no piece-type info, so we'd otherwise have to guess from
 * the from/to ranks alone — and rank-7→8 (or rank-2→1) matches plenty of
 * legitimate non-pawn moves (a rook lift to a8, a queen sweep up the file).
 * Tagging those as "q" promotions makes chess.js reject the move as illegal
 * and the race falls through to a random legal pick. `sq` may be upper- or
 * lower-case ("A7" or "a7"). Lives here so unit tests can import it without
 * dragging in `cloudflare:workers` from stockfish-do.ts.
 */
export function pawnAtSquare(fen: string, sq: string): boolean {
  if (sq.length < 2) return false;
  const c = sq.charCodeAt(0);
  const file = c >= 97 ? c - 97 : c - 65;
  const rank = Number(sq[1]);
  if (file < 0 || file > 7 || !(rank >= 1 && rank <= 8)) return false;
  const placement = fen.split(" ")[0] ?? "";
  const rows = placement.split("/");
  if (rows.length !== 8) return false;
  const row = rows[8 - rank]; // FEN rank 8 first, rank 1 last
  let col = 0;
  for (const ch of row) {
    if (ch >= "1" && ch <= "8") col += Number(ch);
    else {
      if (col === file) return ch === "p" || ch === "P";
      col++;
    }
  }
  return false;
}

/** Engine race order, strongest first. The winner of a parallel race is the
 *  lowest-ranked engine here that returned a usable move. lichess-cloud-eval
 *  serves community-cached evals at very deep nominal depths but misses for
 *  most non-opening positions; stockfish.online outranks chess-api.com on
 *  both availability and average depth; stockfish-container is dormant
 *  (binding commented out) but kept so re-enabling is just an uncomment;
 *  js-chess-engine is the local pure-JS last resort. */
export const ENGINE_PRECEDENCE = [
  "lichess-cloud-eval",
  "stockfish.online",
  "chess-api.com",
  "rapidapi-stockfish-16",
  "stockfish-container",
  "js-chess-engine (local DO)",
];

/** Rank of an engine in ENGINE_PRECEDENCE (lower = stronger). Unknown
 *  engines sort last so they never displace a ranked cache entry. */
export function enginePrecedenceRank(engine: string): number {
  const i = ENGINE_PRECEDENCE.indexOf(engine);
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}

/** The one ENGINE_PRECEDENCE entry that is NOT a remote Stockfish/lichess
 *  API — a pure-JS engine running locally in the DO. Cache writes exclude it
 *  so the shared move cache holds only strong, shareable remote verdicts. */
export const LOCAL_ENGINE = "js-chess-engine (local DO)";

/** The exact set of engine source strings whose verdicts may enter the shared
 *  move cache: the remote Stockfish APIs (chess-api.com, stockfish.online,
 *  rapidapi-stockfish-16, and the dormant self-hosted stockfish-container)
 *  plus lichess's community cloud eval.
 *
 *  This is a POSITIVE allowlist, deliberately NOT derived as "everything in
 *  ENGINE_PRECEDENCE except the local engine". Spelling out the cacheable
 *  sources means adding a future non-Stockfish engine to the race can never
 *  silently make it cacheable — it has to be added here on purpose. Everything
 *  not listed (the local js-chess-engine, the random fallback, `cache:*`
 *  re-hits, and any unknown source) is excluded. */
export const CACHEABLE_ENGINES: ReadonlySet<string> = new Set([
  "lichess-cloud-eval",
  "stockfish.online",
  "chess-api.com",
  "rapidapi-stockfish-16",
  "stockfish-container",
]);

/** True if `engine` is a Stockfish/lichess source whose verdict is worth
 *  caching for reuse across games. This is the guarantee behind "only requests
 *  to Stockfish engines or lichess enter the cache" — and the same predicate
 *  the cache purge uses to decide which existing entries to evict. */
export function isCacheableEngine(engine: string): boolean {
  return CACHEABLE_ENGINES.has(engine);
}
