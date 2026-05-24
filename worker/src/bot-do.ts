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
import { enginePrecedenceRank } from "./stockfish-do";

const TICK_MS = 5_000;
const OPENING_CHAT = "I am a nerfed version of stockfish, https://stockfishchess.org/ . I'm a work in progress and could be buggy. Good luck!";
const CLOSING_CHAT = "Good Game!";
const RANDOM_FALLBACK_CHAT = "Engine lookup failed - choosing random valid move.";
const CHAT_REPLY = "I'm not sure.";
const CONCEDE_CHAT = "I'm hitting too many errors playing this game and need to concede. Sorry!";
const OPPONENT_TIMEOUT_CHAT = "You've been on your turn for over 15 minutes without moving. I can only play one realtime game at a time, so I'm conceding so my next opponent can play. If you want to take your time, please play me asynchronously instead (start an async game against the bot).";
/** Sent when BGA has already marked the opponent zombie / neutralized
 *  (i.e. they bailed and BGA flipped the forfeit flag). We concede so
 *  the realtime slot doesn't sit pinned on a dead table, even though
 *  BGA would technically award us the win on its own clock. */
const OPP_QUIT_CHAT = "Looks like my opponent left the game. Conceding so the realtime slot frees up for the next player.";
/** Concede a realtime game once the opponent has been on their turn for
 *  this long (wall-clock, not BGA's chess clock). BGA "friendly" games
 *  often grant absurd starting clocks (~90 days), so the chess-clock
 *  value never approaches zero — wall-clock is the only signal that
 *  catches an opponent who closed their tab mid-game. 15 min is generous
 *  for a slow human but always trips a ghoster. */
const OPPONENT_INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
/** Force-clear awaitingOppMove after this long. Guards against the case
 *  where the opponent replies in between two of our 5s ticks: we never
 *  observe activePlayer=opp, so the original "clear when ourTurn flips"
 *  rule never fires and the bot stays pinned in "opp to move". BGA's
 *  table HTML lag after our selectCell is usually under 5s, so 10s
 *  comfortably brackets it without bleeding into the opponent's reply
 *  window on a slow tick. */
const AWAITING_OPP_TTL_MS = 10 * 1000;
/** Concede async games that have been alive (status play/asyncplay) longer
 *  than this. Async friendly chess on BGA has effectively unbounded clocks,
 *  so a forgotten game lives in the bot's "in progress" list forever and
 *  occupies a slot for new opponents. 30 days is generous for any real
 *  back-and-forth but always sweeps abandoned month-old turns. */
const MAX_TABLE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const OLD_GAME_CONCEDE_CHAT = "This game has been going for over a month. Conceding to free up the slot for a new game — feel free to start another any time.";
const ENGINE_DEPTH = 14;
const ENGINE_MOVETIME_MS = 4_000;
/** Don't retry createnew more often than this when BGA rejects it. */
const OPEN_INVITE_RETRY_MS = 60_000;
/** Tolerate the BGA indexing delay before declaring a freshly-created
 *  open invite gone. Without this grace, a tick that races ahead of
 *  tableinfos clears openInviteId and a duplicate table gets created. */
const OPEN_INVITE_GRACE_MS = 45_000;
/** A realtime table briefly reports `setup` after createTable while BGA
 *  promotes it to `open`. Normally that takes 2-3 ticks. If it's still
 *  in init/setup this long, the opponent never clicked through (or BGA
 *  wedged the table). Leave it and let the next tick recreate so the
 *  slot doesn't sit dead. */
const OPEN_INVITE_SETUP_TIMEOUT_MS = 15 * 60 * 1000;
/** Concede a game after this many consecutive errors on a single table. */
const MAX_TABLE_ERRORS = 3;
/** Consecutive reconcile-by-id misses before we mark a stale active-game
 *  memo as finished. Tolerates short BGA transient blips while still
 *  cleaning up memos for tables that genuinely vanished (opponent
 *  rage-quit + BGA archived). At 5s ticks this is roughly 15 seconds. */
const RECONCILE_MISS_LIMIT = 3;
/** Cap on the rolling error log size kept in BotStatus. */
const RECENT_ERRORS_CAP = 100;
/** Cap on the rolling moves log size kept in BotStatus (across all tables). */
const RECENT_MOVES_CAP = 500;
/** Cap on the rolling game-results log. One entry per finished/archive
 *  tally so we can audit which raw score BGA reported per game without
 *  spelunking the GC'd memo. Used to diagnose "draws stayed 0" bugs. */
const RECENT_RESULTS_CAP = 500;
/** DO storage key prefix for the engine-move cache. One key per FEN; value
 *  is the UCI move and the engine that produced it. Keyed on the FEN built
 *  by buildFen(), which is deterministic for a given position (halfmove
 *  and fullmove are zeroed), so identical positions across games collide. */
const MOVE_CACHE_PREFIX = "mc:";
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
  /** Sent the "engine lookup failed" chat on this table. Gated to fire
   *  once per game so a sustained engine outage doesn't spam chat every
   *  move. */
  saidRandomFallback?: boolean;
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
  /** Consecutive ticks where the per-id reconcile lookup returned null
   *  (BGA can't find the table anymore). Reset to 0 whenever the table
   *  reappears. Used to GC memos that linger forever after a table
   *  silently vanishes (e.g. opponent rage-quit + bot's `finished`
   *  poll missed the snapshot). See RECONCILE_MISS_LIMIT. */
  reconcileMissCount?: number;
  /** Wall-clock ms of the first tick where we observed it to be the
   *  opponent's turn (since their last move, or since we sat down).
   *  Cleared whenever it flips back to our turn. Used to detect
   *  ghosting on realtime tables — see OPPONENT_INACTIVITY_LIMIT_MS. */
  opponentTurnSince?: number | null;
  /** Wall-clock ms we first created the memo for this table (i.e. first
   *  tick where we saw it). Used for "started" column in the dashboard. */
  startedAt?: number;
  /** Wall-clock ms we marked the table finished. Set wherever
   *  `finished = true` is set. */
  finishedAt?: number;
  /** Raw BGA score we tallied for this table at finish time. 1=win,
   *  0=loss, 0.5=draw, null when BGA didn't report a score. Persisted on
   *  the memo so the dashboard can show what was actually credited; gives
   *  a paper trail for "the bot said GG but draws stayed 0" bugs without
   *  re-probing tableinfos by hand. The string-typed `raw` field captures
   *  BGA's verbatim string (sometimes `""` for neutralized friendlies) so
   *  we can distinguish "no score" from "score=0" when triaging. */
  finishedScore?: { raw: string | null; parsed: number | null } | null;
  /** FEN of the position the bot saw on its last turn here. Powers the
   *  dashboard's gallery view; only refreshed when it's the bot's turn
   *  (we don't fetch the page on the opponent's turn), so during their
   *  thinking time it shows the post-our-move snapshot. */
  lastBoardFen?: string;
  /** Engine verdict for `lastBoardFen`. `cp` is in pawns from the
   *  side-to-move's perspective (so positive = bot winning at the time
   *  it asked). Persists across cache hits because CachedMove also
   *  carries cp/mate. */
  lastEval?: { cp?: number; mate?: number | null; engine: string; ts: number };
  /** "bot" if it's the bot's turn at lastBoardFen, "opp" if waiting on
   *  the opponent. Powers the gallery's whose-turn indicator. */
  lastTurn?: "bot" | "opp";
  /** Which color the bot plays at this table. Captured the first tick
   *  we observe it (when destinations_by_piece is populated) and reused
   *  thereafter so we can render a correct side-to-move during the
   *  opponent's turn. */
  botColor?: "white" | "black";
  /** Display name of the opponent (BGA player fullname). Captured the
   *  first tick we see them seated, used in the dashboard's turn chip. */
  oppName?: string;
  /** BGA's reflexion clock in seconds, last observation. Per side. */
  botClock?: number | null;
  oppClock?: number | null;
  /** First non-null clock reading we observed for each side, used as the
   *  baseline for "time spent" in the dashboard (start − current).
   *  Async friendly chess clocks start at ~90&nbsp;days, so the raw
   *  remaining value is essentially constant noise; spent time is the
   *  useful signal. Captured per-side because BGA can stagger the first
   *  observation across the two players. */
  botClockStart?: number | null;
  oppClockStart?: number | null;
  /** Bot's most recent move on this table (UCI squares). Used to paint
   *  from/to highlights on the gallery board. */
  lastMoveFrom?: string;
  lastMoveTo?: string;
  /** Previous tick's pieces dict, used to detect the opponent's last move
   *  by diff (BGA doesn't expose a clean "last move" field on the table
   *  HTML; comparing piece positions across consecutive observations is
   *  the reliable way to learn what they played). Refreshed every tick
   *  the page parses. */
  lastPieces?: Record<string, { piece_color: string; piece_type: string; piece_x: string | number; piece_y: string | number; piece_captured?: string }>;
  /** Set true right after a successful selectCell, cleared the first tick
   *  we observe activePlayer != us. BGA's HTML lags a few seconds behind a
   *  successful move — the page still shows our turn for that window, and
   *  a follow-up tick would re-fire selectCell and 901 "not your turn".
   *  Gating on this flag closes that window without depending on
   *  gamestate.id (which stays at 3 "play" across every move in chess and
   *  so can't be used as a per-turn signal). */
  awaitingOppMove?: boolean;
  /** Wall-clock ms when awaitingOppMove was last set true. Used to
   *  force-clear the flag after AWAITING_OPP_TTL_MS so a fast opponent
   *  reply that lands between two ticks (where we never observe
   *  activePlayer=opp) doesn't pin the bot in "opp to move" forever. */
  awaitingOppSince?: number | null;
  /** Telemetry: last time maybePlayMove ran for this table and what
   *  happened. Lets you diagnose "bot stuck on its turn" without spelunking
   *  through Worker logs — `result` records which early-return branch
   *  fired. Reset to null on concede / finish. */
  lastMoveAttempt?: {
    ts: number;
    /** "played" if we sent selectCell, otherwise the reason we bailed. */
    result:
      | "played"
      | "promoted"
      | "no-parse"
      | "opp-turn"
      | "no-dests"
      | "no-engine-move"
      | "no-fallback-move"
      | "select-cell-failed"
      | "promote-failed"
      | "no-gameserver"
      | "accepted-abandon"
      | "opp-quit-conceded";
    /** Only set for failure cases that carry an error message. */
    err?: string;
    /** activePlayer parsed from the page on this attempt; helps spot the
     *  "BGA says it's our turn but we still bail" case. */
    activePlayer?: string | null;
  };
}

interface CachedMove {
  /** UCI move (e.g. "e2e4", "e7e8q"). */
  move: string;
  /** Originating engine name (e.g. "chess-api.com"). Preserved so dashboards
   *  can show provenance via engineSource=`cache:${engine}`. */
  engine: string;
  /** Centipawn eval / mate, both from the originating engine. Stored so a
   *  cache hit can restore the per-table eval display without re-racing. */
  cp?: number;
  mate?: number | null;
  ts: number;
}

interface ErrorEntry {
  ts: number;
  scope: string;
  msg: string;
  tableId?: string;
}

interface EngineAltEntry {
  engine: string;
  /** UCI string the engine returned, or "" if it failed. */
  move: string;
  ms: number;
  eval?: number;
  mate?: number | null;
  depth?: number;
  error?: string;
}

interface MoveEntry {
  ts: number;
  tableId: string;
  from: string;
  to: string;
  engine: string;
  /** Every engine's outcome from the parallel race. Includes the chosen
   *  engine and any losers/errors. Lets the dashboard show all picks. */
  engineResults?: EngineAltEntry[];
  /** Which color the bot was playing on this table. */
  botColor?: "white" | "black";
  /** Opponent display name at the moment we played, if known. */
  oppName?: string;
  /** Centipawns from the bot's POV (positive = bot ahead). Sourced from
   *  the winning engine's alternative entry, or the cache record on a
   *  cache hit. */
  cp?: number;
  /** Mate distance in plies (positive = bot mates, negative = bot is
   *  mated). null when the engine reported no mate; undefined when
   *  unknown. */
  mate?: number | null;
  /** Wall-clock ms spent producing this move. For an engine race, the
   *  winning engine's `ms`. Undefined on cache hits (no engine ran). */
  thinkMs?: number;
  /** Was the chosen move a capture? Derived at record time from the
   *  pre-move pieces map. */
  captured?: boolean;
  /** Piece type that moved ("pawn" / "knight" / "bishop" / "rook" /
   *  "queen" / "king"). Useful for analytics + UI. */
  pieceType?: string;
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

/** Which condition triggered an automatic concede. See concedeTable
 *  call sites for the trigger logic of each. Used as a console.log tag
 *  only — concedes are intentionally not surfaced on the dashboard
 *  Results table (they're mostly error/cancellation states, not real
 *  game outcomes). */
type ConcedeReason =
  | "errors"             // MAX_TABLE_ERRORS consecutive failures
  | "tableAge"           // game alive > MAX_TABLE_AGE_MS
  | "lostSeat"           // BGA evicted bot from its own live table
  | "oppQuit"            // realtime opponent flagged zombie/neutralized
  | "opponentInactivity"; // realtime opponent ghosted > OPPONENT_INACTIVITY_LIMIT_MS

interface ResultEntry {
  ts: number;
  tableId: string;
  /** "finished", "asyncfinished", or "archive" — which terminal status
   *  triggered the tally. */
  status: string;
  /** Raw `players[uid].score` value BGA returned (verbatim string). null
   *  when BGA didn't expose a score field on meSeat. */
  rawScore: string | null;
  /** Numeric parse of rawScore. 1=win, 0=loss, 0.5=draw, null when raw
   *  was null or non-numeric. */
  parsedScore: number | null;
  /** Which counter we incremented: "win" / "loss" / "draw" / "none". */
  tally: "win" | "loss" | "draw" | "none";
  /** Opponent's raw score at finalization. Captured to disambiguate the
   *  BGA-friendly draw quirk (some draws come back as 0/0 instead of
   *  0.5/0.5); kept on the record so retroactive triage doesn't need to
   *  re-fetch tableinfos. Older entries written before this field was
   *  added will be undefined. */
  oppRawScore?: string | null;
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
  /** Rolling log of game results (one entry per finished tally). Persists
   *  past memo GC so we can audit how BGA scored each game. */
  recentResults?: ResultEntry[];
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
    recentErrors: [], recentMoves: [], recentResults: [],
    stats: { wins: 0, losses: 0, draws: 0, concedes: 0, engineUses: {} },
    tables: {},
    openInvites: { realtime: emptyInvite(), async: emptyInvite() },
    consecutiveTickFailures: 0,
    nextTickEarliest: null,
  };
  private booted = false;
  /** Re-entrancy guard for tick(). DO fetch handlers run concurrently, so
   *  the 1-min cron's POST /tick can overlap an in-flight alarm-driven tick.
   *  Two ticks both seeing "our turn" and racing selectCell is one of the
   *  causes of 901 "It is not your turn" rejections. */
  private tickInFlight = false;

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
    if (url.pathname === "/inspect") {
      await this.boot();
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "missing id" }, { status: 400 });
      const memo = this.status.tables[id];
      if (!this.client || !memo?.gameserver) {
        return Response.json({ error: "no client or gameserver", memo });
      }
      try { await this.client.login(); } catch (e) {
        return Response.json({ error: "login failed: " + String(e).slice(0, 200) });
      }
      const html = await this.client.fetchGamePage(memo.gameserver, id);
      const parsed = parseGameHtml(html);
      return Response.json({
        id,
        memo,
        htmlLen: html.length,
        hasReflexionMarker: html.includes('"reflexion":'),
        reflexionSnippet: (() => {
          const i = html.indexOf('"reflexion":');
          return i >= 0 ? html.slice(i, i + 200) : null;
        })(),
        activePlayer: parsed?.activePlayer ?? null,
        reflexion: parsed?.reflexion ?? null,
        destCount: parsed ? Object.keys(parsed.destinationsByPiece).length : -1,
      });
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
    if (url.pathname === "/fix-result") {
      await this.boot();
      const id = url.searchParams.get("id");
      const next = url.searchParams.get("tally") as ResultEntry["tally"] | null;
      const valid: ResultEntry["tally"][] = ["win", "loss", "draw", "none"];
      if (!id || !next || !valid.includes(next)) {
        return Response.json(
          { error: "usage: /fix-result?id=<tableId>&tally=win|loss|draw|none" },
          { status: 400 },
        );
      }
      const result = await this.fixResult(id, next);
      return Response.json(result);
    }
    if (url.pathname === "/reconcile-results") {
      await this.boot();
      const apply = url.searchParams.get("apply") === "1";
      const result = await this.reconcileResults(apply);
      return Response.json(result);
    }
    if (url.pathname === "/resync-stats") {
      await this.boot();
      const apply = url.searchParams.get("apply") === "1";
      const result = await this.resyncStats(apply);
      return Response.json(result);
    }
    if (url.pathname === "/resync-engine-uses") {
      await this.boot();
      const apply = url.searchParams.get("apply") === "1";
      const since = url.searchParams.get("since"); // ISO date string
      const result = await this.resyncEngineUses(since, apply);
      return Response.json(result);
    }
    return new Response("not found", { status: 404 });
  }

  /** Recompute `stats.engineUses` by tallying entries from `recentMoves`
   *  with ts >= `since` (default: 2026-05-20). Used to drop pre-cutoff
   *  noise from the engine-usage pie chart. Note: recentMoves is capped
   *  at RECENT_MOVES_CAP, so the result is only as deep as the retained
   *  log. Dry-run by default; pass ?apply=1 to commit. */
  private async resyncEngineUses(
    sinceRaw: string | null,
    apply: boolean,
  ): Promise<{
    apply: boolean;
    sinceIso: string;
    movesConsidered: number;
    movesCounted: number;
    before: Record<string, number>;
    after: Record<string, number>;
  }> {
    const sinceDate = sinceRaw ? new Date(sinceRaw) : new Date("2026-05-20T00:00:00Z");
    const sinceMs = sinceDate.getTime();
    const moves = this.status.recentMoves || [];
    const counts: Record<string, number> = {};
    let counted = 0;
    for (const mv of moves) {
      if (mv.ts < sinceMs) continue;
      counted++;
      counts[mv.engine] = (counts[mv.engine] ?? 0) + 1;
    }
    const before = { ...this.status.stats.engineUses };
    if (apply) {
      this.status.stats.engineUses = counts;
      await this.ctx.storage.put("stats", this.status.stats);
      console.log(
        `bot:resyncEngineUses since=${sinceDate.toISOString()} ` +
        `counted=${counted} engines=${Object.keys(counts).length}`,
      );
    }
    return {
      apply,
      sinceIso: sinceDate.toISOString(),
      movesConsidered: moves.length,
      movesCounted: counted,
      before,
      after: counts,
    };
  }

  /** Recompute lifetime wins/losses/draws (and zero concedes) from the
   *  persisted recentResults log so the dashboard's top-line counters
   *  match the rows it can actually display. Useful when stats drift
   *  ahead of the visible log — e.g. after early-bot runs that incremented
   *  counters before recentResults logging existed, or when entries roll
   *  off the cap. Dry-run by default; pass ?apply=1 to commit. */
  private async resyncStats(
    apply: boolean,
  ): Promise<{
    apply: boolean;
    before: BotStats;
    after: BotStats;
    counted: number;
  }> {
    const results = this.status.recentResults || [];
    const tallies = { wins: 0, losses: 0, draws: 0 };
    for (const r of results) {
      if (r.tally === "win") tallies.wins++;
      else if (r.tally === "loss") tallies.losses++;
      else if (r.tally === "draw") tallies.draws++;
    }
    const before: BotStats = {
      wins: this.status.stats.wins,
      losses: this.status.stats.losses,
      draws: this.status.stats.draws,
      concedes: this.status.stats.concedes,
      engineUses: { ...this.status.stats.engineUses },
    };
    const after: BotStats = {
      ...before,
      wins: tallies.wins,
      losses: tallies.losses,
      draws: tallies.draws,
      // Concedes are not surfaced in the dashboard and are not in
      // recentResults, so zero them here to honor the "stats == visible
      // data" intent.
      concedes: 0,
    };
    if (apply) {
      this.status.stats = after;
      await this.ctx.storage.put("stats", this.status.stats);
      console.log(
        `bot:resyncStats wins ${before.wins}->${after.wins} ` +
        `losses ${before.losses}->${after.losses} ` +
        `draws ${before.draws}->${after.draws} ` +
        `concedes ${before.concedes}->${after.concedes}`,
      );
    }
    return { apply, before, after, counted: results.length };
  }

  /** Walk recentResults for loss entries with rawScore=0 and re-fetch BGA
   *  tableinfos to learn the opponent's score. BGA-friendly chess sometimes
   *  reports draws as 0/0 instead of 0.5/0.5, so any "loss" where the
   *  opponent also scored 0 was actually a draw. Dry-run by default —
   *  pass ?apply=1 to flip the tallies and rebalance counters. */
  private async reconcileResults(
    apply: boolean,
  ): Promise<{
    apply: boolean;
    inspected: number;
    candidates: Array<{
      tableId: string;
      ts: number;
      currentTally: string;
      oppRawScore: string | null;
      recommendation: "draw" | "loss" | "skip";
      note?: string;
    }>;
    applied: number;
    stats?: BotStats;
    error?: string;
  }> {
    const results = this.status.recentResults || [];
    if (!this.client) return { apply, inspected: 0, candidates: [], applied: 0, error: "no client" };
    try { await this.client.login(); }
    catch (e) { return { apply, inspected: 0, candidates: [], applied: 0, error: `login: ${String(e).slice(0, 200)}` }; }

    const candidates: Array<{
      tableId: string; ts: number; currentTally: string;
      oppRawScore: string | null;
      recommendation: "draw" | "loss" | "skip"; note?: string;
    }> = [];
    let inspected = 0;
    for (const r of results) {
      if (r.tally !== "loss") continue;
      const ours = r.rawScore == null ? null : Number(r.rawScore);
      if (ours !== 0) continue;
      inspected++;
      // If we already captured oppRawScore on the entry (post-fix entries),
      // trust it — no need to round-trip to BGA.
      let oppRaw: string | null = r.oppRawScore ?? null;
      if (oppRaw == null) {
        const ti = await this.client.getTableInfo(r.tableId).catch(() => null);
        if (!ti) {
          candidates.push({
            tableId: r.tableId, ts: r.ts, currentTally: r.tally,
            oppRawScore: null, recommendation: "skip",
            note: "tableinfos fetch returned null",
          });
          continue;
        }
        const seats = ti.players ?? {};
        for (const [pid, seat] of Object.entries(seats)) {
          if (pid === this.uid) continue;
          if (seat.score != null) { oppRaw = String(seat.score); break; }
        }
      }
      const oppScore = oppRaw == null ? null : Number(oppRaw);
      let recommendation: "draw" | "loss" | "skip" = "skip";
      let note: string | undefined;
      if (oppScore === 0) recommendation = "draw";
      else if (oppScore === 1) { recommendation = "loss"; note = "true loss (opp scored 1)"; }
      else { note = `unrecognized opp score ${oppRaw ?? "null"}`; }
      candidates.push({
        tableId: r.tableId, ts: r.ts, currentTally: r.tally,
        oppRawScore: oppRaw, recommendation, note,
      });
    }

    let applied = 0;
    if (apply) {
      for (const c of candidates) {
        if (c.recommendation !== "draw") continue;
        const fix = await this.fixResult(c.tableId, "draw");
        if (fix.ok && fix.after?.tally === "draw") applied++;
      }
      // Also persist oppRawScore back onto the entries we inspected, so a
      // re-run doesn't have to round-trip BGA again.
      const updated = this.status.recentResults || [];
      for (const c of candidates) {
        const idx = updated.findIndex((r) => r.tableId === c.tableId);
        if (idx >= 0 && updated[idx].oppRawScore == null && c.oppRawScore != null) {
          updated[idx] = { ...updated[idx], oppRawScore: c.oppRawScore };
        }
      }
      await this.ctx.storage.put("recentResults", updated);
    }

    return {
      apply, inspected, candidates, applied,
      stats: apply ? this.status.stats : undefined,
    };
  }

  /** Retro-patch a single recentResults entry: flip its `tally` and
   *  rebalance the lifetime counters. Used when BGA reports a quirky
   *  score that the live scorer mis-classified (e.g. friendly-game
   *  draws coming back as 0/0). Idempotent: re-applying with the same
   *  tally is a no-op. */
  private async fixResult(
    tableId: string, next: ResultEntry["tally"],
  ): Promise<{ ok: boolean; before?: ResultEntry; after?: ResultEntry; stats?: BotStats; error?: string }> {
    const results = this.status.recentResults || [];
    const idx = results.findIndex((r) => r.tableId === tableId);
    if (idx < 0) return { ok: false, error: `no recentResults entry for table ${tableId}` };
    const prev = results[idx];
    if (prev.tally === next) {
      return { ok: true, before: prev, after: prev, stats: this.status.stats };
    }
    const dec = (k: keyof BotStats) => {
      const v = this.status.stats[k];
      if (typeof v === "number" && v > 0) (this.status.stats as any)[k] = v - 1;
    };
    if (prev.tally === "win") dec("wins");
    else if (prev.tally === "loss") dec("losses");
    else if (prev.tally === "draw") dec("draws");
    if (next === "win") this.status.stats.wins++;
    else if (next === "loss") this.status.stats.losses++;
    else if (next === "draw") this.status.stats.draws++;
    const after: ResultEntry = { ...prev, tally: next };
    results[idx] = after;
    await this.ctx.storage.put("recentResults", results);
    await this.ctx.storage.put("stats", this.status.stats);
    console.log(`bot:fixResult t=${tableId} ${prev.tally} -> ${next}`);
    return { ok: true, before: prev, after, stats: this.status.stats };
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

  private recordMove(entry: Omit<MoveEntry, "ts">): void {
    const full: MoveEntry = { ts: Date.now(), ...entry };
    this.status.recentMoves.push(full);
    if (this.status.recentMoves.length > RECENT_MOVES_CAP) {
      this.status.recentMoves.splice(0, this.status.recentMoves.length - RECENT_MOVES_CAP);
    }
    this.status.stats.engineUses[full.engine] = (this.status.stats.engineUses[full.engine] ?? 0) + 1;
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
    // Fold the legacy "fallback-random" counter into "random-fallback".
    // Earlier versions of stockfish-do.ts used the inverted name; the
    // historical counts are still in persisted stats. One-time merge so
    // the dashboard shows a single row.
    const legacyRandom = this.status.stats.engineUses["fallback-random"];
    if (legacyRandom) {
      this.status.stats.engineUses["random-fallback"] =
        (this.status.stats.engineUses["random-fallback"] ?? 0) + legacyRandom;
      delete this.status.stats.engineUses["fallback-random"];
      await storage.put("stats", this.status.stats);
    }
    this.status.recentErrors =
      (await storage.get<ErrorEntry[]>("recentErrors")) ?? [];
    this.status.recentMoves =
      (await storage.get<MoveEntry[]>("recentMoves")) ?? [];
    this.status.recentResults =
      (await storage.get<ResultEntry[]>("recentResults")) ?? [];
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
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      await this.tickInner();
    } finally {
      this.tickInFlight = false;
    }
  }

  private async tickInner(): Promise<void> {
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

    // Reconcile in-flight tables that fell off the lobby snapshots.
    // myTables() polls status=open/asyncopen (plus the recently-finished
    // global list). Tables in status=setup or status=play don't appear in
    // any of those, so once the bot has joined a seat (acceptedSeat) it
    // will never see that table again from the snapshot alone. That gap
    // breaks three lifecycle transitions:
    //   - rematch invites: bot acks start but never observes status=play,
    //     so gameserver/saidHi never resolve and the bot doesn't move
    //   - mid-game state: same handleTable branch must run every tick to
    //     poll moves; without snapshot visibility nothing fires
    //   - finished games (status=finished rolls off the global list in
    //     seconds under lobby load, missing the GG/stats branch)
    // For any memo that's joined (acceptedSeat) and not yet finished,
    // fetch the table directly by id and inject it into `tables` so
    // handleTable runs normally.
    //
    // If getTableInfo returns null for RECONCILE_MISS_LIMIT consecutive
    // ticks, the table is genuinely gone (rage-quit + BGA archived). We
    // mark it finished so the per-tick GC drops the memo. Otherwise
    // stale memos hold their tableId in BGA's "you have a game in
    // progress" view forever and block all new createTable calls.
    // Match on ANY sign the bot interacted with the table, not just
    // acceptedSeat. Older persisted memos (and a re-entrant tick where
    // ackedStart/saidHi got set before acceptedSeat flipped to true)
    // can have saidHi=true while acceptedSeat=false; a stricter
    // predicate leaves those memos permanently unreconciled and the
    // GG branch never fires for the finished game they represent.
    const seenIds = new Set(tables.map((t) => t.id));
    const missing = Object.entries(this.status.tables).filter(
      ([id, m]) =>
        (m.acceptedSeat || m.ackedStart || m.saidHi)
        && !m.finished && !m.conceded && !seenIds.has(id),
    );
    for (const [id, m] of missing) {
      const t = await this.client.getTableInfo(id).catch(() => null);
      if (t) {
        m.reconcileMissCount = 0;
        tables.push(t);
        continue;
      }
      m.reconcileMissCount = (m.reconcileMissCount ?? 0) + 1;
      if (m.reconcileMissCount >= RECONCILE_MISS_LIMIT) {
        this.recordError(
          "reconcileMiss",
          `Table ${id} missing from both myTables and getTableInfo for ${m.reconcileMissCount} ticks; marking finished`,
          id,
        );
        m.finished = true;
        m.finishedAt = Date.now();
      }
    }

    // Build the snapshot from this tick, then patch back any active-memo
    // entries that fell off (BGA reconcile-by-id can flake transiently —
    // a 404 on tableinfos.html drops the table from `tables` even though
    // the game is still live and the memo is intact). Without this carry-
    // over the dashboard briefly switches to "no live games" on every
    // such flake, producing visible discontinuity between ticks.
    const prevSeen = new Map(
      (this.status.lastTablesSeen ?? []).map((s) => [s.id, s]),
    );
    const currentIds = new Set(tables.map((t) => t.id));
    const merged = tables.map((t) => ({
      id: t.id, status: t.status, creator: t.table_creator, game_id: t.game_id,
    }));
    for (const [id, m] of Object.entries(this.status.tables)) {
      if (m.finished || m.conceded) continue;
      if (currentIds.has(id)) continue;
      const prev = prevSeen.get(id);
      if (prev) merged.push(prev);
    }
    this.status.lastTablesSeen = merged;

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
          await this.concedeTable(t.id, m, "errors").catch((ce) => {
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
    await this.ctx.storage.put("recentResults", this.status.recentResults ?? []);

    try { await this.maybeCreateOpenInvite(tables); }
    catch (e) { this.recordError("openInvite", e); }
  }

  /** Send a polite concede message and resign the table. Idempotent on the
   *  conceded flag — safe to retry, but won't double-send the chat. `reason`
   *  identifies which trigger fired and is captured in the structured
   *  console log (concedes are intentionally NOT pushed into recentResults
   *  or surfaced on the dashboard — they're mostly error/cancellation
   *  states, not real outcomes). Pass a custom chat to explain a non-error
   *  concession (e.g. opponent clock overdraft). */
  private async concedeTable(
    tableId: string,
    m: TableMemo,
    reason: ConcedeReason,
    chatMessage: string = CONCEDE_CHAT,
  ): Promise<void> {
    if (!this.client || m.conceded) return;
    await this.client.chat(tableId, chatMessage).catch(() => {});
    await this.client.resign(tableId).catch((e) => {
      this.recordError("resign", e, tableId);
    });
    const now = Date.now();
    m.conceded = true;
    m.finished = true;
    m.finishedAt = now;
    this.status.stats.concedes++;

    // Structured one-liner for `wrangler tail`. Keys are space-separated
    // `k=v` so a simple grep can pull all concedes; values are stripped of
    // spaces (opp name can contain them).
    const gameAgeMs = m.startedAt != null ? now - m.startedAt : null;
    const safeOpp = (m.oppName ?? "").replace(/\s+/g, "_") || "?";
    const lastMove = (m.lastMoveFrom && m.lastMoveTo)
      ? `${m.lastMoveFrom}-${m.lastMoveTo}` : "?";
    console.log(
      `bot:concede ts=${new Date(now).toISOString()} t=${tableId} ` +
      `reason=${reason} opp=${safeOpp} color=${m.botColor ?? "?"} ` +
      `ageMs=${gameAgeMs ?? "?"} errorCount=${m.errorCount ?? 0} ` +
      `lastMove=${lastMove}`,
    );
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
    // One advertisement per gamemode (realtime + async). Async is the
    // useful escape valve when the realtime slot is blocked by a game in
    // progress (BGA caps one realtime game per game type per account).
    const ourSlotIds = new Set<string>();
    for (const mode of GAMEMODES) {
      const id = this.status.openInvites[mode].id;
      if (id) ourSlotIds.add(id);
    }
    for (const t of myJoinable) {
      if (ourSlotIds.has(t.id)) continue;
      if (!gamemodeOf(t.status)) continue;
      await this.client.leaveTable(t.id).catch((e) => {
        this.recordError("leaveTable", e, t.id);
      });
      delete this.status.tables[t.id];
    }

    for (const mode of GAMEMODES) {
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
            // table to open/asyncopen yet. Don't neutralize too eagerly:
            // that would kill our own freshly-created table (and any
            // opponent who had just sat down). But if it's been stuck
            // this long the opponent never clicked through, so leave
            // the dead invite and fall through to recreate.
            const age = now - (slot.createdAt ?? now);
            if (age <= OPEN_INVITE_SETUP_TIMEOUT_MS) continue;
            this.recordError(
              `setupTimeout:${mode}`,
              `table stuck in ${t.status} for ${Math.round(age / 60_000)}m`,
              slot.id,
            );
            await this.client.leaveTable(slot.id).catch(() => {});
          } else {
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
          }
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
        startedAt: Date.now(),
      };
      this.status.tables[id] = m;
    } else if (m.startedAt == null) {
      // Legacy memos persisted before startedAt existed. Stamp on first
      // sight so the dashboard "Started" column stops showing —. Loses
      // true start-time fidelity for these games, but it's the best we
      // can do without a BGA-side timestamp.
      m.startedAt = Date.now();
    }
    return m;
  }

  private async handleTable(t: RawTableInfo): Promise<void> {
    if (!this.client || !this.uid) return;
    const m = this.getMemo(t.id);
    if (m.conceded) return;

    // Auto-concede games older than MAX_TABLE_AGE_MS. Only fires on live
    // play statuses so we don't resign an unstarted invite or a finished
    // game we haven't GC'd yet.
    if (
      m.startedAt
      && isLivePlayStatus(t.status)
      && Date.now() - m.startedAt > MAX_TABLE_AGE_MS
    ) {
      const days = Math.round((Date.now() - m.startedAt) / 86_400_000);
      this.recordError(
        "tableAgeLimit",
        `Table alive for ${days}d (limit ${MAX_TABLE_AGE_MS / 86_400_000}d); conceding`,
        t.id,
      );
      await this.concedeTable(t.id, m, "tableAge", OLD_GAME_CONCEDE_CHAT).catch((e) => {
        this.recordError("tableAgeConcede", e, t.id);
      });
      return;
    }

    const meSeat = t.players?.[this.uid];

    // Capture opponent display name when present. The myTables snapshot
    // populates `players[pid].fullname` for every seated player; we cache
    // it on the memo so the dashboard's turn chip can name the opponent.
    if (!m.oppName && t.players) {
      for (const [pid, seat] of Object.entries(t.players)) {
        if (pid === this.uid) continue;
        if (seat.fullname) { m.oppName = seat.fullname; break; }
      }
    }

    // Reclaim seat on a table we own but aren't seated at. This happens
    // when the realtime "Accept the game" overlay expires after only one
    // side accepted: BGA preserves the seat that did accept and silently
    // evicts the other. Without a reclaim the memo's acceptedSeat/
    // ackedStart flags stay true, the seat is empty on BGA, and every
    // subsequent tick early-returns on the missing meSeat. Only attempt
    // for joinable statuses on tables the bot created or is advertising
    // as an open invite slot.
    if (!meSeat && isJoinableStatus(t.status)) {
      const isOwn = t.table_creator === this.uid
        || Object.values(this.status.openInvites).some((s) => s.id === t.id);
      if (isOwn) {
        await this.client.joinTable(t.id).catch((e) => {
          this.recordError("reclaimSeat", e, t.id);
        });
        // Re-poll happens on the next tick; reset the local flags so the
        // accept/ack sequence runs again once BGA re-adds the seat.
        m.acceptedSeat = false;
        m.ackedStart = false;
      }
      return;
    }
    if (!meSeat) {
      // Lost-seat on a live game we own — the table is already in `play`
      // (not joinable, so the reclaim branch above didn't fire) but BGA
      // shows no seat for us. This happens after a realtime "Accept" overlay
      // expiry on a rematch: BGA keeps the table alive but evicts the
      // non-responder. Without intervention, the memo stays forever, the
      // tableId holds the "you have a game in progress" lock on BGA's
      // account view, and every subsequent createTable call fails.
      // Resign so BGA releases the lock; the memo will be GC'd on the next
      // tick once status flips to finished.
      if (isLivePlayStatus(t.status) && t.table_creator === this.uid && !m.conceded) {
        await this.concedeTable(t.id, m, "lostSeat").catch((e) => {
          this.recordError("lostSeatResign", e, t.id);
        });
      }
      return;
    }

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
      if (m.gameserver == null) {
        m.lastMoveAttempt = { ts: Date.now(), result: "no-gameserver" };
      } else if (m.acceptedAbandon) {
        m.lastMoveAttempt = { ts: Date.now(), result: "accepted-abandon" };
      } else {
        await this.maybePlayMove(t.id, m, t.status === "play");
      }
      return;
    }

    // 4. finished — say GG once + count the result. BGA rolls a played
    //    game forward through several terminal labels: `finished` /
    //    `asyncfinished` (just ended) → `archive` (older, but still in
    //    myTables). We treat all three the same when `saidHi` is true
    //    (game we actually played); for `archive` without `saidHi` the
    //    bot never played, so suppress the GG to avoid greeting tables
    //    that died in setup.
    const archivedPlayed = t.status === "archive" && m.saidHi;
    if (isFinishedStatus(t.status) || archivedPlayed) {
      if (!m.finished) {
        // First sighting in finished/archive state — tally the outcome
        // from our score. BGA chess scores: 1 = win, 0 = loss, 0.5 = draw.
        //
        // Friendly-game quirk: BGA sometimes reports a draw as score=0
        // for *both* players instead of 0.5/0.5 (observed e.g. on table
        // 854888520, which was actually a draw but came back as 0/0).
        // We disambiguate by checking the opponent's score — if both
        // are 0, it's a draw, not a loss.
        const rawScore = meSeat.score;
        const score = rawScore == null ? null : Number(rawScore);
        let oppRawScore: string | null = null;
        if (t.players) {
          for (const [pid, seat] of Object.entries(t.players)) {
            if (pid === this.uid) continue;
            if (seat.score != null) { oppRawScore = String(seat.score); break; }
          }
        }
        const oppScore = oppRawScore == null ? null : Number(oppRawScore);
        const mutualZero = score === 0 && oppScore === 0;
        let tally: ResultEntry["tally"] = "none";
        if (score === 1) { this.status.stats.wins++; tally = "win"; }
        else if (score === 0.5 || mutualZero) { this.status.stats.draws++; tally = "draw"; }
        else if (score === 0) { this.status.stats.losses++; tally = "loss"; }
        const parsed = Number.isFinite(score as number) ? (score as number) : null;
        m.finishedScore = {
          raw: rawScore == null ? null : String(rawScore),
          parsed,
        };
        const entry: ResultEntry = {
          ts: Date.now(),
          tableId: t.id,
          status: t.status,
          rawScore: rawScore == null ? null : String(rawScore),
          parsedScore: parsed,
          tally,
          oppRawScore,
        };
        if (!this.status.recentResults) this.status.recentResults = [];
        this.status.recentResults.push(entry);
        if (this.status.recentResults.length > RECENT_RESULTS_CAP) {
          this.status.recentResults.splice(
            0, this.status.recentResults.length - RECENT_RESULTS_CAP,
          );
        }
        console.log(
          `t=${t.id} finished status=${t.status} rawScore=${rawScore ?? "null"} `
          + `oppRawScore=${oppRawScore ?? "null"} `
          + `parsed=${parsed ?? "null"} tally=${tally}`,
        );
      }
      if (!m.saidGg) {
        await this.client.chat(t.id, CLOSING_CHAT).catch(() => {});
        m.saidGg = true;
      }
      m.finished = true;
      m.finishedAt = Date.now();
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

  private async maybePlayMove(
    tableId: string, m: TableMemo, isRealtime: boolean,
  ): Promise<void> {
    if (!this.client || m.gameserver == null) return;
    const html = await this.client.fetchGamePage(m.gameserver, tableId);
    const parsed = parseGameHtml(html);
    if (!parsed) {
      m.lastMoveAttempt = { ts: Date.now(), result: "no-parse" };
      return;
    }

    // Opponent quit detection. BGA flips `zombie: 1` on the seat and/or
    // sets `neutralized_player_id` to the bailed player's id once it has
    // decided they've forfeited (typically: closed tab + missed enough
    // turns for BGA's auto-pass to kick in). Per user policy we concede
    // here rather than ride out the zombie-pass — frees the realtime
    // slot, avoids hanging on any state BGA's auto-progression can't
    // resolve (e.g. our own pawn waiting to be promoted while the opp is
    // dead). Fires regardless of whose turn it is. Realtime only — async
    // tables have 90-day clocks and a zombie there is just a slow human.
    if (isRealtime && this.uid) {
      let oppQuit = false;
      if (parsed.neutralizedPlayerId && parsed.neutralizedPlayerId !== this.uid) {
        oppQuit = true;
      } else if (parsed.zombieByPlayer) {
        for (const [pid, z] of Object.entries(parsed.zombieByPlayer)) {
          if (pid !== this.uid && Number(z) === 1) { oppQuit = true; break; }
        }
      }
      if (oppQuit && !m.conceded) {
        this.recordError("oppQuit", "opponent zombie/neutralized; conceding", tableId);
        m.lastMoveAttempt = {
          ts: Date.now(), result: "opp-quit-conceded", activePlayer: parsed.activePlayer,
        };
        await this.concedeTable(tableId, m, "oppQuit", OPP_QUIT_CHAT).catch((e) => {
          this.recordError("oppQuitConcede", e, tableId);
        });
        return;
      }
    }

    // Opponent inactivity check (realtime only). BGA "friendly" chess
    // games often grant ~90-day starting clocks, so the chess-clock
    // value never approaches zero on a ghosted opponent. Track wall-clock
    // time on their turn instead: first tick we see it's their turn we
    // stamp opponentTurnSince, then concede if it persists past
    // OPPONENT_INACTIVITY_LIMIT_MS. Cleared whenever it flips back to us.
    const ourTurn = !parsed.activePlayer
      || !this.uid
      || String(parsed.activePlayer) === String(this.uid);

    // Per-tick gallery snapshot. Runs on every successful parse — even
    // during opp's turn — so the dashboard board, turn indicator, and
    // clocks all stay live without an extra fetch. While awaitingOppMove
    // is true, bot has already moved this turn but BGA's HTML may still
    // echo activePlayer=us (lag), so report "opp" to match reality.
    // TTL on awaitingOppMove: if the lag window is well past and we still
    // see ourTurn=true, opp must have already played in a gap between
    // ticks; clear the flag so the gallery and play loop unstick. A null
    // awaitingOppSince means the flag was set by a code version before
    // TTL tracking existed — treat that as already expired so legacy
    // memos can't stay pinned forever.
    if (m.awaitingOppMove && ourTurn) {
      const since = m.awaitingOppSince ?? 0;
      if (Date.now() - since >= AWAITING_OPP_TTL_MS) {
        m.awaitingOppMove = false;
        m.awaitingOppSince = null;
      }
    }
    m.lastTurn = (ourTurn && !m.awaitingOppMove) ? "bot" : "opp";

    // Opponent last-move detection. Compare this tick's pieces against
    // the previous snapshot; any uncaptured piece whose square changed
    // is the side that just moved. For castling (king + rook both move)
    // prefer the king. Skip when the move we'd detect is already the
    // one we just played ourselves (avoids overwriting bot's lastMove
    // mid-lag with a stale diff).
    if (m.lastPieces) {
      const moved: Array<{ pid: string; from: string; to: string; type: string }> = [];
      for (const [pid, c] of Object.entries(parsed.pieces)) {
        const p = m.lastPieces[pid];
        if (!p) continue;
        if (c.piece_captured === "1") continue;
        const cx = Number(c.piece_x), cy = Number(c.piece_y);
        const px = Number(p.piece_x), py = Number(p.piece_y);
        if (cx !== px || cy !== py) {
          moved.push({
            pid,
            from: xyToSq(px, py),
            to: xyToSq(cx, cy),
            type: c.piece_type,
          });
        }
      }
      const pick = moved.find((mv) => mv.type === "king") ?? moved[0];
      if (pick && (pick.from !== m.lastMoveFrom || pick.to !== m.lastMoveTo)) {
        m.lastMoveFrom = pick.from;
        m.lastMoveTo = pick.to;
      }
    }
    m.lastPieces = parsed.pieces;
    if (parsed.reflexion && this.uid) {
      m.botClock = parsed.reflexion[this.uid] ?? null;
      const otherPid = Object.keys(parsed.reflexion).find((k) => k !== this.uid);
      m.oppClock = otherPid ? (parsed.reflexion[otherPid] ?? null) : null;
      // Latch the highest clock we've seen on each side as the start
      // baseline. Higher wins so a tick that catches the clock mid-think
      // doesn't lock in a too-low baseline; for stable async clocks this
      // converges to BGA's initial reflexion within one observation.
      if (m.botClock != null && (m.botClockStart == null || m.botClock > m.botClockStart)) {
        m.botClockStart = m.botClock;
      }
      if (m.oppClock != null && (m.oppClockStart == null || m.oppClock > m.oppClockStart)) {
        m.oppClockStart = m.oppClock;
      }
    }
    // Pick a side-to-move for the display FEN. Once botColor is known we
    // can always say whose move it is; before then we'll guess "white"
    // and self-correct on the next ourTurn tick.
    const stmColor: "white" | "black" = ourTurn
      ? (m.botColor ?? "white")
      : (m.botColor === "white" ? "black" : (m.botColor === "black" ? "white" : "white"));
    // buildFen's castling field is wrong when destinations_by_piece is
    // empty (opp's turn), but the gallery only reads the placement and
    // side-to-move from this string, so it's fine.
    m.lastBoardFen = buildFen(parsed.pieces, stmColor, parsed.destinationsByPiece);
    if (!ourTurn) {
      // Opponent has the turn — BGA has acknowledged our previous move,
      // so the post-move HTML-lag window is closed.
      m.awaitingOppMove = false;
      m.awaitingOppSince = null;
    }
    if (ourTurn) {
      m.opponentTurnSince = null;
    } else if (isRealtime) {
      const now = Date.now();
      if (!m.opponentTurnSince) {
        m.opponentTurnSince = now;
      } else if (now - m.opponentTurnSince >= OPPONENT_INACTIVITY_LIMIT_MS) {
        const mins = Math.round((now - m.opponentTurnSince) / 60_000);
        this.recordError(
          "opponentInactivity",
          `Opponent on turn for ${mins}m (limit ${OPPONENT_INACTIVITY_LIMIT_MS / 60_000}m); conceding`,
          tableId,
        );
        await this.concedeTable(tableId, m, "opponentInactivity", OPPONENT_TIMEOUT_CHAT).catch((e) => {
          this.recordError("opponentInactivityConcede", e, tableId);
        });
        return;
      }
    }

    // Only act if BGA's active_player matches our uid; covers the race
    // where current_player_nbr changed but we already moved this turn.
    if (!ourTurn) {
      m.lastMoveAttempt = {
        ts: Date.now(), result: "opp-turn", activePlayer: parsed.activePlayer,
      };
      return;
    }
    // BGA's HTML lags its server state by a few seconds after a successful
    // selectCell; if a follow-up tick fires inside that window, the page
    // still shows it's our turn. Skip until we observe activePlayer flip
    // to the opponent at least once — see awaitingOppMove.
    if (m.awaitingOppMove) {
      m.lastMoveAttempt = {
        ts: Date.now(), result: "opp-turn", activePlayer: parsed.activePlayer,
      };
      return;
    }

    // Pawn promotion gate. gamestate.id === 4 (`playerPromotePawn`) is
    // BGA's signal that our previous selectCell landed a pawn on the
    // back rank and BGA is now blocking on the piece-type choice. In
    // this state destinations_by_piece is empty and selectCell is the
    // wrong endpoint — promotePawn.html is what BGA wants. We always
    // pick queen; under-promotion is exotic enough that the engine
    // plumbing isn't worth it for this bot. Once the call lands the
    // game transitions back to state 3 on the opponent's turn (same
    // ack/lag handling as a normal move).
    if (parsed.gamestateId === 4) {
      try {
        await this.client.promotePawn(m.gameserver, tableId, "queen");
      } catch (e) {
        m.lastMoveAttempt = {
          ts: Date.now(), result: "promote-failed",
          activePlayer: parsed.activePlayer, err: String(e).slice(0, 200),
        };
        this.recordError("promotePawn", e, tableId);
        return;
      }
      m.lastTurn = "opp";
      await this.client.wakeup(m.gameserver, tableId).catch(() => {});
      m.awaitingOppMove = true;
      m.awaitingOppSince = Date.now();
      m.lastMoveAttempt = {
        ts: Date.now(), result: "promoted", activePlayer: parsed.activePlayer,
      };
      console.log(`t=${tableId} promoted to queen`);
      return;
    }

    if (Object.keys(parsed.destinationsByPiece).length === 0) {
      m.lastMoveAttempt = {
        ts: Date.now(), result: "no-dests", activePlayer: parsed.activePlayer,
      };
      return;
    }

    // What color are we? Find any piece with our uid? Actually pieces don't
    // carry the player id directly; we know which color we are because BGA
    // assigns table_order=1 to creator (white) and 2 to opponent (black).
    // But simpler: pick the color of the only piece in destinations_by_piece.
    const firstPid = Object.keys(parsed.destinationsByPiece)[0];
    const firstPiece = parsed.pieces[firstPid];
    const ourColor: "white" | "black" = firstPiece?.piece_color ?? "white";
    m.botColor = ourColor;
    const fen = buildFen(parsed.pieces, ourColor, parsed.destinationsByPiece);
    // Use the engine-grade FEN (correct castling rights) for the cache
    // and snapshot. The per-tick path above already wrote a placement
    // snapshot; overwrite with the more accurate one now.
    m.lastBoardFen = fen;

    let chosen: { pieceId: string; dest: Destination } | null = null;
    let engineSource = "unknown";
    let engineResults: EngineAltEntry[] | undefined;
    let engineErr: string | undefined;

    // Cache lookup: identical FENs across games reuse a prior engine
    // verdict. lookupUciMove still validates against the current legal
    // table so a cached move BGA no longer accepts falls through to a
    // fresh engine race.
    const cacheKey = `${MOVE_CACHE_PREFIX}${fen}`;
    const cached = await this.ctx.storage.get<CachedMove>(cacheKey).catch(() => undefined);
    if (cached) {
      const cachedChosen = lookupUciMove(cached.move, parsed.pieces, parsed.destinationsByPiece);
      if (cachedChosen) {
        chosen = cachedChosen;
        engineSource = `cache:${cached.engine}`;
        if (cached.cp != null || cached.mate != null) {
          m.lastEval = { cp: cached.cp, mate: cached.mate, engine: cached.engine, ts: Date.now() };
        }
      }
    }

    if (!chosen) {
      try {
        const result = await this.askEngine(fen);
        if (result) {
          engineResults = result.alternatives;
          if (result.move) {
            chosen = lookupUciMove(result.move, parsed.pieces, parsed.destinationsByPiece);
            if (chosen) engineSource = result.engine;
          }
          // Winner's move failed to resolve against BGA's legal table (most
          // commonly: engine suggested a castle BGA refuses, or an old
          // alternatives entry from a stale FEN). Walk the rest of the
          // race results in their original (precedence) order before
          // resorting to a random move.
          if (!chosen && result.alternatives) {
            for (const alt of result.alternatives) {
              if (!alt.move || alt.error) continue;
              if (alt.engine === result.engine) continue;
              const cand = lookupUciMove(alt.move, parsed.pieces, parsed.destinationsByPiece);
              if (cand) {
                chosen = cand;
                engineSource = alt.engine;
                break;
              }
            }
          }
        }
      } catch (e) {
        engineErr = String(e).slice(0, 200);
        this.recordError("engine", e, tableId);
      }
    }
    if (!chosen) {
      m.lastMoveAttempt = {
        ts: Date.now(), result: "no-engine-move",
        activePlayer: parsed.activePlayer, err: engineErr,
      };
      chosen = anyLegalMove(parsed.pieces, parsed.destinationsByPiece);
      if (chosen) engineSource = "random-fallback";
    }
    if (!chosen) {
      m.lastMoveAttempt = {
        ts: Date.now(), result: "no-fallback-move",
        activePlayer: parsed.activePlayer, err: engineErr,
      };
      return;
    }

    const fromPiece = parsed.pieces[chosen.pieceId];
    const fromSq = fromPiece ? xyToSq(Number(fromPiece.piece_x), Number(fromPiece.piece_y)) : "??";
    const toSq = xyToSq(chosen.dest.dest_x, chosen.dest.dest_y);

    // Snapshot the engine eval for the gallery view. Pull from whichever
    // engine produced the chosen move so the displayed eval matches the
    // move that was played. cp is in pawns; convention varies subtly
    // across engines, treated as side-to-move = bot here.
    const winnerAlt = engineResults?.find((r) => r.engine === engineSource);
    if (winnerAlt && (winnerAlt.eval != null || winnerAlt.mate != null)) {
      m.lastEval = {
        cp: winnerAlt.eval, mate: winnerAlt.mate ?? null,
        engine: engineSource, ts: Date.now(),
      };
    }

    // Resolve eval/think info for the move record. For an engine race we
    // pull from the winning alt; on a cache hit there's no winnerAlt, so
    // fall back to the cached cp/mate (no thinkMs since no engine ran).
    let moveCp: number | undefined;
    let moveMate: number | null | undefined;
    let moveThinkMs: number | undefined;
    if (winnerAlt) {
      moveCp = winnerAlt.eval;
      moveMate = winnerAlt.mate ?? null;
      moveThinkMs = winnerAlt.ms;
    } else if (engineSource.startsWith("cache:") && cached) {
      moveCp = cached.cp;
      moveMate = cached.mate ?? null;
    }
    const isCapture = (chosen.dest.captured?.length ?? 0) > 0;
    const movedPiece = parsed.pieces[chosen.pieceId];
    this.recordMove({
      tableId, from: fromSq, to: toSq, engine: engineSource, engineResults,
      botColor: ourColor, oppName: m.oppName,
      cp: moveCp, mate: moveMate, thinkMs: moveThinkMs,
      captured: isCapture,
      pieceType: movedPiece?.piece_type,
    });
    console.log(
      `t=${tableId} move ${fromSq}→${toSq} engine=${engineSource} ` +
      `color=${ourColor} piece=${movedPiece?.piece_type ?? "?"} ` +
      `capture=${isCapture ? "1" : "0"} ` +
      `cp=${moveCp ?? "?"} mate=${moveMate ?? "?"} thinkMs=${moveThinkMs ?? "?"}`,
    );

    // Cache fresh engine verdicts (skip cache hits and random fallback) so
    // future hits on the same FEN reuse the result. UCI is just from+to;
    // lookupUciMove ignores the promo char, matching how the bot already
    // delegates the promoted-piece choice to BGA's default.
    //
    // Precedence-gated: only write if the new engine ranks at least as
    // well as whatever the cache already holds. Otherwise a one-off run
    // where the top engine was offline would downgrade a previously
    // cached top-engine verdict.
    if (engineSource !== "random-fallback" && !engineSource.startsWith("cache:")) {
      const newRank = enginePrecedenceRank(engineSource);
      const cachedRank = cached ? enginePrecedenceRank(cached.engine) : Number.POSITIVE_INFINITY;
      if (newRank <= cachedRank) {
        await this.ctx.storage.put<CachedMove>(cacheKey, {
          move: `${fromSq}${toSq}`, engine: engineSource,
          cp: winnerAlt?.eval, mate: winnerAlt?.mate ?? null,
          ts: Date.now(),
        }).catch(() => {});
      }
    }
    try {
      await this.client.selectCell(m.gameserver, tableId, chosen.dest.dest_x, chosen.dest.dest_y, chosen.pieceId);
    } catch (e) {
      m.lastMoveAttempt = {
        ts: Date.now(), result: "select-cell-failed",
        activePlayer: parsed.activePlayer, err: String(e).slice(0, 200),
      };
      this.recordError("selectCell", e, tableId);
      return;
    }
    m.lastMoveFrom = fromSq;
    m.lastMoveTo = toSq;
    // Optimistic: bot just played, so logically it's the opponent's move
    // even while BGA's HTML lag still echoes activePlayer=us. Without this,
    // the gallery shows "bot to move" until the next tick after the lag
    // closes (often 5-30s).
    m.lastTurn = "opp";
    await this.client.wakeup(m.gameserver, tableId).catch(() => {});
    m.awaitingOppMove = true;
    m.awaitingOppSince = Date.now();
    m.lastMoveAttempt = {
      ts: Date.now(), result: "played", activePlayer: parsed.activePlayer,
    };
    if (engineSource === "random-fallback" && !m.saidRandomFallback) {
      await this.client.chat(tableId, RANDOM_FALLBACK_CHAT).catch(() => {});
      m.saidRandomFallback = true;
    }
  }

  private async askEngine(fen: string): Promise<{
    move: string; engine: string; alternatives?: EngineAltEntry[];
  } | null> {
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
    const json = (await resp.json()) as {
      move?: string; engine?: string; alternatives?: EngineAltEntry[];
    };
    if (!json.move) return null;
    return {
      move: json.move,
      engine: json.engine ?? "unknown",
      alternatives: json.alternatives,
    };
  }
}
