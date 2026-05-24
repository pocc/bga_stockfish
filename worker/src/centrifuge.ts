/**
 * Minimal client for BGA's realtime transport (Centrifugo over websocket).
 *
 * BGA pushes game/table events (moves, your-turn, draw offers, chat) over a
 * Centrifugo connection and uses that same connection for presence — which
 * is why a poll-only bot gets neutralized in realtime games. This module
 * holds the connection so the bot is "present" and reacts to pushes.
 *
 * Protocol (JSON, newline-delimited commands), captured from a live game:
 *   send: {"connect":{"data":{user_id,username,credentials},"name":"js"},"id":1}
 *         \n {"subscribe":{"channel":"bgamsg"},"id":2} \n …
 *   recv: command replies keyed by id; async pushes as {"push":{channel,pub}};
 *         a bare {} is a server ping that must be answered with {}.
 *
 * The connection token + our user id are inlined in the game-page HTML in a
 * completesetup(...) call — see extractCentrifugeAuth.
 */

/** Primary Centrifugo websocket endpoint (x2 is the documented failover). */
export const CENTRIFUGE_WS_URL = "wss://ws-x1.boardgamearena.com/connection/websocket";

export interface CentrifugeAuth {
  userId: string;
  token: string;
}

/**
 * Pull the connection token + our user id out of a game-page HTML. BGA emits
 *   completesetup("chess","Chess", <tableId>, <userId>,
 *      /*archivemask_begin* /"<token>"/* archivemask_end* /, …)
 * The token is a hex string fenced by archivemask markers; the user id is the
 * integer argument immediately before it. Returns null if not present (e.g.
 * the page wasn't a logged-in game page).
 */
export function extractCentrifugeAuth(html: string): CentrifugeAuth | null {
  const m = /,\s*(-?\d+)\s*,\s*\/\*archivemask_begin\*\/"([0-9a-f]{16,})"\/\*archivemask_end\*\//.exec(html);
  if (!m) return null;
  return { userId: m[1], token: m[2] };
}

/** True for BGA's anonymous/visitor identities (negative user ids). A real
 *  authed fetch yields a positive bot uid; a visitor means stale cookies. */
export function isVisitorId(userId: string): boolean {
  return userId.startsWith("-");
}

/** The channels a player subscribes to on connect, mirroring the browser:
 *  global bus, emergency, the player's own channel, and each open table. */
export function channelsFor(userId: string, tableIds: string[]): string[] {
  return [
    "bgamsg",
    "/general/emergency",
    `/player/p${userId}`,
    ...tableIds.map((t) => `/table/t${t}`),
  ];
}

/**
 * Build the initial handshake frame: a connect command followed by one
 * subscribe per channel, newline-delimited (Centrifugo's JSON framing).
 */
export function buildHandshake(opts: {
  userId: string;
  username: string;
  token: string;
  channels: string[];
}): string {
  const cmds: string[] = [
    JSON.stringify({
      connect: {
        data: { user_id: opts.userId, username: opts.username, credentials: opts.token },
        name: "js",
      },
      id: 1,
    }),
  ];
  opts.channels.forEach((channel, i) => {
    cmds.push(JSON.stringify({ subscribe: { channel }, id: i + 2 }));
  });
  return cmds.join("\n");
}

export interface CentrifugeFrame {
  /** Parsed JSON of a single command/reply/push, or null if unparseable. */
  obj: Record<string, unknown> | null;
  /** True for the bare {} server ping. */
  isPing: boolean;
  /** Present when this frame is an async push. */
  push?: { channel?: string; pub?: unknown };
  raw: string;
}

/**
 * Split a websocket message (one or more newline-delimited JSON commands)
 * into individual parsed frames, classifying pings and pushes.
 */
export function parseFrames(message: string): CentrifugeFrame[] {
  const out: CentrifugeFrame[] = [];
  for (const line of message.split("\n")) {
    const raw = line.trim();
    if (!raw) continue;
    let obj: Record<string, unknown> | null = null;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      out.push({ obj: null, isPing: false, raw });
      continue;
    }
    const isPing = obj != null && Object.keys(obj).length === 0;
    let push: { channel?: string; pub?: unknown } | undefined;
    if (obj && typeof obj.push === "object" && obj.push != null) {
      const p = obj.push as { channel?: string; pub?: unknown };
      push = { channel: p.channel, pub: p.pub };
    }
    out.push({ obj, isPing, push, raw });
  }
  return out;
}

/**
 * Open an outbound websocket from a Worker/Durable Object. Cloudflare exposes
 * the socket on the fetch Response when you request an Upgrade.
 */
export async function openCentrifugeSocket(url: string = CENTRIFUGE_WS_URL): Promise<WebSocket> {
  // Cloudflare's fetch-based websocket upgrade requires an http(s):// URL, not
  // ws(s)://. Rewrite the scheme; the Upgrade header is what makes it a socket.
  const fetchUrl = url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  const resp = await fetch(fetchUrl, { headers: { Upgrade: "websocket" } });
  const ws = resp.webSocket;
  if (!ws) {
    throw new Error(`centrifuge upgrade failed: http=${resp.status}`);
  }
  ws.accept();
  return ws;
}

/**
 * One-shot connectivity probe: connect, send the handshake, answer pings, and
 * collect raw frames for `collectMs`. Used by the admin /bot/ws-probe endpoint
 * to verify the bot's authed token actually connects and receives pushes,
 * before we wire the persistent connection into the tick loop.
 */
export async function probeCentrifuge(opts: {
  userId: string;
  username: string;
  token: string;
  channels: string[];
  collectMs?: number;
}): Promise<{ frames: string[]; pings: number; error?: string }> {
  const frames: string[] = [];
  let pings = 0;
  let ws: WebSocket;
  try {
    ws = await openCentrifugeSocket();
  } catch (e) {
    return { frames, pings, error: String(e).slice(0, 200) };
  }
  ws.addEventListener("message", (ev: MessageEvent) => {
    const text = typeof ev.data === "string" ? ev.data : "";
    frames.push(text.slice(0, 2000));
    for (const f of parseFrames(text)) {
      if (f.isPing) { pings++; try { ws.send("{}"); } catch { /* closed */ } }
    }
  });
  try {
    ws.send(buildHandshake(opts));
  } catch (e) {
    return { frames, pings, error: `send failed: ${String(e).slice(0, 160)}` };
  }
  await new Promise((r) => setTimeout(r, opts.collectMs ?? 8000));
  try { ws.close(); } catch { /* already closed */ }
  return { frames, pings };
}
