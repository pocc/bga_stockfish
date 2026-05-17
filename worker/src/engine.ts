// @ts-ignore — generated, no .d.ts
import { loadGlueFactory } from "./stockfish-glue-wrapped.js";
// @ts-ignore — wrangler CompiledWasm rule yields WebAssembly.Module at runtime
import stockfishWasmModule from "../wasm/stockfish.wasm";

interface EmscriptenModule {
  ccall: (name: string, returnType: string | null, argTypes: string[], args: unknown[], opts?: { async?: boolean }) => unknown;
  ready?: Promise<unknown>;
  postMessage?: (cmd: string) => void;
  print?: (line: string) => void;
  listener?: (line: string) => void;
}

export interface SearchResult {
  bestmove: string;
  ponder?: string;
  info: string[];
  rawOutput: string[];
}

export class Engine {
  private mod: EmscriptenModule | null = null;
  private outputListener: ((line: string) => void) | null = null;
  private allOutput: string[] = [];
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      // loadGlueFactory() returns the outer function `t` from the IIFE.
      // Calling t() runs its body which reassigns module.exports to the
      // inner factory `e` and returns it. Then e(moduleConfig) returns a
      // promise that resolves to the initialized Module.
      const t = loadGlueFactory() as unknown as () => (cfg: object) => Promise<EmscriptenModule> | EmscriptenModule;
      const innerFactory = t();

      const precompiled = stockfishWasmModule as unknown as WebAssembly.Module;
      const moduleConfig = {
        // CF Workers disallow WebAssembly.instantiate(bytes). Instead we
        // hand emscripten our pre-compiled WebAssembly.Module via the
        // instantiateWasm callback; CF allows instantiating an existing
        // Module with imports.
        instantiateWasm: (
          imports: WebAssembly.Imports,
          receiveInstance: (i: WebAssembly.Instance) => void,
        ) => {
          // Emscripten supports either a sync return of exports OR an
          // async callback. Workers' WebAssembly.instantiate is sync
          // for Module + imports, so do it inline.
          const instance = new WebAssembly.Instance(precompiled, imports);
          receiveInstance(instance);
          return instance.exports;
        },
        noInitialRun: false,
        noExitRuntime: true,
        print: (line: string) => this.onLine(line),
        printErr: (line: string) => this.onLine(line),
        listener: (line: string) => this.onLine(line),
        locateFile: (p: string) => p,
        onAbort: (reason: unknown) => {
          console.error("stockfish abort:", reason);
        },
      };

      const maybe = innerFactory(moduleConfig);
      const mod = (maybe && typeof (maybe as { then?: unknown }).then === "function")
        ? await (maybe as Promise<EmscriptenModule>)
        : (maybe as EmscriptenModule);

      if (!mod || typeof mod.ccall !== "function") {
        throw new Error(`stockfish module missing ccall. keys=${mod ? Object.keys(mod).slice(0, 30).join(",") : "null"}`);
      }
      this.mod = mod;

      // Wait for engine to acknowledge UCI handshake
      const uciOut = this.sendSync("uci");
      if (!uciOut.some((l) => l.includes("uciok"))) {
        throw new Error("no uciok after uci command. got: " + uciOut.slice(-5).join(" | "));
      }
      const readyOut = this.sendSync("isready");
      if (!readyOut.some((l) => l.includes("readyok"))) {
        throw new Error("no readyok after isready. got: " + readyOut.slice(-5).join(" | "));
      }
    })();
    return this.initPromise;
  }

  private onLine(line: string): void {
    if (line == null) return;
    const str = String(line);
    this.allOutput.push(str);
    if (this.outputListener) this.outputListener(str);
  }

  /** Send a UCI command synchronously and return all lines printed during the call. */
  private sendSync(cmd: string): string[] {
    if (!this.mod) throw new Error("engine not initialized");
    const lines: string[] = [];
    const prev = this.outputListener;
    this.outputListener = (line) => lines.push(line);
    try {
      const ret = this.mod.ccall("command", null, ["string"], [cmd]);
      // If asyncify is enabled, ret may be a Promise — we won't await here;
      // caller will use sendAsync instead. For non-asyncify builds it's
      // synchronous and we'll have all lines by now.
      if (ret && typeof (ret as { then?: unknown }).then === "function") {
        // Promise returned: convert via blocking-ish wait isn't possible.
        // Caller should use sendAsync. Throw to surface the mismatch.
        throw new Error(`ccall("${cmd}") returned a Promise — engine is asyncify; use sendAsync`);
      }
    } finally {
      this.outputListener = prev;
    }
    return lines;
  }

  private async sendAsync(cmd: string, until: string, timeoutMs: number): Promise<string[]> {
    if (!this.mod) throw new Error("engine not initialized");
    return new Promise<string[]>((resolve, reject) => {
      const lines: string[] = [];
      const prev = this.outputListener;
      const timer = setTimeout(() => {
        this.outputListener = prev;
        reject(new Error(`timeout waiting for "${until}" after "${cmd}". got: ${lines.slice(-5).join(" | ")}`));
      }, timeoutMs);
      this.outputListener = (line) => {
        lines.push(line);
        if (line.includes(until)) {
          clearTimeout(timer);
          this.outputListener = prev;
          resolve(lines);
        }
      };
      try {
        const ret = this.mod!.ccall("command", null, ["string"], [cmd], { async: true });
        if (ret && typeof (ret as { then?: unknown }).then === "function") {
          (ret as Promise<unknown>).catch((err) => {
            clearTimeout(timer);
            this.outputListener = prev;
            reject(err);
          });
        }
      } catch (err) {
        clearTimeout(timer);
        this.outputListener = prev;
        reject(err);
      }
    });
  }

  async bestMove(fen: string, movetimeMs = 1000): Promise<SearchResult> {
    await this.init();
    // Reset for new search
    this.sendSync("ucinewgame");
    this.sendSync("isready");
    this.sendSync(`position fen ${fen}`);
    // For "go" commands the engine runs for `movetime` ms and then prints
    // bestmove. With synchronous ccall this blocks until done.
    const lines = this.sendSync(`go movetime ${movetimeMs}`);
    const bestmoveLine = lines.find((l) => l.startsWith("bestmove"));
    if (!bestmoveLine) {
      throw new Error("no bestmove line in output: " + lines.slice(-5).join(" | "));
    }
    const parts = bestmoveLine.split(/\s+/);
    const bestmove = parts[1];
    const ponderIdx = parts.indexOf("ponder");
    const ponder = ponderIdx > -1 ? parts[ponderIdx + 1] : undefined;
    return {
      bestmove,
      ponder,
      info: lines.filter((l) => l.startsWith("info")),
      rawOutput: lines,
    };
  }
}
