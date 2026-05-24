import { DurableObject } from "cloudflare:workers";
import { Chess } from "chess.js";
import { Game } from "js-chess-engine";
import type { Env } from "./index";

interface BestMoveRequest {
  fen: string;
  movetime?: number;
  depth?: number;
  /** if true, skip chess-api.com and go straight to the local JS engine */
  localOnly?: boolean;
  /** if true, skip the local JS engine and use only chess-api.com */
  remoteOnly?: boolean;
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
/** Wall-clock ceiling for the parallel engine race. Whichever engines have
 *  returned by this point are considered; we then pick the preferred one by
 *  precedence. */
const RACE_CEILING_MS = 5_000;
/** Per-engine timeouts. All capped at RACE_CEILING_MS so a stuck upstream
 *  can't pace the race longer than the ceiling. chess-api was 12s; the
 *  service has been hanging forever on /v1 POSTs, so 5s lets us bail early
 *  and let the local engines win the race. */
const CHESS_API_TIMEOUT_MS = 5_000;
const CONTAINER_TIMEOUT_MS = 5_000;
/** Lichess cloud-eval is a DB lookup, not a search — usually <300ms when it
 *  hits, 404 when it misses. Short timeout so a slow lookup doesn't paint
 *  the move log with stalls. */
const LICHESS_CLOUD_TIMEOUT_MS = 2_000;
const STOCKFISH_ONLINE_TIMEOUT_MS = 5_000;
const RAPIDAPI_STOCKFISH_TIMEOUT_MS = 5_000;
/** Precedence for picking the winner among completed engines. Lower index
 *  beats higher. Engines not in the list lose to engines in the list.
 *  lichess-cloud-eval sits at #0 because when it hits it returns
 *  community-cached evals at very deep nominal depths (typically 30-75+);
 *  it misses for most non-opening positions, in which case the next engine
 *  wins. stockfish-container is dormant (binding is commented out in
 *  wrangler.toml) but kept here so re-enabling is just an uncomment. */
export const ENGINE_PRECEDENCE = [
  "lichess-cloud-eval",
  "chess-api.com",
  "stockfish.online",
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
 * Level 3 keeps per-call CPU well under the DO's 30s budget on early-game
 * positions while still playing several hundred ELO above random. The
 * randomness=20 cp threshold keeps it from playing the same opening every
 * game without sacrificing real moves.
 */
function localBestMove(fen: string, level: number): string {
  const game = new Game(fen);
  const result = game.ai({ level, play: false, randomness: 20 });
  const move = result.move;
  const from = Object.keys(move)[0];
  const to = move[from];
  if (!from || !to) throw new Error(`js-chess-engine returned empty move`);
  const uci = from.toLowerCase() + to.toLowerCase();
  // Add a queen promotion suffix when a pawn lands on its back rank.
  const toRank = to[1];
  const isPawnPush = /^[a-hA-H]2$|^[a-hA-H]7$/.test(from);
  if (isPawnPush && (toRank === "8" || toRank === "1")) return uci + "q";
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

/**
 * Race all tasks in parallel. Returns whatever has resolved by the ceiling
 * or once every task settles, whichever is sooner. Tasks still in flight
 * at the ceiling are aborted (frees the upstream fetch) and their results
 * are dropped.
 */
async function raceWithCeiling(
  tasks: Array<{ promise: Promise<EngineTaskResult>; abort: () => void }>,
  ceilingMs: number,
): Promise<EngineTaskResult[]> {
  const completed: EngineTaskResult[] = [];
  const allDone = Promise.all(
    tasks.map(async (t) => {
      const r = await t.promise;
      completed.push(r);
    }),
  );
  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => { timedOut = true; resolve(); }, ceilingMs);
  });
  await Promise.race([allDone, timeout]);
  if (timedOut) {
    for (const t of tasks) t.abort();
  }
  return completed.slice();
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

    // Build the parallel race. Each engine returns an EngineTaskResult;
    // the race resolves at min(ceiling, all-settled).
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

    if (!req.remoteOnly) {
      tasks.push(makeTask("js-chess-engine (local DO)", start, async () => {
        const uci = localBestMove(req.fen, 3);
        return { move: uci };
      }));
    }

    const results = await raceWithCeiling(tasks, RACE_CEILING_MS);

    // Successful engines, by completion order.
    const successful = results.filter((r) => r.ok && r.move);

    // Pick winner by precedence: chess-api > wasm > container > local.
    let chosen: EngineTaskResult | null = null;
    for (const name of ENGINE_PRECEDENCE) {
      const m = successful.find((s) => s.engine === name);
      if (m) { chosen = m; break; }
    }
    if (!chosen && successful.length > 0) chosen = successful[0];

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
