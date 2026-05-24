import { createServer } from "node:http";
import { spawn } from "node:child_process";

const sf = spawn("stockfish", [], { stdio: ["pipe", "pipe", "pipe"] });
sf.on("exit", (code) => {
  console.error("stockfish exited with code", code);
  process.exit(1);
});

let buffer = "";
const lineListeners = new Set();
sf.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    for (const fn of [...lineListeners]) fn(line);
  }
});
sf.stderr.on("data", (c) => console.error("stockfish stderr:", c.toString().trim()));

function send(cmd) {
  sf.stdin.write(cmd + "\n");
}

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const onLine = (line) => {
      if (predicate(line)) {
        lineListeners.delete(onLine);
        clearTimeout(t);
        resolve(line);
      }
    };
    lineListeners.add(onLine);
    const t = setTimeout(() => {
      lineListeners.delete(onLine);
      reject(new Error("timeout waiting for stockfish line"));
    }, timeoutMs);
  });
}

// UCI handshake
send("uci");
await waitFor((l) => l === "uciok", 5000);
// 16MB hash and a single thread keep the container CPU/memory predictable
// without nerfing playing strength meaningfully at the movetime we use.
send("setoption name Hash value 16");
send("setoption name Threads value 1");
send("isready");
await waitFor((l) => l === "readyok", 5000);
console.log("stockfish ready");

// Serialize requests; UCI is a single shared engine, so concurrent bestmove
// commands would interleave outputs and confuse the bestmove matcher.
let queue = Promise.resolve();
function withLock(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, engine: "stockfish" }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/bestmove") {
    res.writeHead(404).end("not found");
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  let json;
  try { json = JSON.parse(body); } catch {
    res.writeHead(400).end("bad json"); return;
  }
  const fen = json.fen;
  const movetime = Math.max(50, Math.min(Number(json.movetimeMs) || 300, 2000));
  if (!fen || typeof fen !== "string") {
    res.writeHead(400).end("fen required"); return;
  }
  try {
    const result = await withLock(async () => {
      const start = Date.now();
      send("ucinewgame");
      send("isready");
      await waitFor((l) => l === "readyok", 3000);
      send("position fen " + fen);
      send("go movetime " + movetime);
      const line = await waitFor((l) => l.startsWith("bestmove"), movetime + 3000);
      const parts = line.split(/\s+/);
      return { move: parts[1], ms: Date.now() - start };
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }));
  }
});

server.listen(8080, () => console.log("stockfish container listening on :8080"));
