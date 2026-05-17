/**
 * BGA HTTP client.
 *
 * Currently covers:
 *   - login (two-step: fetch /account to pick up request_token + PHPSESSID,
 *     then POST credentials to loginUserWithPassword.html)
 *   - cookie jar persisted to disk between runs (so we don't burn a fresh
 *     PHPSESSID on every invocation)
 *   - the read-only lobby endpoints we've reverse-engineered so far
 *
 * Move submission and table creation live in separate modules once
 * captured via Playwright recon.
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
}

interface LoginResponse {
  status: 0 | 1;
  data?: {
    success: boolean;
    username: string;
    user_id: string;
    avatar: string;
    is_premium: string;
  };
  error?: string;
}

interface BGAEnvelope<T> {
  status: 0 | 1;
  data?: T;
  results?: T;
  error?: string;
}

export interface BGAClientOpts {
  /** Where to persist cookies between runs (JSON). */
  cookieJarPath?: string;
  /** Bot username (used by login). */
  username: string;
  /** Bot password (used by login). */
  password: string;
  /** Override user-agent (some BGA endpoints sniff for bots). */
  userAgent?: string;
}

export class BGAClient {
  private cookies = new Map<string, Cookie>();
  private opts: BGAClientOpts;
  private userId: string | null = null;

  constructor(opts: BGAClientOpts) {
    this.opts = opts;
    if (opts.cookieJarPath && fs.existsSync(opts.cookieJarPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(opts.cookieJarPath, "utf8")) as Cookie[];
        for (const c of raw) this.cookies.set(this.cookieKey(c), c);
      } catch (err) {
        console.warn("failed to read cookie jar; starting fresh:", err);
      }
    }
  }

  private cookieKey(c: Cookie): string {
    return `${c.domain}|${c.path}|${c.name}`;
  }

  private cookieHeader(url: string): string {
    const u = new URL(url);
    const out: string[] = [];
    for (const c of this.cookies.values()) {
      if (!this.domainMatches(u.hostname, c.domain)) continue;
      if (!u.pathname.startsWith(c.path)) continue;
      if (c.secure && u.protocol !== "https:") continue;
      out.push(`${c.name}=${c.value}`);
    }
    return out.join("; ");
  }

  private domainMatches(host: string, cookieDomain: string): boolean {
    if (!cookieDomain) return false;
    const cd = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
    return host === cd || host.endsWith("." + cd);
  }

  private absorbSetCookie(setCookieHeaders: string[], requestUrl: string): void {
    const reqHost = new URL(requestUrl).hostname;
    for (const raw of setCookieHeaders) {
      const parts = raw.split(/;\s*/);
      const [nameValue, ...attrs] = parts;
      const eq = nameValue.indexOf("=");
      if (eq < 0) continue;
      const name = nameValue.slice(0, eq).trim();
      const value = nameValue.slice(eq + 1).trim();
      const cookie: Cookie = { name, value, domain: reqHost, path: "/" };
      for (const attr of attrs) {
        const [k, v] = attr.split("=").map((s) => s?.trim() ?? "");
        const key = k.toLowerCase();
        if (key === "domain" && v) cookie.domain = v.toLowerCase();
        else if (key === "path" && v) cookie.path = v;
        else if (key === "secure") cookie.secure = true;
        else if (key === "httponly") cookie.httpOnly = true;
        else if (key === "expires" && v) {
          const t = Date.parse(v);
          if (!Number.isNaN(t)) cookie.expires = Math.floor(t / 1000);
        } else if (key === "max-age" && v) {
          cookie.expires = Math.floor(Date.now() / 1000) + Number(v);
        }
      }
      this.cookies.set(this.cookieKey(cookie), cookie);
    }
    this.persist();
  }

  private persist(): void {
    if (!this.opts.cookieJarPath) return;
    fs.mkdirSync(path.dirname(this.opts.cookieJarPath), { recursive: true });
    fs.writeFileSync(
      this.opts.cookieJarPath,
      JSON.stringify(Array.from(this.cookies.values()), null, 2),
    );
  }

  private async request(
    method: "GET" | "POST",
    url: string,
    body?: string | URLSearchParams,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "user-agent": this.opts.userAgent ?? DEFAULT_UA,
      accept: "application/json, text/javascript, */*; q=0.01",
      "accept-language": "en-US,en;q=0.9",
      "x-requested-with": "XMLHttpRequest",
      ...extraHeaders,
    };
    const cookie = this.cookieHeader(url);
    if (cookie) headers.cookie = cookie;
    if (body && !headers["content-type"]) {
      headers["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    }
    // BGA CSRF: every authed call mirrors the TournoiEnLigneidt cookie
    // in an x-request-token header. Cookies the attacker can plant won't
    // produce the header value (browsers block cross-origin custom hdrs).
    if (!headers["x-request-token"]) {
      const idt = Array.from(this.cookies.values()).find(
        (c) => c.name === "TournoiEnLigneidt" && c.value && c.value !== "deleted",
      );
      if (idt) headers["x-request-token"] = idt.value;
    }
    const resp = await fetch(url, {
      method,
      headers,
      body: typeof body === "string" ? body : body?.toString(),
      redirect: "manual",
    });
    const setCookie = resp.headers.getSetCookie?.() ?? [];
    if (setCookie.length) this.absorbSetCookie(setCookie, url);
    return resp;
  }

  /**
   * Programmatic login: GET /account to pick up PHPSESSID + request_token,
   * then POST credentials. If the SSO ticket cookie is still present and
   * valid, skip the password round-trip.
   */
  async login(): Promise<{ userId: string; username: string }> {
    if (this.userId) return { userId: this.userId, username: this.opts.username };

    // Fast path: if we already have an SSO ticket, derive user from cookie and skip.
    const ssoUser = Array.from(this.cookies.values()).find(
      (c) => c.name === "TournoiEnLigne_sso_user" && c.value && c.value !== "deleted",
    );
    const tkt = Array.from(this.cookies.values()).find(
      (c) => c.name === "TournoiEnLignetkt" && c.value && c.value !== "deleted",
    );
    if (ssoUser && tkt) {
      // value is `username%24<n>%24email` (URL-encoded `$`)
      const decoded = decodeURIComponent(ssoUser.value);
      const [name] = decoded.split("$");
      if (name === this.opts.username) {
        // Probe one cheap authed call; if it works, we're done.
        const probe = await this.request(
          "POST",
          "https://en.boardgamearena.com/tablemanager/tablemanager/getTableCounterStatus.html",
        );
        if (probe.ok) {
          const body = await probe.json().catch(() => null) as { status?: string | number } | null;
          if (body && (body.status === 1 || body.status === "1")) {
            this.userId = "cached"; // we don't know it yet — endpoints that need it should re-resolve
            return { userId: this.userId, username: this.opts.username };
          }
        }
      }
    }

    const accountUrl = "https://en.boardgamearena.com/account?redirect=welcome";
    const accountResp = await this.request("GET", accountUrl, undefined, {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    });
    // 302 typically means we're already logged in — but our fast path above
    // should have caught that. If we get here with 302, the cookies are
    // stale; clear them and retry once.
    if (accountResp.status === 302 || accountResp.status === 301) {
      this.cookies.clear();
      this.persist();
      const retry = await this.request("GET", accountUrl, undefined, {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      });
      if (!retry.ok) throw new Error(`/account retry returned ${retry.status}`);
      const html = await retry.text();
      return this.completeLogin(html, accountUrl);
    }
    if (!accountResp.ok) {
      throw new Error(`/account returned ${accountResp.status}`);
    }
    const html = await accountResp.text();
    return this.completeLogin(html, accountUrl);
  }

  private async completeLogin(
    html: string,
    accountUrl: string,
  ): Promise<{ userId: string; username: string }> {
    // BGA inlines the CSRF token as a JS variable `requestToken: 'hex'`
    // in the /account page. Older pages used `request_token` as a form
    // attribute; we try both.
    const tokenMatch =
      /requestToken\s*:\s*['"]([a-f0-9]{32,128})['"]/i.exec(html) ??
      /name=["']request_token["']\s+value=["']([a-f0-9]{32,128})["']/i.exec(html) ??
      /["']request_token["']\s*[:=]\s*["']([a-f0-9]{32,128})["']/i.exec(html);
    const requestToken = tokenMatch?.[1];
    if (!requestToken) {
      throw new Error(
        "could not find requestToken in /account HTML — login form may have changed; fall back to Playwright recon-login.ts",
      );
    }

    const body = new URLSearchParams({
      username: this.opts.username,
      password: this.opts.password,
      remember_me: "false",
      request_token: requestToken,
    });
    const loginResp = await this.request(
      "POST",
      "https://en.boardgamearena.com/account/auth/loginUserWithPassword.html",
      body,
      { referer: accountUrl, origin: "https://en.boardgamearena.com" },
    );
    if (!loginResp.ok) {
      throw new Error(`loginUserWithPassword returned ${loginResp.status}`);
    }
    const payload = (await loginResp.json()) as LoginResponse;
    if (payload.status !== 1 || !payload.data?.success) {
      throw new Error(`login failed: ${JSON.stringify(payload)}`);
    }
    this.userId = payload.data.user_id;
    return { userId: this.userId, username: payload.data.username };
  }

  /** Convenience: load the user id from cookies + bg session check, no login. */
  async whoAmI(): Promise<{ userId: string | null }> {
    return { userId: this.userId };
  }

  /** GET /message/board?type=player&... */
  async playerFeed(): Promise<unknown> {
    await this.login();
    const url = `https://en.boardgamearena.com/message/board?type=player&id=${this.userId}&social=true&per_page=14&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
    const text = await resp.text();
    return text ? JSON.parse(text) : { status: 1 };
  }

  /** POST /gamepanel/gamepanel/getData.html */
  async gamePanel(gameId = 81): Promise<BGAEnvelope<unknown>> {
    await this.login();
    const body = new URLSearchParams({
      game_id: String(gameId),
      with_ranking_info: "false",
    });
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/gamepanel/gamepanel/getData.html",
      body,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /** POST /tablemanager/tablemanager/getTableCounterStatus.html */
  async tableCounters(): Promise<BGAEnvelope<unknown>> {
    await this.login();
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/tablemanager/tablemanager/getTableCounterStatus.html",
    );
    const text = await resp.text();
    if (!text) return { status: 1 };
    return JSON.parse(text) as BGAEnvelope<unknown>;
  }

  /**
   * POST /table/table/createnew.html — returns { table: <id> }.
   * Newly-created table is in "init" (setup) state, creator already seated.
   */
  async createTable(gameId = 81): Promise<number> {
    await this.login();
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/createnew.html",
      `game=${gameId}`,
    );
    const json = (await resp.json()) as BGAEnvelope<{ table: number }>;
    if (json.status !== 1 || !json.data?.table) {
      throw new Error(`createTable failed: ${JSON.stringify(json)}`);
    }
    return json.data.table;
  }

  /**
   * POST /tablemanager/tablemanager/tableinfos.html — list tables matching
   * a filter. Empirically the page sends:
   *     status=open&games=81&turninfo=true&matchmakingtables=true
   * Returns { tables: { "<id>": { id, game_id, status, table_creator,
   *   players: { "<uid>": { table_status, myturn, score, ... } }, ... } } }
   *
   * Filter shape mirrors what the gamepanel page sends. Use `status=play`
   * for in-progress tables, `status=open` for setup/init lobby tables.
   */
  async listTables(opts: {
    status?: "open" | "play" | "async" | "realtime_open";
    games?: number | string;
    turninfo?: boolean;
    matchmakingtables?: boolean;
  } = {}): Promise<Record<string, RawTableInfo>> {
    await this.login();
    const params = new URLSearchParams();
    params.set("status", opts.status ?? "open");
    if (opts.games !== undefined) params.set("games", String(opts.games));
    if (opts.turninfo !== false) params.set("turninfo", "true");
    if (opts.matchmakingtables !== false) params.set("matchmakingtables", "true");
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/tablemanager/tablemanager/tableinfos.html",
      params,
    );
    const json = (await resp.json()) as BGAEnvelope<{ tables?: Record<string, RawTableInfo> }>;
    if (json.status !== 1) throw new Error(`listTables failed: ${JSON.stringify(json).slice(0, 300)}`);
    return json.data?.tables ?? {};
  }

  /**
   * Tables involving the current bot user. Polls both open (setup) and
   * play (in-progress) lobby slices, then filters by user id appearing in
   * the table's `players` dict.
   */
  async myTables(gameId = 81): Promise<RawTableInfo[]> {
    await this.login();
    const uid = await this.resolveUserId();
    const [open, playing] = await Promise.all([
      this.listTables({ status: "open", games: gameId }).catch(() => ({})),
      this.listTables({ status: "play", games: gameId }).catch(() => ({})),
    ]);
    const merged: Record<string, RawTableInfo> = { ...open, ...playing };
    return Object.values(merged).filter((t) => t.players && uid in t.players);
  }

  /** POST /table/table/joingame.html — sit at a table that's in "init". */
  async joinTable(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    await this.login();
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/joingame.html",
      `table=${tableId}`,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /** POST /table/table/quitgame.html — leave/cancel a table. DESTRUCTIVE in setup phase. */
  async quitTable(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    await this.login();
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/quitgame.html",
      `table=${tableId}`,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /** POST /table/table/startgame.html — only succeeds once min_player seats are filled. */
  async startTable(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    await this.login();
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/startgame.html",
      `table=${tableId}`,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /** POST /table/table/say.html — send a chat line in a table. */
  async chat(tableId: number | string, msg: string): Promise<BGAEnvelope<unknown>> {
    await this.login();
    const body = new URLSearchParams({ table: String(tableId), msg });
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/say.html",
      body,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /**
   * GET /table/table/chatHistory.html — fetch the full table chat scrollback.
   * Returns an array of messages; shape varies a little across endpoints, so
   * we normalize defensively. Each entry typically carries `id`/`msg_id`,
   * `sender` (uid as string), `msg`, and `time` (epoch seconds).
   */
  async chatHistory(tableId: number | string): Promise<ChatMessage[]> {
    await this.login();
    const url =
      `https://boardgamearena.com/table/table/chatHistory.html` +
      `?type=table&id=${tableId}&table=${tableId}` +
      `&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
    const text = await resp.text();
    if (!text) return [];
    let envelope: BGAEnvelope<unknown>;
    try { envelope = JSON.parse(text) as BGAEnvelope<unknown>; }
    catch { return []; }
    // Possible shapes seen on BGA: data is array, data.data is array,
    // data.history is array. Handle each.
    const candidates: unknown[] = [
      envelope.data,
      (envelope.data as { data?: unknown } | undefined)?.data,
      (envelope.data as { history?: unknown } | undefined)?.history,
      envelope.results,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c.map(normalizeChat).filter((m): m is ChatMessage => m !== null);
    }
    return [];
  }

  /**
   * GET /table/table/acceptGameStart.html — confirm "I'm ready to start"
   * once both seats are filled. Without this the table stays at "init".
   */
  async acceptGameStart(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    await this.login();
    // Apex domain (boardgamearena.com), not en. — matches captured browser flow.
    const resp = await this.request(
      "GET",
      `https://boardgamearena.com/table/table/acceptGameStart.html?table=${tableId}&dojo.preventCache=${Date.now()}`,
      undefined,
      { referer: "https://boardgamearena.com/lobby" },
    );
    const text = await resp.text();
    try {
      return JSON.parse(text) as BGAEnvelope<unknown>;
    } catch {
      // Server returns empty body for this endpoint — the side-effect is what matters.
      return { status: 1, data: `http=${resp.status} body=${text.slice(0, 80)}` } as BGAEnvelope<unknown>;
    }
  }

  /**
   * GET /table/table/concede.html — resign / forfeit the active game.
   * `src=menu` is what the UI sends; BGA accepts it.
   */
  async resign(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    await this.login();
    const url = `https://en.boardgamearena.com/table/table/concede.html?src=menu&table=${tableId}&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /**
   * GET /table/table/decide.html — answer a table-level decision proposal
   * (e.g. "Propose to abandon the game collectively"). `decision=1` accepts,
   * `decision=0` refuses. `type` mirrors the UI option name ("abandon", etc.).
   * Captured request format from the browser uses apex domain and the
   * gameserver-prefixed chess URL as referer.
   */
  async decide(
    tableId: number | string,
    type: "abandon" | string,
    decision: 0 | 1,
    gameserverNum?: number | string,
  ): Promise<BGAEnvelope<unknown>> {
    await this.login();
    const url =
      `https://boardgamearena.com/table/table/decide.html` +
      `?src=menu&type=${type}&decision=${decision}&table=${tableId}` +
      `&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const headers: Record<string, string> = {};
    if (gameserverNum != null) {
      headers.referer = `https://boardgamearena.com/${gameserverNum}/chess?table=${tableId}`;
    }
    const resp = await this.request("GET", url, undefined, headers);
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /**
   * GET /<N>/chess/chess/selectCell.html — submit a chess move.
   *
   * `cell_x`/`cell_y` are 0..7 destination coords; `selectedPieceId` is the
   * BGA-internal piece id (NOT a square) — obtain it from the latest
   * `gameStateChange { args: { destinations_by_piece } }` WS push.
   *
   * `gameserverNum` is the `<N>` in the table's URL (e.g. `/5/chess?table=`).
   * Resolve it via `resolveGameserver(tableId)`.
   *
   * Response body is tiny (~43 bytes ack). The real broadcast — including
   * the opponent's reactive state — comes back over WebSocket.
   */
  async selectCell(
    gameserverNum: number | string,
    tableId: number | string,
    cellX: number,
    cellY: number,
    selectedPieceId: number | string,
  ): Promise<BGAEnvelope<unknown>> {
    await this.login();
    const lock = cryptoRandomUuid();
    const url =
      `https://boardgamearena.com/${gameserverNum}/chess/chess/selectCell.html` +
      `?cell_x=${cellX}&cell_y=${cellY}&selected_piece=${selectedPieceId}` +
      `&lock=${lock}&table=${tableId}&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /**
   * GET /<N>/chess/chess/wakeup.html?myturnack=true — courtesy ping the
   * client sends after acting so the server knows we processed the turn.
   * Probably not strictly required for the bot, but it's cheap.
   */
  async wakeup(gameserverNum: number | string, tableId: number | string): Promise<BGAEnvelope<unknown>> {
    await this.login();
    const url = `https://boardgamearena.com/${gameserverNum}/chess/chess/wakeup.html?myturnack=true&table=${tableId}&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /**
   * Follow /table?table=<id> and read the redirect target to recover the
   * gameserver number (the `<N>` in `/<N>/chess?table=`).
   *
   * BGA returns a 302 with `Location: /<N>/chess?table=<id>` once the
   * table is in `play`. While the table is in `init`, the redirect goes
   * to `/gamepanel?game=chess&table=<id>` instead and there's no
   * gameserver yet.
   */
  async resolveGameserver(tableId: number | string): Promise<number | null> {
    await this.login();
    const resp = await this.request(
      "GET",
      `https://boardgamearena.com/table?table=${tableId}`,
      undefined,
      { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    );
    const loc = resp.headers.get("location") ?? "";
    const fromLoc = /\/(\d+)\/chess\?/.exec(loc);
    if (fromLoc) return Number(fromLoc[1]);
    // BGA now returns 200 with the rendered game page; scrape gameserver
    // from the body when there's no redirect.
    const body = await resp.text();
    const fromPath = /\/(\d+)\/chess\?table/.exec(body);
    if (fromPath) return Number(fromPath[1]);
    const fromKey = /gameserver["']?\s*[:=]\s*["']?(\d+)/.exec(body);
    if (fromKey) return Number(fromKey[1]);
    return null;
  }

  /**
   * Cheap call that returns the current user id. Uses cached id from login
   * if available, else asks BGA. Needed by myTables() before we know the id.
   */
  async resolveUserId(): Promise<string> {
    if (this.userId && this.userId !== "cached") return this.userId;
    // The sso_user cookie embeds it as `username$<uid>$email`.
    const sso = Array.from(this.cookies.values()).find(
      (c) => c.name === "TournoiEnLigne_sso_user" && c.value && c.value !== "deleted",
    );
    if (sso) {
      const decoded = decodeURIComponent(sso.value);
      const [, uid] = decoded.split("$");
      if (uid) {
        this.userId = uid;
        return uid;
      }
    }
    // Fallback: hit /community which exposes the user id in its inline JS.
    const resp = await this.request("GET", "https://en.boardgamearena.com/community", undefined, {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    });
    const html = await resp.text();
    const m = /["']?id["']?\s*[:=]\s*["']?(\d{6,12})["']?/.exec(html);
    if (!m) throw new Error("could not resolve user id");
    this.userId = m[1];
    return m[1];
  }
}

/** Cheap UUIDv4 — matches the format the BGA UI sends as `lock`. */
function cryptoRandomUuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback (Node <19): hex random + RFC 4122 v4 layout
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

export interface ChatMessage {
  /** Numeric message id (string in BGA's payloads). May be missing on some shapes. */
  id: string | null;
  /** Sender's BGA user id (string). May be empty for system messages. */
  sender: string;
  /** Display name if BGA included it. */
  sender_name: string | null;
  /** The chat text. */
  msg: string;
  /** Epoch seconds, if BGA provided it. */
  time: number | null;
  /** "tablechat" for normal player chat, "tableinfo" for system, etc. */
  type: string | null;
}

function normalizeChat(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const msg = typeof r.msg === "string" ? r.msg : typeof r.text === "string" ? r.text : null;
  if (msg == null) return null;
  const idRaw = r.id ?? r.msg_id ?? r.message_id ?? null;
  const senderRaw = r.sender ?? r.player_id ?? r.from ?? "";
  const timeRaw = r.time ?? r.timestamp ?? null;
  return {
    id: idRaw == null ? null : String(idRaw),
    sender: senderRaw == null ? "" : String(senderRaw),
    sender_name:
      typeof r.sender_name === "string" ? r.sender_name :
      typeof r.fullname === "string" ? r.fullname :
      typeof r.from_name === "string" ? r.from_name : null,
    msg,
    time: timeRaw == null ? null : Number(timeRaw),
    type: typeof r.type === "string" ? r.type : null,
  };
}

export interface RawPlayerSeat {
  /** "expected" while waiting to be seated, "play" once active. */
  table_status?: string;
  /** 0/1/null — 1 means it's this player's move. */
  myturn?: 0 | 1 | null;
  score?: string;
  fullname?: string;
  /** "play" once they accepted; the seat-level status mirrors table flow. */
  status?: string;
}

export interface RawTableInfo {
  id: string;
  game_id: string;
  /** "init" (setup), "asyncopen" / "open" (waiting), "play", "finished", ... */
  status: string;
  table_creator: string;
  max_player: string;
  min_player: string;
  progression?: string;
  presentation?: string;
  /** Which seat index has the move (1-based), once the game is live. */
  current_player_nbr?: number | string;
  players?: Record<string, RawPlayerSeat>;
}
