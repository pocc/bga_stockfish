import { DurableObject } from "cloudflare:workers";
import { Chess } from "chess.js";
import { Game } from "js-chess-engine";
import type { Env } from "./index";
import {
  ENGINE_PRECEDENCE, enginePrecedenceRank, LOCAL_ENGINE, isCacheableEngine,
  isUciLegal, pawnAtSquare,
} from "./engine-precedence";
import { raceWithCeiling } from "./engine-race";

interface BestMoveRequest {
  fen: string;
  movetime?: number;
  depth?: number;
  /** if true, skip chess-api.com and go straight to the local JS engine */
  localOnly?: boolean;
  /** if true, skip the local JS engine and use only chess-api.com */
  remoteOnly?: boolean;
  /** js-chess-engine difficulty level (1-5) for the local engine. Used by
   *  difficulty-limited games; defaults to 3 when omitted. */
  level?: number;
}

export interface EngineAlt {
  engine: string;
  move: string;
  ms: number;
  eval?: number;
  mate?: number | null;
  depth?: number;
  error?: string;
}

interface BestMoveResponse {
  move: string;
  san?: string;
  ponder?: string;
  engine: string;
  ms: number;
  eval?: number;
  mate?: number | null;
  depth?: number;
  continuation?: string[];
  info?: string[];
  /** All engines that ran in the race (winners and failures), in
   *  completion order. Lets callers show every engine's pick. */
  alternatives?: EngineAlt[];
  fallbackReason?: string;
}

const CHESS_API_URL = "https://chess-api.com/v1";
const LICHESS_CLOUD_EVAL_URL = "https://lichess.org/api/cloud-eval";
const STOCKFISH_ONLINE_URL = "https://stockfish.online/api/s/v2.php";
const RAPIDAPI_STOCKFISH_URL = "https://chess-stockfish-16-api.p.rapidapi.com/chess/api";
const RAPIDAPI_STOCKFISH_HOST = "chess-stockfish-16-api.p.rapidapi.com";
/** Wall-clock ceiling for the parallel engine race. The race resolves as soon
 *  as the first *good* (legal, non-local) engine move lands — see the
 *  acceptEarly predicate in handleBestMove — so the common path returns in
 *  whatever a remote engine's real latency is (~1-2s). This ceiling is only
 *  reached when every remote engine is slow or down on the same move; we then
 *  take whatever has settled, else a random legal move. 60s (up from 5s) lets a
 *  slow-but-alive Stockfish still land a real move instead of falling back, and
 *  it's safe because the bot only plays BGA *friendly* games, whose clocks are
 *  ~90 days (see bot-do OPPONENT_INACTIVITY_LIMIT_MS) — a long think can't flag
 *  us. The local js-chess-engine never triggers the early resolve, so a fast
 *  local move can't pre-empt the real engines during this window. */
const RACE_CEILING_MS = 60_000;
/** Per-engine fetch timeouts. The remote Stockfish engines get the full race
 *  window so a slow-but-alive upstream can still land a real move before we
 *  fall back; the race short-circuits on the FIRST good remote answer, so a
 *  long per-engine timeout only actually bites when that engine is the lone
 *  responder. (chess-api was 12s, then 5s while it hung on /v1 POSTs; the
 *  short-circuit now makes a hung upstream harmless — any other remote ends the
 *  race and aborts it — so it can have the full window too.) */
const CHESS_API_TIMEOUT_MS = RACE_CEILING_MS;
const CONTAINER_TIMEOUT_MS = RACE_CEILING_MS;
/** Lichess cloud-eval is a DB lookup, not a search — usually <300ms when it
 *  hits, 404 when it misses. Short timeout so a slow lookup doesn't hold a
 *  connection: if it hasn't answered in 2s it isn't going to. */
const LICHESS_CLOUD_TIMEOUT_MS = 2_000;
const STOCKFISH_ONLINE_TIMEOUT_MS = RACE_CEILING_MS;
const RAPIDAPI_STOCKFISH_TIMEOUT_MS = RACE_CEILING_MS;
/** js-chess-engine search level for the local fallback in a grandmaster game.
 *  Crucially, the local engine is NOT part of the parallel per-move race (see
 *  handleBestMove): it runs at most ONCE, synchronously, AFTER every remote
 *  engine has failed or timed out. That isolation is exactly what lets it be
 *  strong. `game.ai()` allocates a transposition table that scales steeply with
 *  level (~0.25MB at level 1, ~20-40MB at level 5), and the original OOM came
 *  from that table stacking across many concurrent games when the local engine
 *  ran in the race on every move — several at once blew the shared isolate's
 *  128MB ceiling ("exceeded its memory limit and was reset"). As a rare,
 *  serialized last resort, only one such search is ever live at a time, so the
 *  spike is bounded and level 5 (top strength, ~150ms measured) is safe here.
 *  Difficulty (localOnly) games set their level from the opponent's choice. */
const GRANDMASTER_LOCAL_LEVEL = 5;
/** Transposition-table cap (MB) for the grandmaster local fallback. A level-5
 *  search would otherwise grab the Node-profile default (~40MB); a single
 *  ~150ms search doesn't need that much, so we cap it at 16MB. Strength is
 *  unchanged at this depth while peak local allocation stays comfortably under
 *  the shared 128MB isolate even if a search overlaps another game's tick. */
const GRANDMASTER_LOCAL_TT_MB = 16;
// Engine precedence + cache-eligibility helpers live in a pure module
// (./engine-precedence) so unit tests can import them without
// `cloudflare:workers`. Imported at the top for this file's own use and
// re-exported here so existing `from "./stockfish-do"` imports keep working.
export { ENGINE_PRECEDENCE, enginePrecedenceRank, LOCAL_ENGINE, isCacheableEngine };

interface ChessApiResp {
  type?: string;
  move?: string;
  eval?: number;
  mate?: number | null;
  depth?: number;
  centipawns?: string;
  continuationArr?: string[];
  text?: string;
}

interface EngineTaskResult {
  engine: string;
  ok: boolean;
  move?: string;
  ms: number;
  eval?: number;
  mate?: number | null;
  depth?: number;
  continuation?: string[];
  ponder?: string;
  error?: string;
}

async function callChessApi(fen: string, depth: number, signal: AbortSignal): Promise<ChessApiResp> {
  const res = await fetch(CHESS_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fen, depth: Math.min(Math.max(depth, 1), 18), variants: 1 }),
    signal,
  });
  if (!res.ok) throw new Error(`chess-api ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json()) as ChessApiResp;
}

interface LichessCloudEvalResp {
  fen: string;
  knodes: number;
  depth: number;
  pvs: Array<{ moves: string; cp?: number; mate?: number }>;
}

interface LichessCloudResult {
  move?: string;
  eval?: number;
  mate?: number | null;
  depth?: number;
  continuation?: string[];
}

/** Sentinel thrown when Lichess returns 429. Caught by the task wrapper so
 *  the DO can blacklist the engine for a cool-down window. */
class LichessRateLimitedError extends Error {
  constructor() { super("lichess-cloud-eval 429 rate-limited"); }
}

/** GET https://lichess.org/api/cloud-eval?fen=…&multiPv=1
 *  Returns a community-cached Stockfish eval. 404 = "not in cache" — this
 *  is the common case for non-opening positions, so we treat 404 as a
 *  silent miss (empty result) rather than an error. 429 throws a typed
 *  sentinel so the DO can back off. */
async function callLichessCloudEval(fen: string, signal: AbortSignal): Promise<LichessCloudResult> {
  const url = `${LICHESS_CLOUD_EVAL_URL}?fen=${encodeURIComponent(fen)}&multiPv=1`;
  const res = await fetch(url, { signal });
  if (res.status === 404) return {};
  if (res.status === 429) throw new LichessRateLimitedError();
  if (!res.ok) throw new Error(`lichess-cloud-eval ${res.status}: ${await res.text().catch(() => "").then((t) => t.slice(0, 120))}`);
  const data = (await res.json()) as LichessCloudEvalResp;
  const pv = data.pvs?.[0];
  if (!pv?.moves) return {};
  const moves = pv.moves.split(/\s+/);
  return {
    move: moves[0],
    eval: pv.cp != null ? pv.cp / 100 : undefined,
    mate: pv.mate ?? null,
    depth: data.depth,
    continuation: moves,
  };
}

interface StockfishOnlineResp {
  success: boolean;
  evaluation?: number;
  mate?: number | null;
  bestmove?: string;
  continuation?: string;
  data?: string;
}

interface StockfishOnlineResult {
  move?: string;
  ponder?: string;
  eval?: number;
  mate?: number | null;
  continuation?: string[];
}

interface RapidApiStockfishResp {
  position?: string;
  bestmove?: string;
  ponder?: string;
  depth?: number;
}

interface RapidApiStockfishResult {
  move?: string;
  ponder?: string;
  depth?: number;
}

/** POST form-urlencoded fen=… to the RapidAPI Chess Stockfish 16 endpoint.
 *  Depth is fixed server-side at 12 (the depth query param is ignored).
 *  Returns just bestmove + ponder + depth — no eval, no continuation. */
async function callRapidApiStockfish(fen: string, apiKey: string, signal: AbortSignal): Promise<RapidApiStockfishResult> {
  const body = new URLSearchParams({ fen }).toString();
  const res = await fetch(RAPIDAPI_STOCKFISH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-rapidapi-host": RAPIDAPI_STOCKFISH_HOST,
      "x-rapidapi-key": apiKey,
    },
    body,
    signal,
  });
  if (!res.ok) throw new Error(`rapidapi-stockfish ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as RapidApiStockfishResp;
  if (!data.bestmove) return {};
  return { move: data.bestmove, ponder: data.ponder, depth: data.depth };
}

/** GET https://stockfish.online/api/s/v2.php?fen=…&depth=…
 *  Free Stockfish API. Max depth <16. Response.bestmove is the raw UCI
 *  line "bestmove e2e4 ponder c7c5"; parse the second token. */
async function callStockfishOnline(fen: string, depth: number, signal: AbortSignal): Promise<StockfishOnlineResult> {
  const clamped = Math.min(Math.max(depth, 1), 15);
  const url = `${STOCKFISH_ONLINE_URL}?fen=${encodeURIComponent(fen)}&depth=${clamped}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`stockfish.online ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as StockfishOnlineResp;
  if (!data.success || !data.bestmove) return {};
  const parts = data.bestmove.split(/\s+/);
  const moveIdx = parts.indexOf("bestmove");
  const move = moveIdx >= 0 ? parts[moveIdx + 1] : parts[1];
  const ponderIdx = parts.indexOf("ponder");
  const ponder = ponderIdx >= 0 ? parts[ponderIdx + 1] : undefined;
  return {
    move,
    ponder,
    eval: data.evaluation,
    mate: data.mate ?? null,
    continuation: data.continuation ? data.continuation.split(/\s+/) : undefined,
  };
}

/**
 * Run js-chess-engine in alpha-beta search mode for the given FEN and return
 * the chosen move as a UCI string ("e2e4", "e7e8q"). The library returns
 * moves as `{ FROM: TO }` (uppercase squares); we lowercase them and append
 * the promotion piece if the move is a pawn-to-back-rank push.
 *
 * Even level 5 runs in ~150ms here, well under the DO's CPU budget. We run
 * with randomness=0 (deterministic best move): the engine's eval is shallow
 * enough that even a small centipawn threshold buckets dozens of opening
 * moves as "near-equal", so any randomness made it pick junk like a3/Nh3/h4
 * at random — exactly the flank-pawn garbage that looked like a random bot.
 *
 * `ttSizeMB` overrides the library's per-level transposition-table default
 * (which reaches 40MB at level 5 on Node). For a ~150ms search a smaller table
 * captures essentially all the benefit, so the grandmaster fallback caps it to
 * keep the shared isolate's memory comfortably bounded; difficulty games pass
 * nothing and use the default.
 */
function localBestMove(fen: string, level: number, ttSizeMB?: number): string {
  const game = new Game(fen);
  const result = game.ai({
    level, play: false, randomness: 0,
    ...(ttSizeMB != null ? { ttSizeMB } : {}),
  });
  const move = result.move;
  const from = Object.keys(move)[0];
  const to = move[from];
  if (!from || !to) throw new Error(`js-chess-engine returned empty move`);
  const uci = from.toLowerCase() + to.toLowerCase();
  // Add a queen promotion suffix when a PAWN lands on its back rank. The
  // ranks alone aren't enough: a rook/queen/king sitting on rank 7 moving to
  // rank 8 (e.g. a rook lift to a8) also matches "rank 7 → rank 8", and the
  // bogus "q" suffix makes chess.js's isUciLegal reject the move as an
  // illegal promotion. The race then falls through to a random legal move
  // and the dashboard shows a 🎲 Random pill for what was actually a sound
  // engine pick. Check the FEN's board to confirm the from-square holds a
  // pawn of the side to move.
  const toRank = to[1];
  if ((toRank === "8" || toRank === "1") && pawnAtSquare(fen, from)) return uci + "q";
  return uci;
}


/**
 * Wrap a per-engine async task into a never-rejecting promise that always
 * resolves to an EngineTaskResult. Captures wall-clock and error info so the
 * caller can list every engine's outcome in the response.
 */
function makeTask(
  engine: string,
  start: number,
  fn: (signal: AbortSignal) => Promise<Partial<Omit<EngineTaskResult, "engine" | "ok" | "ms" | "error">>>,
): { promise: Promise<EngineTaskResult>; abort: () => void } {
  const ac = new AbortController();
  const promise = (async () => {
    try {
      const partial = await fn(ac.signal);
      if (!partial.move) {
        return { engine, ok: false, ms: Date.now() - start, error: "no move" } satisfies EngineTaskResult;
      }
      return { engine, ok: true, ms: Date.now() - start, ...partial } satisfies EngineTaskResult;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { engine, ok: false, ms: Date.now() - start, error } satisfies EngineTaskResult;
    }
  })();
  return { promise, abort: () => { try { ac.abort(); } catch {} } };
}

/** When Lichess returns 429, skip the cloud-eval task for this many ms.
 *  In-memory only — resets on DO eviction, which is fine for backoff. */
const LICHESS_BACKOFF_MS = 60_000;

export class StockfishEngine extends DurableObject<Env> {
  /** Unix ms; while now < this, the lichess-cloud-eval task is not added
   *  to the race. Set on observed 429 from the upstream. */
  private lichessSkipUntil = 0;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/bestmove" && req.method === "POST") {
      const body = (await req.json()) as BestMoveRequest;
      return this.handleBestMove(body);
    }
    if (url.pathname === "/status") {
      return Response.json({ localEngine: "js-chess-engine" });
    }
    return new Response("not found", { status: 404 });
  }

  private async handleBestMove(req: BestMoveRequest): Promise<Response> {
    const start = Date.now();
    let chess: Chess;
    try {
      chess = new Chess(req.fen);
    } catch (e) {
      return Response.json({ error: "invalid fen", detail: String(e) }, { status: 400 });
    }
    const legal = chess.moves({ verbose: true });
    if (legal.length === 0) {
      return Response.json(
        {
          error: "no legal moves (game over)",
          isCheckmate: chess.isCheckmate(),
          isStalemate: chess.isStalemate(),
        },
        { status: 400 },
      );
    }

    const depth = req.depth ?? 12;

    // Build the parallel race. Each engine returns an EngineTaskResult; the
    // race resolves the instant the first good remote move lands (acceptEarly
    // below), else at min(ceiling, all-settled).
    const tasks: Array<{ promise: Promise<EngineTaskResult>; abort: () => void }> = [];

    if (!req.localOnly) {
      tasks.push(makeTask("chess-api.com", start, async (signal) => {
        const ac = new AbortController();
        signal.addEventListener("abort", () => ac.abort(), { once: true });
        const timer = setTimeout(() => ac.abort(), CHESS_API_TIMEOUT_MS);
        try {
          const apiRes = await callChessApi(req.fen, depth, ac.signal);
          if (!apiRes.move) return {};
          return {
            move: apiRes.move,
            eval: apiRes.eval,
            mate: apiRes.mate ?? null,
            depth: apiRes.depth,
            continuation: apiRes.continuationArr,
          };
        } finally {
          clearTimeout(timer);
        }
      }));

      if (Date.now() >= this.lichessSkipUntil) {
        tasks.push(makeTask("lichess-cloud-eval", start, async (signal) => {
          const ac = new AbortController();
          signal.addEventListener("abort", () => ac.abort(), { once: true });
          const timer = setTimeout(() => ac.abort(), LICHESS_CLOUD_TIMEOUT_MS);
          try {
            return await callLichessCloudEval(req.fen, ac.signal);
          } catch (e) {
            if (e instanceof LichessRateLimitedError) {
              this.lichessSkipUntil = Date.now() + LICHESS_BACKOFF_MS;
            }
            throw e;
          } finally {
            clearTimeout(timer);
          }
        }));
      }

      tasks.push(makeTask("stockfish.online", start, async (signal) => {
        const ac = new AbortController();
        signal.addEventListener("abort", () => ac.abort(), { once: true });
        const timer = setTimeout(() => ac.abort(), STOCKFISH_ONLINE_TIMEOUT_MS);
        try {
          return await callStockfishOnline(req.fen, depth, ac.signal);
        } finally {
          clearTimeout(timer);
        }
      }));

      if (this.env.RAPIDAPI_STOCKFISH_KEY) {
        const apiKey = this.env.RAPIDAPI_STOCKFISH_KEY;
        tasks.push(makeTask("rapidapi-stockfish-16", start, async (signal) => {
          const ac = new AbortController();
          signal.addEventListener("abort", () => ac.abort(), { once: true });
          const timer = setTimeout(() => ac.abort(), RAPIDAPI_STOCKFISH_TIMEOUT_MS);
          try {
            return await callRapidApiStockfish(req.fen, apiKey, ac.signal);
          } finally {
            clearTimeout(timer);
          }
        }));
      }
    }

    // Dormant: container task only runs when STOCKFISH_CONTAINER is bound,
    // which requires the [[containers]] + binding blocks in wrangler.toml to
    // be uncommented. Code stays here so re-enabling is config-only.
    if (!req.localOnly && this.env.STOCKFISH_CONTAINER) {
      tasks.push(makeTask("stockfish-container", start, async (signal) => {
        const containerNs = this.env.STOCKFISH_CONTAINER!;
        const id = containerNs.idFromName("stockfish-container");
        const stub = containerNs.get(id);
        const ac = new AbortController();
        signal.addEventListener("abort", () => ac.abort(), { once: true });
        const timer = setTimeout(() => ac.abort(), CONTAINER_TIMEOUT_MS);
        try {
          const resp = await stub.fetch("https://container/bestmove", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fen: req.fen, movetimeMs: 300 }),
            signal: ac.signal,
          });
          if (!resp.ok) throw new Error(`container http ${resp.status}`);
          const j = (await resp.json()) as { move?: string };
          if (!j.move) return {};
          return { move: j.move };
        } finally {
          clearTimeout(timer);
        }
      }));
    }

    if (req.localOnly) {
      // Difficulty games run ONLY the local engine, in the race, at the
      // requested level — that IS the configured playing strength.
      const level = Math.min(Math.max(req.level ?? 3, 1), 5);
      tasks.push(makeTask(LOCAL_ENGINE, start, async () => {
        const uci = localBestMove(req.fen, level);
        return { move: uci };
      }));
    }
    // Grandmaster games deliberately do NOT add the local engine to the
    // parallel race. It runs once AFTER the race as a strong, serialized
    // fallback (see below) so its big level-5 transposition table can never
    // stack across concurrent games — that stacking was the OOM.

    // End the race on the first usable answer from a real remote engine: it
    // must be legal in this exact position (chess.js is the ground truth). The
    // local js-chess-engine is no longer in the grandmaster race (it runs once
    // after, as the fallback below); for difficulty games it's the only task,
    // so all-settled resolves it. Excluding it here is a belt-and-braces guard
    // so a future change can't let a fast local move pre-empt a real engine.
    const acceptEarly = (r: EngineTaskResult): boolean =>
      r.ok && !!r.move && r.engine !== LOCAL_ENGINE && isUciLegal(legal, r.move);
    const results = await raceWithCeiling(tasks, RACE_CEILING_MS, acceptEarly);

    // Successful engines, by completion order — but only those whose move is
    // actually LEGAL in this exact position. chess.js (`legal`, above) is the
    // legality ground truth; a remote API answering for a stale position or a
    // memory-pressured local search can return a move that leaves our king in
    // check, and submitting it makes BGA reject the whole turn and burns the
    // table's error budget into a needless concede. Drop illegal winners here
    // so the bot never proposes a move BGA will refuse; if that empties the
    // list we fall through to the chess.js random-legal pick below.
    const successful = results.filter(
      (r) => r.ok && r.move && isUciLegal(legal, r.move),
    );

    // Pick winner by precedence: chess-api > wasm > container > local.
    let chosen: EngineTaskResult | null = null;
    for (const name of ENGINE_PRECEDENCE) {
      const m = successful.find((s) => s.engine === name);
      if (m) { chosen = m; break; }
    }
    if (!chosen && successful.length > 0) chosen = successful[0];

    // Grandmaster last resort: every remote engine failed or timed out (the
    // race returned no usable move). Run the local js-chess-engine ONCE now —
    // synchronously, at full strength (GRANDMASTER_LOCAL_LEVEL=5). It is kept
    // OUT of the parallel race precisely so it can be strong here: a level-5
    // search allocates a ~20-40MB transposition table, and running that across
    // many concurrent games every move is what OOM'd the shared 128MB isolate.
    // As a rare, serialized post-race fallback only one such search is ever
    // live, so the spike is bounded and the ~150ms is paid only when the
    // alternative is a random move. Skipped for remoteOnly (no local allowed)
    // and localOnly (already raced above). Pushed into `results` so it shows
    // up in the dashboard's per-engine alternatives like any other engine.
    if (!chosen && !req.localOnly && !req.remoteOnly) {
      try {
        const uci = localBestMove(req.fen, GRANDMASTER_LOCAL_LEVEL, GRANDMASTER_LOCAL_TT_MB);
        const ms = Date.now() - start;
        if (isUciLegal(legal, uci)) {
          chosen = { engine: LOCAL_ENGINE, ok: true, move: uci, ms };
          results.push(chosen);
        } else {
          results.push({ engine: LOCAL_ENGINE, ok: false, ms, move: uci, error: "illegal local move" });
        }
      } catch (e) {
        results.push({
          engine: LOCAL_ENGINE, ok: false, ms: Date.now() - start,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Build the alternatives array: every engine's outcome (including
    // failures) so the dashboard can show full transparency.
    const alternatives: EngineAlt[] = results.map((r) => ({
      engine: r.engine,
      move: r.move ?? "",
      ms: r.ms,
      eval: r.eval,
      mate: r.mate,
      depth: r.depth,
      error: r.error,
    }));

    if (chosen) {
      const san = this.uciToSan(chess, chosen.move!);
      const resp: BestMoveResponse = {
        move: chosen.move!,
        san,
        engine: chosen.engine,
        ms: Date.now() - start,
        eval: chosen.eval,
        mate: chosen.mate,
        depth: chosen.depth,
        continuation: chosen.continuation,
        alternatives,
      };
      return Response.json(resp);
    }

    // No engine returned a usable move within the ceiling → random legal.
    const pick = legal[Math.floor(Math.random() * legal.length)];
    const uci = pick.from + pick.to + (pick.promotion ?? "");
    const reasons = results
      .map((r) => `${r.engine}: ${r.error ?? "no move"}`)
      .join(" | ");
    return Response.json({
      move: uci,
      san: pick.san,
      engine: "random-fallback",
      ms: Date.now() - start,
      alternatives,
      fallbackReason: reasons,
    } satisfies BestMoveResponse);
  }

  private uciToSan(chess: Chess, uci: string): string | undefined {
    try {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.slice(4) || undefined;
      const fresh = new Chess(chess.fen());
      const mv = fresh.move({ from, to, promotion });
      return mv?.san;
    } catch {
      return undefined;
    }
  }
}
