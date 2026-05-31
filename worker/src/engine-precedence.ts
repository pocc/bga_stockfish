/**
 * Pure engine-precedence + cache-eligibility helpers.
 *
 * Extracted from stockfish-do.ts so unit tests can import them without
 * dragging in `cloudflare:workers` (stockfish-do.ts is a Durable Object and
 * imports that at module load). stockfish-do.ts re-exports these for its own
 * callers; bot-do.ts imports them through that re-export.
 */

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
