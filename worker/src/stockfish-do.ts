import { DurableObject } from "cloudflare:workers";
import { Chess } from "chess.js";
import type { Env } from "./index";
import { Engine } from "./engine";

interface BestMoveRequest {
  fen: string;
  movetime?: number;
  depth?: number;
  /** if true, skip chess-api.com and go straight to local engine */
  localOnly?: boolean;
  /** if true, skip local engine and use only chess-api.com */
  remoteOnly?: boolean;
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
  fallbackReason?: string;
}

const CHESS_API_URL = "https://chess-api.com/v1";

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

export class StockfishEngine extends DurableObject<Env> {
  private engine: Engine | null = null;
  private engineLoadError: string | null = null;

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
      return Response.json({
        localEngineLoaded: !!this.engine,
        localEngineError: this.engineLoadError,
      });
    }
    return new Response("not found", { status: 404 });
  }

  private async getEngine(): Promise<Engine | null> {
    if (this.engine) return this.engine;
    if (this.engineLoadError) return null;
    try {
      const e = new Engine();
      await e.init();
      this.engine = e;
      return e;
    } catch (err) {
      this.engineLoadError = err instanceof Error ? (err.stack || err.message) : String(err);
      console.error("local engine init failed:", this.engineLoadError);
      return null;
    }
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
    const movetime = req.movetime ?? 1000;
    const reasons: string[] = [];

    // 1) Try chess-api.com (primary) unless localOnly
    if (!req.localOnly) {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 12_000);
        const apiRes = await callChessApi(req.fen, depth, ac.signal);
        clearTimeout(timer);
        if (apiRes.move) {
          const san = this.uciToSan(chess, apiRes.move);
          const resp: BestMoveResponse = {
            move: apiRes.move,
            san,
            engine: "chess-api.com",
            ms: Date.now() - start,
            eval: apiRes.eval,
            mate: apiRes.mate ?? null,
            depth: apiRes.depth,
            continuation: apiRes.continuationArr,
          };
          return Response.json(resp);
        }
        reasons.push("chess-api returned no move");
      } catch (e) {
        reasons.push(`chess-api failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2) Local WASM engine fallback (unless remoteOnly)
    if (!req.remoteOnly) {
      const engine = await this.getEngine();
      if (engine) {
        try {
          const clamped = Math.min(Math.max(movetime, 50), 10_000);
          const result = await engine.bestMove(req.fen, clamped);
          const san = this.uciToSan(chess, result.bestmove);
          const resp: BestMoveResponse = {
            move: result.bestmove,
            san,
            ponder: result.ponder,
            engine: "stockfish-18-lite-single (local DO)",
            ms: Date.now() - start,
            info: result.info.slice(-3),
            fallbackReason: reasons.join(" | ") || undefined,
          };
          return Response.json(resp);
        } catch (err) {
          reasons.push(`local engine failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        reasons.push(`local engine unavailable: ${this.engineLoadError ?? "not loaded"}`);
      }
    }

    // 3) Random legal move (last resort)
    const pick = legal[Math.floor(Math.random() * legal.length)];
    const uci = pick.from + pick.to + (pick.promotion ?? "");
    return Response.json({
      move: uci,
      san: pick.san,
      engine: "fallback-random",
      ms: Date.now() - start,
      fallbackReason: reasons.join(" | "),
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
