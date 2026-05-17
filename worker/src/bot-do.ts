/**
 * BotDriver Durable Object — autonomous BGA chess bot.
 *
 * Owns the BGA session (login + cookies in DO storage) and per-table memo.
 * Self-schedules via DO alarm every TICK_MS milliseconds. A Cron Trigger
 * pokes /bot/tick once a minute as a watchdog in case the alarm chain
 * ever drops.
 *
 * Behavior matches `bga/scripts/bot-daemon.ts` plus actual move play:
 *   - friendly games only
 *   - auto-accept invites
 *   - auto-ack game start
 *   - opening chat once
 *   - accept "Propose to abandon collectively" proposals
 *   - reply "I'm not sure." to every new opponent chat message
 *   - on our turn: parse legal moves, ask /bestmove, send selectCell+wakeup
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import { BGAClient, type Cookie, type RawTableInfo } from "./bga-client";
import {
  parseGameHtml, buildFen, lookupUciMove, anyLegalMove, xyToSq,
  type Destination,
} from "./bot-move";
import {
  isJoinableStatus, isLivePlayStatus, isFinishedStatus,
  gamemodeOf, GAMEMODES, type Gamemode,
} from "./bot-status";

const TICK_MS = 5_000;
const OPENING_CHAT = "I am a nerfed version of stockfish, https://stockfishchess.org/ . Good luck!";
const CLOSING_CHAT = "Good Game!";
const CHAT_REPLY = "I'm not sure.";
const CONCEDE_CHAT = "I'm hitting too many errors playing this game and need to concede. Sorry!";
const ENGINE_DEPTH = 14;
const ENGINE_MOVETIME_MS = 4_000;
/** Don't retry createnew more often than this when BGA rejects it. */
const OPEN_INVITE_RETRY_MS = 60_000;
/** Tolerate the BGA indexing delay before declaring a freshly-created
 *  open invite gone. Without this grace, a tick that races ahead of
 *  tableinfos clears openInviteId and a duplicate table gets created. */
const OPEN_INVITE_GRACE_MS = 45_000;
/** Concede a game after this many consecutive errors on a single table. */
const MAX_TABLE_ERRORS = 3;
/** Cap on the rolling error log size kept in BotStatus. */
const RECENT_ERRORS_CAP = 20;
/** Cap on the rolling moves log size kept in BotStatus (across all tables). */
const RECENT_MOVES_CAP = 20;
/** Backoff schedule (ms) applied after consecutive tick failures. Index is
 *  consecutiveFailures - 1; clamped to the last entry. Resets on success. */
const TICK_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

interface OpenInvite {
  id: string | null;
  createdAt: number | null;
  lastAttempt: number | null;
}
function emptyInvite(): OpenInvite { return { id: null, createdAt: null, lastAttempt: null }; }

interface TableMemo {
  acceptedSeat: boolean;
  ackedStart: boolean;
  saidHi: boolean;
  saidGg: boolean;
  acceptedAbandon: boolean;
  finished: boolean;
  gameserver?: number;
  lastSeenChatId: number;
  chatSeeded: boolean;
  /** Count of consecutive failures handling this table. Resets on a
   *  successful step. Once it hits MAX_TABLE_ERRORS we concede + bail. */
  errorCount?: number;
  /** Marked true after we send the concede chat + resign. Once set, we
   *  stop touching this table — handleTable becomes a no-op for it. */
  conceded?: boolean;
}

interface ErrorEntry {
  ts: number;
  scope: string;
  msg: string;
  tableId?: string;
}

interface MoveEntry {
  ts: number;
  tableId: string;
  from: string;
  to: string;
  engine: string;
}

interface BotStats {
  wins: number;
  losses: number;
  draws: number;
  /** Games we conceded automatically due to MAX_TABLE_ERRORS. */
  concedes: number;
  /** Per-engine move counter ("chess-api.com", "stockfish-wasm", "random", ...). */
  engineUses: Record<string, number>;
}

interface BotStatus {
  loggedIn: boolean;
  uid: string | null;
  running: boolean;
  lastTickAt: number | null;
  /** Latest single error (kept for backward compat with the old shape). */
  lastErr: string | null;
  /** Rolling log of recent errors across the bot, capped at RECENT_ERRORS_CAP. */
  recentErrors: ErrorEntry[];
  /** Rolling log of moves the bot has played, capped at RECENT_MOVES_CAP. */
  recentMoves: MoveEntry[];
  /** Lifetime counters (won't reset across DO restarts since they're persisted). */
  stats: BotStats;
  tables: Record<string, TableMemo>;
  /** One open lobby invite per gamemode (realtime + turn-based). */
  openInvites: Record<Gamemode, OpenInvite>;
  /** Diagnostic — last myTables snapshot (id, status, creator, game_id). */
  lastTablesSeen?: Array<{ id: string; status: string; creator: string; game_id: string }>;
  /** Consecutive failed ticks (myTables/login errors). Drives backoff. */
  consecutiveTickFailures: number;
  /** Earliest wall-time the next tick may run. Honors TICK_BACKOFF_MS. */
  nextTickEarliest: number | null;
}

export class BotDriver extends DurableObject<Env> {
  private client: BGAClient | null = null;
  private uid: string | null = null;
  private status: BotStatus = {
    loggedIn: false, uid: null, running: false,
    lastTickAt: null, lastErr: null,
    recentErrors: [], recentMoves: [],
    stats: { wins: 0, losses: 0, draws: 0, concedes: 0, engineUses: {} },
    tables: {},
    openInvites: { realtime: emptyInvite(), async: emptyInvite() },
    consecutiveTickFailures: 0,
    nextTickEarliest: null,
  };
  private booted = false;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/start") {
      await this.start();
      return Response.json({ ok: true, running: this.status.running });
    }
    if (url.pathname === "/stop") {
      await this.stop();
      return Response.json({ ok: true, running: this.status.running });
    }
    if (url.pathname === "/tick") {
      await this.boot();
      await this.tick();
      return Response.json({ ok: true, status: this.status });
    }
    if (url.pathname === "/status") {
      await this.boot();
      return Response.json(this.status);
    }
    if (url.pathname === "/cleanup") {
      await this.boot();
      const result = await this.cleanupExtras();
      return Response.json(result);
    }
    if (url.pathname === "/probe") {
      await this.boot();
      const onlyParam = url.searchParams.get("only");
      const only = onlyParam ? Number(onlyParam) : null;
      const result = await this.runRealtimeProbe(
        Number.isInteger(only) ? (only as number) : null,
      );
      return Response.json(result);
    }
    if (url.pathname === "/wipe") {
      const result = await this.wipeSession();
      return Response.json(result);
    }
    return new Response("not found", { status: 404 });
  }

  /** Diagnostic: run the same createnew variant matrix as the local probe
   *  script, but from inside the Worker, so we can compare what BGA returns
   *  here vs from a Node client. Each variant creates + publishes + reads
   *  back actual status + leaves the table. */
  private async runRealtimeProbe(only: number | null = null): Promise<unknown> {
    if (!this.client) return { error: "no client" };
    try { await this.client.login(); }
    catch (e) { return { error: `login: ${String(e).slice(0, 200)}` }; }

    const variants: Array<{ label: string; method: "GET" | "POST"; build: () => Promise<Response> }> = [
      {
        label: "GET realtime (no forceManual)",
        method: "GET",
        build: () => {
          const qs = new URLSearchParams({
            game: "81", gamemode: "realtime", is_meeting: "false",
            "dojo.preventCache": String(Date.now()),
          });
          return this.client!.request(
            "GET",
            `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`,
          );
        },
      },
      {
        label: "GET realtime forceManual=true",
        method: "GET",
        build: () => {
          const qs = new URLSearchParams({
            game: "81", gamemode: "realtime", forceManual: "true", is_meeting: "false",
            "dojo.preventCache": String(Date.now()),
          });
          return this.client!.request(
            "GET",
            `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`,
          );
        },
      },
      {
        label: "POST realtime (legacy body)",
        method: "POST",
        build: () => this.client!.request(
          "POST",
          "https://en.boardgamearena.com/table/table/createnew.html",
          new URLSearchParams({ game: "81", gamemode: "realtime", is_meeting: "false" }),
        ),
      },
      {
        label: "GET async (control)",
        method: "GET",
        build: () => {
          const qs = new URLSearchParams({
            game: "81", gamemode: "async", is_meeting: "false",
            "dojo.preventCache": String(Date.now()),
          });
          return this.client!.request(
            "GET",
            `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`,
          );
        },
      },
      {
        // Reproduces the bot tick's preamble: myTables → createnew.
        // If this returns ASYNC ✗ while the bare-createnew variants above
        // return REALTIME ✓, one of the three listTables calls is poisoning
        // BGA's session-mode state for this user.
        label: "myTables(81) then GET realtime forceManual=true (bot path)",
        method: "GET",
        build: async () => {
          await this.client!.myTables(81).catch(() => {});
          const qs = new URLSearchParams({
            game: "81", gamemode: "realtime", forceManual: "true", is_meeting: "false",
            "dojo.preventCache": String(Date.now()),
          });
          return this.client!.request(
            "GET",
            `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`,
          );
        },
      },
    ];
    // Side-effect channel for variants that need to run extra calls between
    // the createnew response and the status check. Set by the variant's
    // build(); consumed once per iteration below.
    type PostHook = (tableId: string) => Promise<void>;
    const hookSlot: { fn: PostHook | null } = { fn: null };
    variants.push({
      // Full bot path: createnew → changeOption(201,1) → status check.
      // Tests the hypothesis that the Training-mode toggle is what flips
      // the table from realtime "open" to "asyncopen".
      label: "GET realtime forceManual=true + changeOption(201,1)",
      method: "GET",
      build: () => {
        hookSlot.fn = async (tableId) => {
          await this.client!.changeOption(tableId, 201, 1).catch(() => {});
        };
        const qs = new URLSearchParams({
          game: "81", gamemode: "realtime", forceManual: "true", is_meeting: "false",
          "dojo.preventCache": String(Date.now()),
        });
        return this.client!.request(
          "GET",
          `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`,
        );
      },
    });

    const results: Array<{
      label: string; method: string; tableId: string | null;
      createStatus: number; createBody: string;
      actualStatus: string | null; verdict: string;
    }> = [];

    const toRun = only != null && only >= 0 && only < variants.length
      ? [variants[only]]
      : variants;
    for (const v of toRun) {
      let createBody = "";
      let createStatus = 0;
      let id: string | null = null;
      try {
        const resp = await v.build();
        createStatus = resp.status;
        createBody = (await resp.text()).slice(0, 400);
        try {
          const j = JSON.parse(createBody);
          if (j?.status === 1 && j?.data?.table) id = String(j.data.table);
        } catch {}
      } catch (e) {
        createBody = `EXC: ${String(e).slice(0, 300)}`;
      }
      let actualStatus: string | null = null;
      if (id) {
        // Run variant-specific between-create-and-publish steps (e.g.
        // changeOption) before publishing. Consume the hook so it doesn't
        // bleed into the next variant.
        if (hookSlot.fn) {
          const hook = hookSlot.fn;
          hookSlot.fn = null;
          await hook(id).catch(() => {});
        }
        // Publish so the status filter has something to match against.
        await this.client.openTableNow(id).catch(() => {});
        for (let i = 0; i < 4 && actualStatus == null; i++) {
          await new Promise((r) => setTimeout(r, 350));
          for (const s of ["open", "asyncopen", "init", "setup"]) {
            const r = await this.client.request(
              "POST",
              "https://boardgamearena.com/tablemanager/tablemanager/tableinfos.html",
              new URLSearchParams({ status: s, games: "81", turninfo: "false" }),
            ).catch(() => null);
            if (!r) continue;
            const j = await r.json().catch(() => null) as
              { data?: { tables?: Record<string, { status?: string }> } } | null;
            const t = j?.data?.tables?.[id];
            if (t?.status) { actualStatus = t.status; break; }
          }
        }
        await this.client.leaveTable(id).catch(() => {});
      }
      const verdict = !id
        ? "CREATE_FAILED"
        : actualStatus === "open" ? "REALTIME ✓"
        : actualStatus === "asyncopen" ? "ASYNC ✗"
        : `?(${actualStatus ?? "not-found"})`;
      results.push({
        label: v.label, method: v.method, tableId: id,
        createStatus, createBody, actualStatus, verdict,
      });
    }
    return { uid: this.uid, results };
  }

  /** Nuke cookies + slot state and force a fresh login on next tick.
   *  More aggressive than cleanupExtras (which preserves cookies). */
  private async wipeSession(): Promise<{ ok: boolean; cleared: string[] }> {
    const cleared: string[] = [];
    const storage = this.ctx.storage;
    await storage.delete("cookies"); cleared.push("cookies");
    await storage.delete("openInvites"); cleared.push("openInvites");
    await storage.delete("openInviteId"); cleared.push("openInviteId(legacy)");
    await storage.delete("openInviteCreatedAt"); cleared.push("openInviteCreatedAt(legacy)");
    await storage.delete("tables"); cleared.push("tables");
    this.status.openInvites = { realtime: emptyInvite(), async: emptyInvite() };
    this.status.tables = {};
    this.status.loggedIn = false;
    this.status.uid = null;
    this.uid = null;
    this.client = null;
    this.booted = false;
    return { ok: true, cleared };
  }

  async alarm(): Promise<void> {
    await this.boot();
    try { await this.tick(); }
    catch (e) { this.recordError("alarm", e); }
    if (this.status.running) {
      const delay = this.status.consecutiveTickFailures > 0
        ? TICK_BACKOFF_MS[Math.min(this.status.consecutiveTickFailures - 1, TICK_BACKOFF_MS.length - 1)]
        : TICK_MS;
      this.status.nextTickEarliest = Date.now() + delay;
      await this.ctx.storage.setAlarm(this.status.nextTickEarliest);
    }
  }

  /** Centralized error recording: pushes to rolling log, also keeps a
   *  single most-recent in lastErr for back-compat. */
  private recordError(scope: string, err: unknown, tableId?: string): void {
    const msg = String(err).slice(0, 400);
    this.status.lastErr = `${scope}: ${msg}`;
    this.status.recentErrors.push({ ts: Date.now(), scope, msg, tableId });
    if (this.status.recentErrors.length > RECENT_ERRORS_CAP) {
      this.status.recentErrors.splice(0, this.status.recentErrors.length - RECENT_ERRORS_CAP);
    }
    console.error(`bot:${scope}${tableId ? ` t=${tableId}` : ""} ${msg}`);
  }

  private recordMove(tableId: string, from: string, to: string, engine: string): void {
    this.status.recentMoves.push({ ts: Date.now(), tableId, from, to, engine });
    if (this.status.recentMoves.length > RECENT_MOVES_CAP) {
      this.status.recentMoves.splice(0, this.status.recentMoves.length - RECENT_MOVES_CAP);
    }
    this.status.stats.engineUses[engine] = (this.status.stats.engineUses[engine] ?? 0) + 1;
  }

  // --- lifecycle ---

  private async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    const storage = this.ctx.storage;
    const cookies = (await storage.get<Cookie[]>("cookies")) ?? [];
    const tables = (await storage.get<Record<string, TableMemo>>("tables")) ?? {};
    const running = (await storage.get<boolean>("running")) ?? false;
    this.status.tables = tables;
    this.status.running = running;

    const storedInvites = await storage.get<Record<Gamemode, OpenInvite>>("openInvites");
    if (storedInvites && storedInvites.realtime && storedInvites.async) {
      this.status.openInvites = storedInvites;
    } else {
      // Migration from the previous single-invite shape; treat legacy entry
      // as the realtime slot, leave async empty.
      const legacyId = (await storage.get<string | null>("openInviteId")) ?? null;
      const legacyCreatedAt = (await storage.get<number | null>("openInviteCreatedAt")) ?? null;
      this.status.openInvites = {
        realtime: { id: legacyId, createdAt: legacyCreatedAt, lastAttempt: null },
        async: emptyInvite(),
      };
    }
    this.status.stats =
      (await storage.get<BotStats>("stats")) ?? this.status.stats;
    this.status.recentErrors =
      (await storage.get<ErrorEntry[]>("recentErrors")) ?? [];
    this.status.recentMoves =
      (await storage.get<MoveEntry[]>("recentMoves")) ?? [];
    const username = this.env.BGA_USERNAME;
    const password = this.env.BGA_PASSWORD;
    if (!username || !password) {
      this.status.lastErr = "BGA_USERNAME / BGA_PASSWORD not set as Worker secrets";
      return;
    }
    this.client = new BGAClient({
      username, password, cookies,
      onCookiesChanged: async (c) => { await storage.put("cookies", c); },
    });
  }

  private async start(): Promise<void> {
    await this.boot();
    this.status.running = true;
    await this.ctx.storage.put("running", true);
    await this.ctx.storage.setAlarm(Date.now() + 100);
  }

  private async stop(): Promise<void> {
    await this.boot();
    this.status.running = false;
    await this.ctx.storage.put("running", false);
    await this.ctx.storage.deleteAlarm();
  }

  // --- per-tick logic ---

  private async tick(): Promise<void> {
    if (!this.client) return;
    this.status.lastTickAt = Date.now();
    try {
      if (!this.uid) {
        await this.client.login();
        this.uid = await this.client.resolveUserId();
        this.status.uid = this.uid;
        this.status.loggedIn = true;
      }
    } catch (e) {
      this.recordError("login", e);
      this.status.consecutiveTickFailures++;
      return;
    }
    let tables: RawTableInfo[];
    try { tables = await this.client.myTables(81); }
    catch (e) {
      this.recordError("myTables", e);
      this.status.consecutiveTickFailures++;
      return;
    }
    // myTables succeeded → reset backoff counter and clear stale single-err.
    this.status.consecutiveTickFailures = 0;
    this.status.lastErr = null;

    // Reconcile in-flight games that fell off the global lobby snapshot.
    // BGA's tableinfos.html?status=finished returns a recently-finished
    // list that rolls off within seconds; if our poll missed it, the GG
    // branch never fires. For any memo that was actively being played
    // (`gameserver != null && saidHi && !saidGg && !finished`) but isn't
    // in this tick's snapshot, fetch it directly by id. If BGA reports
    // it as finished we inject it into `tables` so handleTable can
    // observe the transition and send GG once.
    const seenIds = new Set(tables.map((t) => t.id));
    const missing = Object.entries(this.status.tables).filter(
      ([id, m]) =>
        m.gameserver != null && m.saidHi && !m.saidGg && !m.finished && !m.conceded
        && !seenIds.has(id),
    );
    for (const [id] of missing) {
      const t = await this.client.getTableInfo(id).catch(() => null);
      if (t) tables.push(t);
    }

    this.status.lastTablesSeen = tables.map((t) => ({
      id: t.id, status: t.status, creator: t.table_creator, game_id: t.game_id,
    }));

    for (const t of tables) {
      const skip = this.shouldSkip(t);
      if (skip) continue;
      try {
        await this.handleTable(t);
        // Successful step — clear the table's error count.
        const m = this.status.tables[t.id];
        if (m && m.errorCount) m.errorCount = 0;
      } catch (e) {
        this.recordError("handleTable", e, t.id);
        const m = this.getMemo(t.id);
        m.errorCount = (m.errorCount ?? 0) + 1;
        if (
          !m.conceded &&
          m.errorCount >= MAX_TABLE_ERRORS &&
          isLivePlayStatus(t.status)
        ) {
          await this.concedeTable(t.id, m).catch((ce) => {
            this.recordError("concede", ce, t.id);
          });
        }
      }
    }
    // Garbage-collect memo for finished/conceded tables we no longer see.
    const liveIds = new Set(tables.map((t) => t.id));
    for (const id of Object.keys(this.status.tables)) {
      const m = this.status.tables[id];
      if (!liveIds.has(id) && (m.finished || m.conceded)) {
        delete this.status.tables[id];
      }
    }
    await this.ctx.storage.put("tables", this.status.tables);
    await this.ctx.storage.put("stats", this.status.stats);
    await this.ctx.storage.put("recentErrors", this.status.recentErrors);
    await this.ctx.storage.put("recentMoves", this.status.recentMoves);

    try { await this.maybeCreateOpenInvite(tables); }
    catch (e) { this.recordError("openInvite", e); }
  }

  /** Send a polite concede message and resign the table. Idempotent on the
   *  conceded flag — safe to retry, but won't double-send the chat. */
  private async concedeTable(tableId: string, m: TableMemo): Promise<void> {
    if (!this.client || m.conceded) return;
    await this.client.chat(tableId, CONCEDE_CHAT).catch(() => {});
    await this.client.resign(tableId).catch((e) => {
      this.recordError("resign", e, tableId);
    });
    m.conceded = true;
    m.finished = true;
    this.status.stats.concedes++;
  }

  /**
   * Admin: enumerate every unstarted chess table created by this bot and
   * leave all but the canonical openInviteId (or the first one, if no
   * canonical exists). Returns the IDs found and the IDs left so the
   * caller can verify.
   */
  private async cleanupExtras(): Promise<{
    found: string[]; left: string[]; errors: Record<string, string>;
  }> {
    if (!this.client || !this.uid) {
      try {
        await this.client?.login();
        this.uid = (await this.client?.resolveUserId()) ?? null;
        this.status.uid = this.uid;
        this.status.loggedIn = !!this.uid;
      } catch (e) {
        return { found: [], left: [], errors: { login: String(e).slice(0, 200) } };
      }
    }
    if (!this.client || !this.uid) {
      return { found: [], left: [], errors: { login: "no client/uid" } };
    }
    const tables = await this.client.myTables(81);
    const myOpen = tables.filter(
      (t) =>
        t.game_id === "81" &&
        t.table_creator === this.uid &&
        isJoinableStatus(t.status),
    );
    const found = myOpen.map((t) => t.id);
    const errors: Record<string, string> = {};
    const left: string[] = [];
    for (const t of myOpen) {
      try {
        await this.client.leaveTable(t.id);
        left.push(t.id);
        delete this.status.tables[t.id];
      } catch (e) {
        errors[t.id] = String(e).slice(0, 160);
      }
    }
    this.status.openInvites = { realtime: emptyInvite(), async: emptyInvite() };
    await this.ctx.storage.put("openInvites", this.status.openInvites);
    await this.ctx.storage.put("tables", this.status.tables);
    return { found, left, errors };
  }

  /**
   * Maintain one lobby-visible "friendly" table per gamemode (realtime +
   * turn-based) so any BGA player can sit down regardless of which lobby
   * they prefer. The bot can play many games in parallel, so the open
   * invites stay up regardless of how many games are already underway.
   *
   * Rate-limited to once every OPEN_INVITE_RETRY_MS on failure so a broken
   * BGA endpoint can't trigger a tight loop.
   */
  private async maybeCreateOpenInvite(tables: RawTableInfo[]): Promise<void> {
    if (!this.client || !this.uid) return;
    const now = Date.now();
    const byId = new Map(tables.map((t) => [t.id, t]));

    // Group bot-owned joinable tables by gamemode, plus an "unknown" bucket
    // for init/setup tables we can't classify from status alone.
    const myJoinable = tables.filter(
      (t) =>
        t.game_id === "81" &&
        t.table_creator === this.uid &&
        isJoinableStatus(t.status),
    );

    // First pass: adopt any unowned-but-matching tables into the slot for
    // their gamemode (covers restarts where DO storage was cleared).
    for (const t of myJoinable) {
      const mode = gamemodeOf(t.status);
      if (!mode) continue;
      const slot = this.status.openInvites[mode];
      if (slot.id == null) {
        slot.id = t.id;
        slot.createdAt = now;
      }
    }

    // Cancel any extras. Two safety rules guard against the bot abandoning
    // its own freshly-created tables:
    //   1. Compare against ALL slot ids, not just the slot for the table's
    //      gamemode — `gamemodeOf` returns null for "init"/"setup", which
    //      is exactly the status a brand-new table reports for a few
    //      seconds before BGA promotes it to "open"/"asyncopen".
    //   2. Never leave an unclassifiable (init/setup) table even if no
    //      slot claims it. Post-restart orphans will reappear as
    //      open/asyncopen on a later tick and get cleaned up safely then.
    // Only the realtime slot is "ours" for the purposes of the cleanup
    // loop. Any leftover async invite the bot still owns gets garbage-
    // collected here so we end up with exactly one realtime advertisement.
    const ourSlotIds = new Set<string>();
    if (this.status.openInvites.realtime.id) {
      ourSlotIds.add(this.status.openInvites.realtime.id);
    }
    // Also null out the async slot record so it doesn't get re-published.
    if (this.status.openInvites.async.id) {
      this.status.openInvites.async = emptyInvite();
    }
    for (const t of myJoinable) {
      if (ourSlotIds.has(t.id)) continue;
      if (!gamemodeOf(t.status)) continue;
      await this.client.leaveTable(t.id).catch((e) => {
        this.recordError("leaveTable", e, t.id);
      });
      delete this.status.tables[t.id];
    }

    // Realtime-only invite policy: we only advertise one realtime slot.
    // The async slot is intentionally left empty — async tables created
    // by us in the past stay playable until they finish, but we don't
    // refresh them. (Run /bot/cleanup to clear leftover async invites.)
    for (const mode of ["realtime"] as const) {
      const slot = this.status.openInvites[mode];
      if (slot.id) {
        const t = byId.get(slot.id);
        if (t && isJoinableStatus(t.status)) {
          const actualMode = gamemodeOf(t.status);
          if (actualMode === mode) {
            // Confirmed correct mode — clear any retry cooldown and
            // re-publish defensively (idempotent on BGA's side).
            slot.lastAttempt = null;
            await this.client.openTableNow(slot.id).catch(() => {});
            continue;
          }
          if (actualMode === null) {
            // Transient init/setup status — BGA hasn't promoted the
            // table to open/asyncopen yet. Don't neutralize: that would
            // kill our own freshly-created table (and any opponent who
            // had just sat down). Wait for the next tick.
            continue;
          }
          // Confirmed wrong mode (e.g. realtime demoted to async): leave
          // the rogue table and schedule a recreate. The
          // OPEN_INVITE_RETRY_MS cooldown is honored before retry so a
          // persistently-broken realtime path can't flood the lobby
          // (max one createTable per minute per mode).
          this.recordError(
            `modeMismatch:${mode}->${actualMode}`,
            `BGA returned ${t.status} for gamemode=${mode}`,
            slot.id,
          );
          await this.client.leaveTable(slot.id).catch(() => {});
          slot.id = null;
          slot.createdAt = null;
        }
        if (!t) {
          // Indexing race: don't clear too eagerly.
          if (now - (slot.createdAt ?? 0) < OPEN_INVITE_GRACE_MS) continue;
        }
        // Gone or started — clear so we recreate below.
        slot.id = null;
        slot.createdAt = null;
      }

      // BGA caps one realtime game per game type per account. If we're
      // already mid-game on a realtime table, createTable(realtime) is
      // guaranteed to fail with code=100 ("game in progress at another
      // table"). Skip until that game finishes. Async has no such cap.
      if (mode === "realtime" && tables.some((t) => t.status === "play")) {
        continue;
      }

      // Cooldown after a recent failed attempt.
      if (slot.lastAttempt && now - slot.lastAttempt < OPEN_INVITE_RETRY_MS) continue;
      slot.lastAttempt = now;

      try {
        const tableId = await this.client.createTable({
          gameId: 81,
          gamemode: mode,
          // forceManual=true mirrors the real BGA UI call for realtime
          // tables — without it BGA silently demotes the table to async
          // regardless of the gamemode param.
          forceManual: mode === "realtime",
        });
        // Toggle 0→1 sequence: a single direct set to (201,1) silently
        // demotes realtime to async. Real UI does the toggle and that
        // preserves the gamemode (verified via probe-friendly-flow.ts).
        await this.client.changeOption(tableId, 201, 0).catch((e) => {
          this.recordError(`changeOption0:${mode}`, e, String(tableId));
        });
        await this.client.changeOption(tableId, 201, 1).catch((e) => {
          this.recordError(`changeOption1:${mode}`, e, String(tableId));
        });
        await this.client.openTableNow(tableId).catch((e) => {
          this.recordError(`openTableNow:${mode}`, e, String(tableId));
        });
        slot.id = String(tableId);
        slot.createdAt = now;
        // Keep lastAttempt set so a wrong-mode result triggers cooldown
        // before another createTable. Cleared only after we've observed
        // a correctly-moded open slot in the verification path above.
        console.log(`opened ${mode} friendly invite table=${tableId}`);
      } catch (e) {
        this.recordError(`createTable:${mode}`, e);
      }
    }

    await this.ctx.storage.put("openInvites", this.status.openInvites);
  }

  private shouldSkip(t: RawTableInfo): boolean {
    const raw = t as RawTableInfo & {
      has_tournament?: string; tournament_id?: string | null;
      unranked?: string; game_hide_ranking?: string;
    };
    if (raw.has_tournament && raw.has_tournament !== "0") return true;
    if (raw.tournament_id) return true;
    if (t.game_id !== "81") return true;
    if (raw.unranked === "0" && raw.game_hide_ranking === "0") return true;
    return false;
  }

  private getMemo(id: string): TableMemo {
    let m = this.status.tables[id];
    if (!m) {
      m = {
        acceptedSeat: false, ackedStart: false, saidHi: false, saidGg: false,
        acceptedAbandon: false, finished: false,
        lastSeenChatId: 0, chatSeeded: false,
      };
      this.status.tables[id] = m;
    }
    return m;
  }

  private async handleTable(t: RawTableInfo): Promise<void> {
    if (!this.client || !this.uid) return;
    const m = this.getMemo(t.id);
    if (m.conceded) return;
    const meSeat = t.players?.[this.uid];
    if (!meSeat) return;

    // 1. accept invite
    if (!m.acceptedSeat && meSeat.table_status === "expected") {
      await this.client.joinTable(t.id);
      m.acceptedSeat = true;
      return;
    }
    if (meSeat.table_status === "play" || meSeat.table_status === "expected") {
      m.acceptedSeat = true;
    }

    // 2. ack game start (realtime only — async games skip this handshake
    //    and transition asyncopen → asyncplay automatically).
    if (isJoinableStatus(t.status) && !m.ackedStart) {
      if (t.status === "asyncopen") {
        m.ackedStart = true;
      } else {
        const seatsFilled = Object.values(t.players ?? {}).filter((p) => p.table_status === "play").length;
        const needed = Number(t.min_player ?? "2");
        if (seatsFilled >= needed) {
          await this.client.acceptGameStart(t.id);
          m.ackedStart = true;
        }
      }
      return;
    }

    // 3. in play (realtime "play" or turn-based "asyncplay")
    if (isLivePlayStatus(t.status)) {
      // Async games never went through the ackedStart branch above.
      if (!m.ackedStart) m.ackedStart = true;
      if (!m.saidHi) {
        await this.client.chat(t.id, OPENING_CHAT).catch(() => {});
        m.saidHi = true;
      }
      // resolve gameserver number once we're live
      if (m.gameserver == null) {
        const gs = await this.client.resolveGameserver(t.id).catch(() => null);
        if (gs != null) m.gameserver = gs;
      }

      // chat-reply
      await this.pollAndReplyChat(t.id, m).catch(() => {});

      // End-of-game offers: accept both "Propose to abandon the game
      // collectively" and direct draw offers. `acceptedAbandon` is the
      // legacy field name — kept to avoid migrating stored memos.
      if (!m.acceptedAbandon && m.gameserver != null) {
        try {
          const pending = await this.pollPendingDecision(t.id, m.gameserver);
          if (pending === "abandon" || pending === "draw") {
            await this.client.decide(t.id, pending, 1, m.gameserver);
            m.acceptedAbandon = true;
          }
        } catch { /* ignore — retry next tick */ }
      }

      // Our move. Don't pre-gate on current_player_nbr/table_order — those
      // fields aren't populated reliably for async tableinfos, and
      // maybePlayMove already bails on activePlayer mismatch and on empty
      // destinationsByPiece, so calling it every tick is safe.
      if (m.gameserver != null && !m.acceptedAbandon) {
        await this.maybePlayMove(t.id, m);
      }
      return;
    }

    // 4. finished — say GG once + count the result (realtime "finished" or
    //    async "asyncfinished").
    if (isFinishedStatus(t.status)) {
      if (!m.finished) {
        // First sighting in finished state — tally the outcome from our score.
        // BGA chess scores: 1 = win, 0 = loss, 0.5 = draw.
        const rawScore = meSeat.score;
        const score = rawScore == null ? null : Number(rawScore);
        if (score === 1) this.status.stats.wins++;
        else if (score === 0) this.status.stats.losses++;
        else if (score === 0.5) this.status.stats.draws++;
      }
      if (!m.saidGg) {
        await this.client.chat(t.id, CLOSING_CHAT).catch(() => {});
        m.saidGg = true;
      }
      m.finished = true;
      return;
    }
  }

  private async pollPendingDecision(
    tableId: string,
    gameserverNum: number,
  ): Promise<string | null> {
    if (!this.client || !this.uid) return null;
    const html = await this.client.fetchGamePage(gameserverNum, tableId);
    const i = html.indexOf("globalThis.gameui.decision");
    if (i < 0) return null;
    const tail = html.slice(i, i + 1200);
    const eq = tail.indexOf("=");
    const open = tail.indexOf("{", eq);
    if (open < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let k = open; k < tail.length; k++) {
      const ch = tail[k];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const obj = JSON.parse(tail.slice(open, k + 1));
            if (obj?.decision_taken || obj?.decision_refused) return null;
            const ans = obj?.players?.[this.uid];
            if (ans !== "undecided") return null;
            return String(obj.decision_type ?? "");
          } catch { return null; }
        }
      }
    }
    return null;
  }

  private async pollAndReplyChat(tableId: string, m: TableMemo): Promise<void> {
    if (!this.client || !this.uid) return;
    const history = await this.client.chatHistory(tableId);
    if (history.length === 0) { m.chatSeeded = true; return; }
    const maxId = history.reduce((acc, h) => {
      const n = h.id == null ? 0 : Number(h.id);
      return Number.isFinite(n) && n > acc ? n : acc;
    }, 0);
    if (!m.chatSeeded) { m.lastSeenChatId = maxId; m.chatSeeded = true; return; }
    const fresh = history
      .filter((h) => h.id != null && Number(h.id) > m.lastSeenChatId)
      .filter((h) => h.sender && h.sender !== this.uid)
      .filter((h) => h.type == null || h.type === "tablechat" || h.type === "chat");
    for (const _ of fresh) {
      try { await this.client.chat(tableId, CHAT_REPLY); }
      catch { return; /* don't advance cursor */ }
    }
    m.lastSeenChatId = maxId;
  }

  private async maybePlayMove(tableId: string, m: TableMemo): Promise<void> {
    if (!this.client || m.gameserver == null) return;
    const html = await this.client.fetchGamePage(m.gameserver, tableId);
    const parsed = parseGameHtml(html);
    if (!parsed) return;
    // Only act if BGA's active_player matches our uid; covers the race
    // where current_player_nbr changed but we already moved this turn.
    if (parsed.activePlayer && this.uid && String(parsed.activePlayer) !== String(this.uid)) return;
    if (Object.keys(parsed.destinationsByPiece).length === 0) return;

    // What color are we? Find any piece with our uid? Actually pieces don't
    // carry the player id directly; we know which color we are because BGA
    // assigns table_order=1 to creator (white) and 2 to opponent (black).
    // But simpler: pick the color of the only piece in destinations_by_piece.
    const firstPid = Object.keys(parsed.destinationsByPiece)[0];
    const firstPiece = parsed.pieces[firstPid];
    const ourColor: "white" | "black" = firstPiece?.piece_color ?? "white";
    const fen = buildFen(parsed.pieces, ourColor);

    let chosen: { pieceId: string; dest: Destination } | null = null;
    let engineSource = "unknown";
    try {
      const result = await this.askEngine(fen);
      if (result?.move) {
        chosen = lookupUciMove(result.move, parsed.pieces, parsed.destinationsByPiece);
        if (chosen) engineSource = result.engine;
      }
    } catch (e) {
      this.recordError("engine", e, tableId);
    }
    if (!chosen) {
      chosen = anyLegalMove(parsed.pieces, parsed.destinationsByPiece);
      if (chosen) engineSource = "random-fallback";
    }
    if (!chosen) return;

    const fromPiece = parsed.pieces[chosen.pieceId];
    const fromSq = fromPiece ? xyToSq(Number(fromPiece.piece_x), Number(fromPiece.piece_y)) : "??";
    const toSq = xyToSq(chosen.dest.dest_x, chosen.dest.dest_y);
    this.recordMove(tableId, fromSq, toSq, engineSource);
    console.log(`t=${tableId} move ${fromSq}→${toSq} engine=${engineSource}`);
    await this.client.selectCell(m.gameserver, tableId, chosen.dest.dest_x, chosen.dest.dest_y, chosen.pieceId);
    await this.client.wakeup(m.gameserver, tableId).catch(() => {});
  }

  private async askEngine(fen: string): Promise<{ move: string; engine: string } | null> {
    // Hit our own engine via service binding — same Worker, so just call
    // the Stockfish DO directly through env.ENGINE.
    const id = this.env.ENGINE.idFromName(`bot:${this.uid ?? "anon"}`);
    const stub = this.env.ENGINE.get(id);
    const resp = await stub.fetch("https://do/bestmove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fen, depth: ENGINE_DEPTH, movetime: ENGINE_MOVETIME_MS }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { move?: string; engine?: string };
    if (!json.move) return null;
    return { move: json.move, engine: json.engine ?? "unknown" };
  }
}
