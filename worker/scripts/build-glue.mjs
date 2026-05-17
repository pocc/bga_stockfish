/**
 * Build step: wrap the upstream stockfish-18-lite-single.js emscripten IIFE
 * so it can be evaluated inside a Cloudflare Worker.
 *
 * Strategy: strip the leading banner, take the `!function(){ ... }()` body,
 * and place it inside a function whose lexical scope provides node-like
 * globals (`module`, `process`, `require`, etc). The IIFE's env detection
 * then picks the node branch and assigns the factory to `module.exports`,
 * which we return.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const srcPath = path.join(root, "wasm/stockfish-glue.js");
const outPath = path.join(root, "src/stockfish-glue-wrapped.js");

const raw = fs.readFileSync(srcPath, "utf8");

const iifeStart = "!function(){";
const startIdx = raw.indexOf(iifeStart);
if (startIdx === -1) throw new Error("Could not find IIFE start in glue source");

let body = raw.slice(startIdx + iifeStart.length);
// Strip the trailing `}();` (with optional whitespace/semis)
body = body.replace(/}\(\);?\s*$/, "");

const out = `// AUTO-GENERATED from wasm/stockfish-glue.js by scripts/build-glue.mjs.
// Do not edit by hand. Re-run \`npm run build:glue\` to regenerate.
/* eslint-disable */
// @ts-nocheck

/**
 * Returns the Stockfish factory. Call factory(moduleConfig) where moduleConfig
 * is an Emscripten Module config object including \`wasmBinary\` (Uint8Array),
 * a \`listener\` callback for stdout lines, and any other emscripten options.
 */
export function loadGlueFactory() {
  // CommonJS-shaped module shim — initialised as truthy {} so the IIFE's
  // env-detection picks the "module.exports" branch.
  const module = { exports: {} };
  const exports = module.exports;

  // Node-like environment so the IIFE's env detection takes the node path.
  // The crucial bit is that Object.prototype.toString.call(process) must
  // return "[object process]" — emscripten uses that to detect node.
  const _processStub = {
    get [Symbol.toStringTag]() { return "process"; },
    versions: { node: "20.0.0", v8: "12.0.0" },
    argv: ["node", "stockfish.js"],
    env: {},
    on: () => {},
    exit: () => {},
    binding: () => ({}),
    cwd: () => "/",
    nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    version: "v20.0.0",
    platform: "linux",
  };
  // Use the real polyfilled process if nodejs_compat made it look correct;
  // otherwise fall back to our stub. We force the toStringTag either way.
  let process;
  if (typeof globalThis.process === "object" && globalThis.process &&
      Object.prototype.toString.call(globalThis.process) === "[object process]") {
    process = globalThis.process;
  } else {
    process = _processStub;
  }

  // require() stub: returns safe defaults for modules the IIFE / factory
  // reach for during env detection. Actual file I/O never fires because we
  // pass wasmBinary directly into Module config.
  const require = Object.assign(
    (name) => {
      if (name === "worker_threads") return { isMainThread: true, parentPort: null };
      if (name === "path") return {
        join: (...parts) => parts.join("/"),
        dirname: (p) => p.split("/").slice(0, -1).join("/") || "/",
        basename: (p, ext) => {
          let b = p.split("/").pop() || "";
          if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length);
          return b;
        },
        extname: (p) => {
          const b = p.split("/").pop() || "";
          const i = b.lastIndexOf(".");
          return i > 0 ? b.slice(i) : "";
        },
        normalize: (p) => p,
        resolve: (...parts) => parts.join("/"),
      };
      if (name === "fs") return {
        readFile: (_p, _opts, cb) => {
          const fn = typeof _opts === "function" ? _opts : cb;
          fn?.(new Error("fs.readFile not supported"));
        },
        readFileSync: () => { throw new Error("fs.readFileSync not supported"); },
      };
      if (name === "url") return { fileURLToPath: (u) => String(u) };
      if (name === "crypto") return { randomFillSync: (buf) => { for (let i=0;i<buf.length;i++) buf[i]=Math.floor(Math.random()*256); return buf; } };
      if (name === "readline") return { createInterface: () => ({ on: () => ({ on: () => ({ setPrompt: () => {} }), setPrompt: () => {} }), setPrompt: () => {} }) };
      if (name === "child_process") return { spawn: () => { throw new Error("child_process not supported"); } };
      throw new Error("stockfish glue tried to require(" + JSON.stringify(name) + ") — not supported in Workers");
    },
    { main: { exports: null } }  // require.main !== our module → skip CLI branch
  );

  // Emscripten reads these in node mode for path resolution / file reading.
  const __dirname = "/";
  const __filename = "/stockfish.js";

  // Ensure \`global\` is the global object inside this closure (the IIFE
  // checks \`typeof global !== "undefined"\`).
  const global = globalThis;

  // Shadow web/worker-only globals so the IIFE's webworker detection misses.
  // Use 'let' (not const) because the dead webworker branch inside the IIFE
  // contains assignments like onmessage = onmessage || function() {...} —
  // esbuild rejects those if the outer binding is const, even when the
  // branch is never executed at runtime.
  let self = undefined;
  let onmessage = undefined;
  let importScripts = undefined;
  let document = undefined;
  let window = undefined;
  let postMessage = undefined;
  let location = undefined;

  // The emscripten glue does \`fetch = null\` and similar bare-name
  // assignments. In ES-module strict mode bare assignments fail with
  // ReferenceError unless the name is a declared binding in scope. Make
  // them locals so the assignments succeed; we still seed them from
  // globalThis so any callsites that DO read them get the real impl.
  let fetch = globalThis.fetch;
  let XMLHttpRequest = undefined;
  let crypto = globalThis.crypto;
  let setTimeout = globalThis.setTimeout;
  let clearTimeout = globalThis.clearTimeout;

  (function () {
${body}
  })();

  if (typeof module.exports !== "function") {
    throw new Error(
      "stockfish glue did not export a factory (typeof module.exports=" +
        typeof module.exports + ")"
    );
  }
  return module.exports;
}
`;

fs.writeFileSync(outPath, out);
console.log("Wrote", path.relative(root, outPath), `(${out.length} bytes)`);
