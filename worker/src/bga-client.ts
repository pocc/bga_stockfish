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

  async listTables(opts: { status?: "open" | "play" | "finished" | "setup"; games?: number | string } = {}): Promise<Record<string, RawTableInfo>> {
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
   * Direct per-table lookup via the post-game `table/table/tableinfos.html`
   * endpoint. This is the call BGA's own per-table page issues after a game
   * ends; it returns the rich per-table envelope (data IS the table, not
   * data.tables[id]) including `status: "finished"`, `result` with scores,
   * and the full players map. Use this to chase down in-flight games whose
   * `finished` lobby snapshot the polling loop missed.
   *
   * The older `tablemanager/tablemanager/tableinfos.html?id=` endpoint
   * (which mirrors the lobby shape) was unreliable: it intermittently
   * returned "didn't manage to process your request fast enough" errors
   * and never included a `status: "finished"` row for completed games.
   */
  async getTableInfo(tableId: number | string): Promise<RawTableInfo | null> {
    const qs = new URLSearchParams({
      id: String(tableId),
      nosuggest: "true",
      table: String(tableId),
      noerrortracking: "true",
      "dojo.preventCache": String(Date.now()),
    });
    const resp = await this.request(
      "GET",
      `https://boardgamearena.com/table/table/tableinfos.html?${qs}`,
      undefined,
      { referer: `https://boardgamearena.com/table?table=${tableId}` },
    );
    const text = await resp.text();
    let json: BGAEnvelope<RawTableInfo & {
      result?: { player?: Array<{ player_id?: string; score?: string }> };
    }>;
    try { json = JSON.parse(text) as typeof json; }
    catch { return null; }
    if (json.status !== 1 || !json.data) return null;
    const data = json.data;
    // The per-table endpoint omits per-seat scores from `players[pid]`
    // (unlike the lobby shape). For finished games BGA puts the
    // authoritative scores under `result.player[]` instead. Backfill
    // them onto the seat map so downstream code can keep reading
    // `players[uid].score` regardless of which endpoint produced the
    // table.
    const seats = (data.players ??= {});
    for (const p of data.result?.player ?? []) {
      if (!p.player_id) continue;
      const seat = (seats[p.player_id] ??= {});
      if (seat.score == null && p.score != null) seat.score = p.score;
    }
    return data;
  }

  /**
   * Fetch the full replay log for a finished/archived table via
   * `archive/archive/logs.html`. Returns BGA's parsed JSON envelope `data`
   * (containing `logs[]` with every `pieceMoved` notification), or null if
   * the log isn't available yet. The log can lag a few seconds behind a
   * realtime game flipping to `finished`, so callers should tolerate null
   * and retry. Read-only.
   */
  async getGameLog(tableId: number | string): Promise<unknown | null> {
    const resp = await this.request(
      "GET",
      `https://boardgamearena.com/archive/archive/logs.html?table=${tableId}&translated=true&dojo.preventCache=${Date.now()}`,
      undefined,
      { referer: `https://boardgamearena.com/table?table=${tableId}` },
    );
    const text = await resp.text();
    if (!text) return null;
    let json: BGAEnvelope<unknown>;
    try { json = JSON.parse(text) as BGAEnvelope<unknown>; }
    catch { return null; }
    if (json.status !== 1 || json.data == null) return null;
    return json.data;
  }

  /**
   * Player-scoped table list via `tableinfos.html?playerid=<uid>`. This is
   * the endpoint BGA's own UI uses to populate the "your games" sidebar,
   * and is the only way to discover:
   *   - friends-only / private invites (filtered out of status=open)
   *   - direct invitations from another player to the bot
   *   - rematch invites in status=setup that scope to a private audience
   * Returns every table the player is currently a participant of, across
   * all statuses. Combine with myTables() for full coverage.
   */
  async playerTables(uid: string): Promise<Record<string, RawTableInfo>> {
    const qs = new URLSearchParams({
      playerid: uid,
      "dojo.preventCache": String(Date.now()),
    });
    const resp = await this.request(
      "GET",
      `https://en.boardgamearena.com/tablemanager/tablemanager/tableinfos.html?${qs}`,
    );
    const json = (await resp.json()) as BGAEnvelope<{ tables?: Record<string, RawTableInfo> }>;
    if (json.status !== 1) return {};
    return json.data?.tables ?? {};
  }

  async myTables(gameId = 81): Promise<RawTableInfo[]> {
    await this.login();
    const uid = await this.resolveUserId();
    // status=setup catches "Propose rematch / Play again" invites where
    // someone has already seated themselves and is waiting on the bot
    // (the bot appears in players[] with table_status=expected). Without
    // it, those invites never enter handleTable and joinTable never
    // fires. The uid filter below scopes to tables the bot is in.
    //
    // playerTables() catches friends-only / private / direct invites that
    // never show up in the public status=open lobby.
    //
    // Include "finished" so the bot can observe game endings and say GG.
    // BGA may not return more than the most-recent finished tables; that's
    // fine, we only need to catch them once.
    const [open, setup, playing, done, mine] = await Promise.all([
      this.listTables({ status: "open", games: gameId }).catch(() => ({})),
      this.listTables({ status: "setup", games: gameId }).catch(() => ({})),
      this.listTables({ status: "play", games: gameId }).catch(() => ({})),
      this.listTables({ status: "finished", games: gameId }).catch(() => ({})),
      this.playerTables(uid).catch(() => ({})),
    ]);
    const merged: Record<string, RawTableInfo> = { ...open, ...setup, ...playing, ...done, ...mine };
    return Object.values(merged)
      .filter((t) => t.game_id === String(gameId))
      .filter((t) => t.players && uid in t.players);
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
   * POST /table/table/startgame.html — the table host launches the game.
   * acceptGameStart only marks a player ready; a realtime friendly table
   * stays "Open for joining" until the creator actually launches it with
   * this call. Idempotent-ish: a no-op once the table has started.
   */
  async startTable(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    const resp = await this.request(
      "POST",
      "https://boardgamearena.com/table/table/startgame.html",
      `table=${tableId}`,
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

  /**
   * GET /table/table/concede.html?src=menu — the UI "Concede" menu call.
   * Distinct from quitgame.html: this is the one that successfully clears a
   * terminal-but-seated zombie table (BGA returned status:1/data:ok for
   * quitgame.html in both flavors on table 863414707 but left the row at
   * status=play; the menu concede endpoint is what the in-game UI fires
   * from the Concede button).
   */
  async concedeMenu(tableId: number | string): Promise<BGAEnvelope<unknown>> {
    const url =
      `https://en.boardgamearena.com/table/table/concede.html` +
      `?src=menu&table=${tableId}` +
      `&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
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
    // Tolerate empty / non-JSON bodies: BGA acks some decisions with an empty
    // 200 and signals failure with a non-2xx. Never throw here — callers read
    // `status` to decide success (1) vs failure (0).
    const text = (await resp.text()).trim();
    if (!text) return { status: resp.ok ? 1 : 0 } as BGAEnvelope<unknown>;
    try { return JSON.parse(text) as BGAEnvelope<unknown>; }
    catch { return { status: resp.ok ? 1 : 0 } as BGAEnvelope<unknown>; }
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
    // BGA returns 200 OK + `{status:0,error:"..."}` for rejected moves
    // (illegal under their validator, stale gamestate, lock collision,
    // wrong-turn race). Without this check the bot records "played" and
    // never retries, so the same dead game lingers forever on its turn.
    const env = (await resp.json()) as BGAEnvelope<unknown> & { error?: string };
    if (env && Number(env.status) !== 1) {
      throw new Error(
        `selectCell rejected: ${JSON.stringify(env).slice(0, 200)}`,
      );
    }
    return env;
  }

  /**
   * GET /<gs>/chess/chess/promotePawn.html — choose the piece type when
   * a pawn reaches the back rank. Required follow-up after a selectCell
   * that lands on rank 8 (white) / rank 1 (black); BGA holds the table in
   * gamestate=4 (`playerPromotePawn`) until this is called. Always picks
   * `queen` in the bot for now — under-promotion isn't worth the engine
   * plumbing for a friendly-mode chess bot.
   */
  async promotePawn(
    gameserverNum: number | string,
    tableId: number | string,
    pieceType: "queen" | "rook" | "bishop" | "knight",
  ): Promise<BGAEnvelope<unknown>> {
    const lock = randomUuid();
    const url =
      `https://boardgamearena.com/${gameserverNum}/chess/chess/promotePawn.html` +
      `?piece_type=${pieceType}&lock=${lock}&table=${tableId}` +
      `&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
    const env = (await resp.json()) as BGAEnvelope<unknown> & { error?: string };
    if (env && Number(env.status) !== 1) {
      throw new Error(`promotePawn rejected: ${JSON.stringify(env).slice(0, 200)}`);
    }
    return env;
  }

  async wakeup(gameserverNum: number | string, tableId: number | string): Promise<BGAEnvelope<unknown>> {
    const url = `https://boardgamearena.com/${gameserverNum}/chess/chess/wakeup.html?myturnack=true&table=${tableId}&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
    return (await resp.json()) as BGAEnvelope<unknown>;
  }

  /**
   * GET /<gs>/chess/chess/declineDraw.html — the chess action that refuses a
   * pending draw offer (state 5 `playerAgreeToDraw`). Endpoint + param shape
   * confirmed from a captured browser request. The bot never accepts a draw
   * (it would record as 0.5/0.5 and skew stats), so when an opponent offers
   * one we call this to refuse and unblock our turn. Mirrors proposeDraw's
   * lock/token handling.
   *
   * The companion actions are `proposeDraw.html` (offer a draw) and, by the
   * same naming convention, `agreeDraw.html` (accept). We intentionally expose
   * NEITHER here — the bot must never offer or accept a draw, and keeping an
   * accept path around would be a footgun against that policy.
   */
  async declineDraw(gameserverNum: number | string, tableId: number | string): Promise<BGAEnvelope<unknown>> {
    const lock = randomUuid();
    const url =
      `https://boardgamearena.com/${gameserverNum}/chess/chess/declineDraw.html` +
      `?lock=${lock}&table=${tableId}&noerrortracking=true&dojo.preventCache=${Date.now()}`;
    const resp = await this.request("GET", url);
    // BGA chess action acks are frequently an EMPTY 200 body (like
    // acceptGameStart), so a strict resp.json() throws "Unexpected end of JSON
    // input" on what is actually a success. Treat any 2xx empty/non-JSON body
    // as ok; only a non-2xx status or a parsed {status:0} envelope is a real
    // rejection.
    const text = (await resp.text()).trim();
    if (!resp.ok) {
      throw new Error(`declineDraw http ${resp.status}: ${text.slice(0, 200)}`);
    }
    if (!text) return { status: 1 } as BGAEnvelope<unknown>;
    let env: BGAEnvelope<unknown> & { error?: string };
    try { env = JSON.parse(text) as typeof env; }
    catch { return { status: 1 } as BGAEnvelope<unknown>; }
    if (Number(env.status) !== 1) {
      throw new Error(`declineDraw rejected: ${JSON.stringify(env).slice(0, 200)}`);
    }
    return env;
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
