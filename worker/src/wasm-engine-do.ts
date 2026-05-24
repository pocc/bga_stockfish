import { DurableObject } from "cloudflare:workers";
import { Engine } from "./engine";
import type { Env } from "./index";

interface WasmBestMoveRequest {
  fen: string;
  movetimeMs?: number;
}

/**
 * Dedicated DO for WASM Stockfish. Isolating it in its own DO is what makes
 * adding WASM to the fallback chain safe: if the WASM engine OOMs or hits
 * the 30s CPU cap, only this DO's isolate resets. The caller (StockfishEngine)
 * sees a failed subrequest and continues down the chain to js-chess-engine.
 *
 * Previous attempts to run WASM inside StockfishEngine itself wedged the
 * whole chain because the OOM killed the isolate before js-chess-engine
 * could be tried.
 */
export class StockfishWasmEngine extends DurableObject<Env> {
  private engine: Engine | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/bestmove" && req.method === "POST") {
      const body = (await req.json()) as WasmBestMoveRequest;
      if (!body.fen) {
        return Response.json({ error: "fen required" }, { status: 400 });
      }
      const start = Date.now();
      try {
        if (!this.engine) this.engine = new Engine();
        const movetime = Math.max(50, Math.min(body.movetimeMs ?? 200, 1500));
        const result = await this.engine.bestMove(body.fen, movetime);
        return Response.json({
          move: result.bestmove,
          ponder: result.ponder,
          ms: Date.now() - start,
          info: result.info.slice(-3),
        });
      } catch (e) {
        this.engine = null;
        return Response.json(
          { error: "wasm engine failed", detail: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
    }
    return new Response("not found", { status: 404 });
  }
}
