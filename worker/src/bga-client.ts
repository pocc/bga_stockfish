/**
 * Workers-compatible BGA HTTP client.
 *
 * Mirrors `bga/src/client.ts` but:
 *   - cookie jar is in-memory only (caller persists to DO storage as needed)
 *   - no `fs` / `path`
 *   - all methods are stateless besides cookie mutations
 *
 * Keep behavior identical to the Node client. Any change here should be
 * mirrored in `bga/src/client.ts` and vice versa.
 */

// Pin a current Chrome UA. Cloudflare Workers preserve User-Agent but BGA
// has been observed to vary endpoint behavior by browser fingerprint —
// matching a real Chrome 130 UA is the safest bet.
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
}

export interface BGAEnvelope<T> {
  status: 0 | 1;
  data?: T;
  results?: T;
  error?: string;
}

export interface RawPlayerSeat {
  table_status?: string;
  myturn?: 0 | 1 | null;
  score?: string;
  fullname?: string;
  status?: string;
  table_order?: string;
}

export interface RawTableInfo {
  id: string;
  game_id: string;
  status: string;
  table_creator: string;
  max_player: string;
  min_player: string;
  progression?: string;
  presentation?: string;
  current_player_nbr?: number | string;
  players?: Record<string, RawPlayerSeat>;
}

export interface ChatMessage {
  id: string | null;
  sender: string;
  sender_name: string | null;
  msg: string;
  time: number | null;
  type: string | null;
}

interface LoginResponse {
  status: 0 | 1;
  data?: { success: boolean; username: string; user_id: string };
  error?: string;
}

export interface BGAClientOpts {
  username: string;
  password: string;
  userAgent?: string;
  /** Pre-loaded cookies (e.g. from DO storage). */
  cookies?: Cookie[];
  /** Called whenever the cookie jar changes — caller persists. */
  onCookiesChanged?: (cookies: Cookie[]) => void | Promise<void>;
}

export class BGAClient {
  private cookies = new Map<string, Cookie>();
  private opts: BGAClientOpts;
  private userId: string | null = null;

  constructor(opts: BGAClientOpts) {
    this.opts = opts;
    for (const c of opts.cookies ?? []) this.cookies.set(this.cookieKey(c), c);
  }

  /** Snapshot cookies for persistence. */
  snapshot(): Cookie[] { return Array.from(this.cookies.values()); }

  private cookieKey(c: Cookie): string { return `${c.domain}|${c.path}|${c.name}`; }

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

  private async absorbSetCookie(setCookieHeaders: string[], requestUrl: string): Promise<void> {
    if (!setCookieHeaders.length) return;
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
    await this.opts.onCookiesChanged?.(this.snapshot());
  }

  async request(
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
      // Pin client hints to a stable Chrome desktop fingerprint. Cloudflare
      // Workers will otherwise omit these, which some BGA endpoints use to
      // distinguish browser vs bot traffic.
      "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      ...extraHeaders,
    };
    const cookie = this.cookieHeader(url);
    if (cookie) headers.cookie = cookie;
    if (body && !headers["content-type"]) {
      headers["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    }
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
    const setCookie = (resp.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    await this.absorbSetCookie(setCookie, url);
    return resp;
  }

  async login(): Promise<{ userId: string; username: string }> {
    if (this.userId && this.userId !== "cached") {
      return { userId: this.userId, username: this.opts.username };
    }

    const ssoUser = Array.from(this.cookies.values()).find(
      (c) => c.name === "TournoiEnLigne_sso_user" && c.value && c.value !== "deleted",
    );
    const tkt = Array.from(this.cookies.values()).find(
      (c) => c.name === "TournoiEnLignetkt" && c.value && c.value !== "deleted",
    );
    if (ssoUser && tkt) {
      const decoded = decodeURIComponent(ssoUser.value);
      const [name, uid] = decoded.split("$");
      if (name === this.opts.username) {
        const probe = await this.request(
          "POST",
          "https://en.boardgamearena.com/tablemanager/tablemanager/getTableCounterStatus.html",
        );
        if (probe.ok) {
          const json = await probe.json().catch(() => null) as { status?: string | number } | null;
          if (json && (json.status === 1 || json.status === "1")) {
            this.userId = uid || "cached";
            return { userId: this.userId, username: this.opts.username };
          }
        }
      }
    }

    // We fall through here when the cached-cookie probe failed, which means
    // any cookies we have are stale. BGA ties the request_token in /account
    // HTML to the requesting session, so scraping a token while sending
    // stale cookies yields a token that BGA later rejects on the login POST
    // (InvalidTokenException). Wipe before the fresh GET.
    this.cookies.clear();
    await this.opts.onCookiesChanged?.([]);
    const accountUrl = "https://en.boardgamearena.com/account?redirect=welcome";
    let resp = await this.request("GET", accountUrl, undefined, {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    });
    if (resp.status === 301 || resp.status === 302) {
      this.cookies.clear();
      await this.opts.onCookiesChanged?.([]);
      resp = await this.request("GET", accountUrl, undefined, {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      });
    }
    if (!resp.ok) throw new Error(`/account returned ${resp.status}`);
    const html = await resp.text();
    const tokenMatch =
      /requestToken\s*:\s*['"]([a-f0-9]{32,128})['"]/i.exec(html) ??
      /name=["']request_token["']\s+value=["']([a-f0-9]{32,128})["']/i.exec(html) ??
      /["']request_token["']\s*[:=]\s*["']([a-f0-9]{32,128})["']/i.exec(html);
    const requestToken = tokenMatch?.[1];
    if (!requestToken) throw new Error("could not find requestToken in /account html");

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
    if (!loginResp.ok) throw new Error(`loginUserWithPassword ${loginResp.status}`);
    const payload = (await loginResp.json()) as LoginResponse;
    if (payload.status !== 1 || !payload.data?.success) {
      throw new Error(`login failed: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    this.userId = payload.data.user_id;
    return { userId: this.userId, username: payload.data.username };
  }

  async resolveUserId(): Promise<string> {
    if (this.userId && this.userId !== "cached") return this.userId;
    const sso = Array.from(this.cookies.values()).find(
      (c) => c.name === "TournoiEnLigne_sso_user" && c.value && c.value !== "deleted",
    );
    if (sso) {
      const [, uid] = decodeURIComponent(sso.value).split("$");
      if (uid) { this.userId = uid; return uid; }
    }
    await this.login();
    if (this.userId && this.userId !== "cached") return this.userId;
    throw new Error("could not resolve user id");
  }

  async listTables(opts: { status?: "open" | "play" | "finished"; games?: number | string } = {}): Promise<Record<string, RawTableInfo>> {
    const params = new URLSearchParams();
    params.set("status", opts.status ?? "open");
    if (opts.games !== undefined) params.set("games", String(opts.games));
    params.set("turninfo", "true");
    params.set("matchmakingtables", "true");
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/tablemanager/tablemanager/tableinfos.html",
      params,
    );
    const json = (await resp.json()) as BGAEnvelope<{ tables?: Record<string, RawTableInfo> }>;
    if (json.status !== 1) throw new Error(`listTables: ${JSON.stringify(json).slice(0, 200)}`);
    return json.data?.tables ?? {};
  }

  /**
   * Direct per-table lookup via `tableinfos.html?id=<tableId>`. The real
   * BGA UI uses this to fetch a single table's full state without paging
   * the global lobby lists (which roll off recently-finished tables
   * within seconds). Use this to chase down in-flight games whose
   * `finished` snapshot the polling loop missed.
   */
  async getTableInfo(tableId: number | string): Promise<RawTableInfo | null> {
    const params = new URLSearchParams({
      id: String(tableId),
      "dojo.preventCache": String(Date.now()),
    });
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/tablemanager/tablemanager/tableinfos.html",
      params,
    );
    const json = (await resp.json()) as BGAEnvelope<{ tables?: Record<string, RawTableInfo> }>;
    if (json.status !== 1) return null;
    return json.data?.tables?.[String(tableId)] ?? null;
  }

  async myTables(gameId = 81): Promise<RawTableInfo[]> {
    await this.login();
    const uid = await this.resolveUserId();
    // Include "finished" so the bot can observe game endings and say GG.
    // BGA may not return more than the most-recent finished tables; that's
    // fine — we only need to catch them once.
    const [open, playing, done] = await Promise.all([
      this.listTables({ status: "open", games: gameId }).catch(() => ({})),
      this.listTables({ status: "play", games: gameId }).catch(() => ({})),
      this.listTables({ status: "finished", games: gameId }).catch(() => ({})),
    ]);
    const merged: Record<string, RawTableInfo> = { ...open, ...playing, ...done };
    return Object.values(merged).filter((t) => t.players && uid in t.players);
  }

  async joinTable(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/joingame.html",
      `table=${tableId}`,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  async acceptGameStart(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    const resp = await this.request(
      "GET",
      `https://boardgamearena.com/table/table/acceptGameStart.html?table=${tableId}&dojo.preventCache=${Date.now()}`,
      undefined,
      { referer: "https://boardgamearena.com/lobby" },
    );
    const text = await resp.text();
    try { return JSON.parse(text) as BGAEnvelope<unknown>; }
    catch { return { status: 1, data: `http=${resp.status}` } as BGAEnvelope<unknown>; }
  }

  /**
   * POST /table/table/createnew.html — creates an open lobby table. By
   * default BGA marks new tables as ranked; pair this with changeOption
   * (id=201, value=1) to flip to "Training mode" (friendly, no ELO).
   * Returns the new table id, or throws.
   */
  async createTable(opts: {
    gameId?: number;
    gamemode?: "realtime" | "async";
    forceManual?: boolean;
    isMeeting?: boolean;
    friendsOnly?: boolean;
  } = {}): Promise<number> {
    const mode = opts.gamemode ?? "realtime";
    // Construct EXACTLY like the working probe variant — same key order,
    // same constructor pattern, same URL. URLSearchParams object-literal
    // constructor preserves insertion order, matching what the probe sends.
    const qs = new URLSearchParams({
      game: String(opts.gameId ?? 81),
      gamemode: mode,
      ...(opts.forceManual === true ? { forceManual: "true" } : {}),
      is_meeting: opts.isMeeting ? "true" : "false",
      ...(opts.friendsOnly ? { friendsonly: "true" } : {}),
      "dojo.preventCache": String(Date.now()),
    });
    const url = `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`;
    console.log(`createTable url=${url}`);
    const resp = await this.request("GET", url);
    const text = await resp.text();
    console.log(`createTable resp status=${resp.status} body=${text.slice(0, 300)}`);
    let json: BGAEnvelope<{ table?: number }>;
    try { json = JSON.parse(text) as BGAEnvelope<{ table?: number }>; }
    catch { throw new Error(`createTable non-json: ${text.slice(0, 200)}`); }
    if (json.status !== 1 || !json.data?.table) {
      throw new Error(`createTable failed gamemode=${mode}: ${JSON.stringify(json).slice(0, 240)}`);
    }
    return json.data.table;
  }

  /**
   * POST /table/table/changeoption.html — update a single table option in
   * setup phase. For chess (game=81): id=201 value=1 → Training (friendly,
   * no ELO), value=2 → Arena/ranked.
   */
  async changeOption(
    tableId: number | string,
    optionId: number,
    value: number | string,
  ): Promise<BGAEnvelope<unknown>> {
    const body = new URLSearchParams({
      table: String(tableId),
      id: String(optionId),
      value: String(value),
    });
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/changeoption.html",
      body,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /**
   * POST /table/table/openTableNow.html — publishes a created table to the
   * public lobby (the "Search for players" button). Without this call the
   * table is only reachable by direct link.
   */
  async openTableNow(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    const body = new URLSearchParams({ table: String(tableId) });
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/openTableNow.html",
      body,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /**
   * POST /table/table/quitgame.html — leave a table. When the leaver is the
   * sole/creator seat on a not-yet-started table, BGA destroys the table.
   */
  async leaveTable(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    const body = new URLSearchParams({
      table: String(tableId),
      neutralized: "true",
    });
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/quitgame.html",
      body,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /**
   * POST /table/table/quitgame.html WITHOUT neutralized — mid-game forfeit
   * ("quit the game"). The opponent is awarded the win. Use this instead
   * of leaveTable() once a game is past setup.
   */
  async resign(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    const body = new URLSearchParams({ table: String(tableId) });
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/quitgame.html",
      body,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  async chat(tableId: number | string, msg: string): Promise<BGAEnvelope<unknown>> {
    const body = new URLSearchParams({ table: String(tableId), msg });
    const resp = await this.request(
      "POST",
      "https://en.boardgamearena.com/table/table/say.html",
      body,
    );
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  async chatHistory(tableId: number | string): Promise<ChatMessage[]> {
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

  async decide(
    tableId: number | string,
    type: string,
    decision: 0 | 1,
    gameserverNum?: number | string,
  ): Promise<BGAEnvelope<unknown>> {
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

  async selectCell(
    gameserverNum: number | string,
    tableId: number | string,
    cellX: number,
    cellY: number,
    selectedPieceId: number | string,
  ): Promise<BGAEnvelope<unknown>> {
    const lock = randomUuid();
    const url =
      `https://boardgamearena.com/${gameserverNum}/chess/chess/selectCell.html` +
      `?cell_x=${cellX}&cell_y=${cellY}&selected_piece=${selectedPieceId}` +
      `&lock=${lock}&table=${tableId}&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  async wakeup(gameserverNum: number | string, tableId: number | string): Promise<BGAEnvelope<unknown>> {
    const url = `https://boardgamearena.com/${gameserverNum}/chess/chess/wakeup.html?myturnack=true&table=${tableId}&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  async resolveGameserver(tableId: number | string): Promise<number | null> {
    const resp = await this.request(
      "GET",
      `https://boardgamearena.com/table?table=${tableId}`,
      undefined,
      { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    );
    // 302 Location header — old behavior, kept in case BGA goes back to it.
    const loc = resp.headers.get("location") ?? "";
    const fromLoc = /\/(\d+)\/chess\?/.exec(loc);
    if (fromLoc) return Number(fromLoc[1]);
    // Modern flow: BGA returns 200 with the rendered game page; scrape the
    // gameserver number from the body. Two reliable signatures.
    const body = await resp.text();
    const fromPath = /\/(\d+)\/chess\?table/.exec(body);
    if (fromPath) return Number(fromPath[1]);
    const fromKey = /gameserver["']?\s*[:=]\s*["']?(\d+)/.exec(body);
    if (fromKey) return Number(fromKey[1]);
    return null;
  }

  async fetchGamePage(gameserverNum: number | string, tableId: number | string): Promise<string> {
    const resp = await this.request(
      "GET",
      `https://boardgamearena.com/${gameserverNum}/chess?table=${tableId}`,
      undefined,
      {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `https://boardgamearena.com/table?table=${tableId}`,
      },
    );
    return await resp.text();
  }
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

function randomUuid(): string {
  return crypto.randomUUID();
}
