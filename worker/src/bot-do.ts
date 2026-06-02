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
  parseGameHtml, parseOpponent, buildFen, lookupUciMove, anyLegalMove, xyToSq,
  placementAfterMove, chooseRepetitionAwareMove, shouldSkipMoveForNeutralized,
  type Destination, type MoveCandidate,
} from "./bot-move";
import { t as tr } from "./i18n";
import { chunkChat } from "./chat";
import {
  extractCentrifugeAuth, isVisitorId, channelsFor, probeCentrifuge,
  openCentrifugeSocket, parseFrames,
} from "./centrifuge";
import {
  isJoinableStatus, isLivePlayStatus, isFinishedStatus,
  gamemodeOf, inviteSlotModeOf, GAMEMODES, decideReconcileMiss,
  isBenignCreateTableError,
  type Gamemode,
} from "./bot-status";
import { enginePrecedenceRank, isCacheableEngine } from "./stockfish-do";
import { parseGameLog, reconstructMoves } from "./game-log";
import {
  buildPremiumLink, buildGameLink, isSecondaryAsyncGame, primaryAsyncGameId,
  decidePremiumBlock, isPremiumGateActive,
  type PremiumBlockReason, type GateMode,
} from "./premium";

const TICK_MS = 5_000;
/** Faster tick used ONLY while a realtime invite is open and still waiting
 *  for an opponent — so a join is detected (and the game launched) in ~1s
 *  instead of up to 5s. Reverts to TICK_MS the moment someone sits down (the
 *  invite slot clears) or a game goes live. We can't push-detect the join
 *  (an open invite has no game page → no centrifuge token), so this is the
 *  only way to cut the start latency. */
const INVITE_FAST_TICK_MS = 1_000;
// All opponent-facing chat lives in src/i18n.ts (localized per the
// opponent's BGA interface language). See the `t()` calls below.
/** Sub-grandmaster difficulty tiers map to js-chess-engine levels 1-5.
 *  Selected by an opponent chat command at any point in the game; absence
 *  means the default for both gamemodes: full grandmaster Stockfish (the
 *  remote engine race). The keyword match is exact (trim +
 *  lowercase) so chat stays a closed enum, not a free injection surface —
 *  see pollAndReplyChat. */
const DIFFICULTY_LEVELS: Record<string, number> = {
  beginner: 1,
  easy: 2,
  intermediate: 3,
  advanced: 4,
  expert: 5,
};
const DIFFICULTY_ELO: Record<string, string> = {
  beginner: "~700",
  easy: "~1000",
  intermediate: "~1300",
  advanced: "~1600",
  expert: "~1800",
};
/** Canonical difficulty buckets for per-difficulty stats, strongest first.
 *  "grandmaster" is the full remote-Stockfish race (no DIFFICULTY_LEVELS
 *  entry); the rest mirror DIFFICULTY_LEVELS. Entries written before the
 *  difficulty feature tally as "grandmaster" (see tally site). */
const DIFFICULTY_ORDER = [
  "grandmaster", "expert", "advanced", "intermediate", "easy", "beginner",
] as const;
function emptyDifficultyTally(): Record<string, { wins: number; losses: number; draws: number }> {
  const out: Record<string, { wins: number; losses: number; draws: number }> = {};
  for (const d of DIFFICULTY_ORDER) out[d] = { wins: 0, losses: 0, draws: 0 };
  return out;
}
/** Concede a realtime game when the opponent has sat on THEIR CURRENT TURN
 *  this long without moving (i.e. measured from when we handed them the move
 *  / their last move — opponentTurnSince resets every time they move, so it
 *  is never "time since the game was created"). Friendly clocks are ~90 days
 *  so wall-clock is the only ghost signal, and realtime caps one game per
 *  type, so a truly-abandoned table must be freed. Realtime only. */
const OPPONENT_INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
/** An opponent-quit signal (BGA `zombie:1` / `neutralized_player_id`) must
 *  PERSIST this long before we concede. BGA flips these flags transiently on
 *  realtime reconnects / bookkeeping, so a momentary blip must never throw a
 *  live game (that was the old "bot quit my game the moment I joined" bug);
 *  a flag still set after the full window is a genuine abandonment. Friendly
 *  games carry no rating penalty, so once confirmed we quit too — freeing the
 *  single realtime slot immediately, or (for async) cleaning up the dead
 *  table instead of waiting out OPPONENT_INACTIVITY_LIMIT_MS / MAX_TABLE_AGE_MS
 *  / BGA's own end-of-game sweep. Applies to both realtime and async. */
const OPP_QUIT_CONFIRM_MS = 60 * 1000;
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
// Requested search depth, fed to every engine and clamped per-API:
// chess-api.com caps the param at 18 (but is time-budget limited, so it
// realistically returns ~13-15), stockfish.online caps at 15, rapidapi
// ignores it (fixed 12), lichess serves whatever depth it cached. We ask
// for the max each honors; all return well under the 5s race ceiling.
const ENGINE_DEPTH = 18;
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
/** Max concurrent getTableInfo() reconcile lookups per tick. The reconcile
 *  loop fetches one table per in-flight memo that fell off the lobby
 *  snapshot; doing them serially made each tick O(memo-count) wall time
 *  (~30s once the memo backlog grew past 100), which both stalled invite
 *  accepts/moves and tripped BGA's "didn't process fast enough" rate limit.
 *  Bounded parallelism keeps a large backlog draining in a few seconds
 *  without flooding BGA. */
const RECONCILE_CONCURRENCY = 6;
/** A memo that reached `acceptedSeat`/`ackedStart` but never `saidHi` never
 *  entered live play (saidHi is set the moment gameserver resolves, i.e. the
 *  game started). If such a memo is also absent from every open/finished
 *  snapshot and older than this, the table died in setup (realtime "Accept"
 *  overlay expired, opponent declined, etc.). GC it without a network call so
 *  the backlog can't accumulate into a getTableInfo storm. Real games set
 *  saidHi within seconds of start, so 15 min is a safe floor. */
const STALE_UNPLAYED_MS = 15 * 60 * 1000;
/** Cap on the rolling error log size kept in BotStatus. */
const RECENT_ERRORS_CAP = 100;
/** Cap on the rolling moves log size kept in BotStatus (across all tables). */
const RECENT_MOVES_CAP = 500;
/** Cap on the rolling game-results log. One entry per finished/archive
 *  tally so we can audit which raw score BGA reported per game without
 *  spelunking the GC'd memo. Used to diagnose "draws stayed 0" bugs. */
const RECENT_RESULTS_CAP = 500;
/** Cap on each of the rolling premium-engagement logs (nudges + clicks).
 *  Kept generous so the "we drive BGA memberships" evidence is durable. */
const PREMIUM_LOG_CAP = 1000;
/** Grace between sending the "upgrade to BGA Premium" nudge and actually
 *  voiding the table, so the bounced member has time to READ the message
 *  before the game vanishes. The kick is deferred to a later tick (we never
 *  block the tick on a 30s sleep — that would freeze every other live game). */
const PREMIUM_KICK_DELAY_MS = 30_000;
/** Max attempts to fetch a finished game's archive move log. BGA's replay
 *  log can lag a few seconds behind the `finished` flip, so the capture
 *  retries across ticks (the memo lingers until BGA drops the table from
 *  the polled list). Bounds the fetch so a permanently-missing log can't
 *  re-fetch every tick. */
const MOVE_CAPTURE_MAX_ATTEMPTS = 6;

/** djb2 string hash. Used only to detect whether a status blob changed
 *  since its last persist — collisions just cause a redundant write, never
 *  data loss, so a cheap 32-bit hash is fine. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return h >>> 0;
}
/** DO storage key prefix for the engine-move cache. One key per FEN; value
 *  is the UCI move and the engine that produced it. Keyed on the FEN built
 *  by buildFen(), which is deterministic for a given position (halfmove
 *  and fullmove are zeroed), so identical positions across games collide. */
const MOVE_CACHE_PREFIX = "mc:";
/** Cap on the number of per-FEN move-cache entries kept in DO storage. The
 *  cache writes one key per unique position seen across all games and never
 *  expired entries, so it grew without bound. When a GC pass finds more than
 *  this, the oldest entries (by ts) are evicted back down to the cap. */
const MOVE_CACHE_CAP = 5_000;
/** Don't run the move-cache GC more often than this. The pass lists every
 *  `mc:` key, so it isn't free; hourly keeps it negligible while still
 *  bounding growth. In-memory throttle — resets on eviction, which is fine. */
const MOVE_CACHE_GC_INTERVAL_MS = 60 * 60 * 1000;
/** Backoff schedule (ms) applied after consecutive tick failures. Index is
 *  consecutiveFailures - 1; clamped to the last entry. Resets on success. */
const TICK_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

/** Bot-relative eval (pawns, positive = bot ahead) at or above which the
 *  repetition guard will dodge a threefold draw. Below this the bot is even
 *  or worse, where a draw is a fine-to-welcome result, so we let it repeat.
 *  Tuned to "up about a pawn" — enough of an edge to be worth playing on. */
const REPETITION_AVOID_EVAL = 0.8;
/** Max placements retained per memo for repetition detection. The history is
 *  reset on the bot's own irreversible moves (captures / pawn pushes), so this
 *  is just a backstop against an unbounded shuffle. */
const REPETITION_HISTORY_CAP = 40;

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
  /** Sent the "I decline draws" chat for the CURRENT pending draw offer.
   *  Set when the decline chat goes out, cleared whenever the game is no
   *  longer in the draw gamestate, so a fresh offer re-notifies but a draw
   *  that stays pending across ticks doesn't spam the same message. */
  saidDrawDecline?: boolean;
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
  /** Marked true the moment the premium gate sends a free member the upgrade
   *  nudge. Makes handleTable a no-op for the table (no greet, no move), but
   *  it is NOT a played game: no GG, no result entry, no concede stat. The
   *  actual void (leaveTable) is deferred — see premiumNudgedAt. */
  premiumBlocked?: boolean;
  /** Wall-clock ms the upgrade nudge was sent. The table is voided
   *  PREMIUM_KICK_DELAY_MS later (on a subsequent tick) so the member can
   *  read the message first. Unset until the nudge fires. */
  premiumNudgedAt?: number;
  /** True once the deferred void (leaveTable) has actually run, so we don't
   *  leave the table twice. */
  premiumKicked?: boolean;
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
  /** Wall-clock ms we first saw the opponent flagged zombie/neutralized.
   *  We require the flag to persist (see OPP_QUIT_CONFIRM_MS) before
   *  conceding, so a transient realtime blip doesn't throw a live game.
   *  Cleared when the flag clears. */
  oppQuitSince?: number | null;
  /** Wall-clock ms we first created the memo for this table (i.e. first
   *  tick where we saw it). Used for "started" column in the dashboard. */
  startedAt?: number;
  /** Count of moves the bot has played on this table. Incremented each
   *  time we record a move; snapshotted onto the ResultEntry at finish so
   *  the past-games table can show game length without re-deriving from
   *  the (rolling, capped) recentMoves log. */
  moveCount?: number;
  /** Per-engine count of moves the bot played on this table, keyed by the
   *  same `engineSource` strings used in recentMoves (e.g. "stockfish.online",
   *  "cache:lichess-cloud-eval", "js-chess-engine (local DO)", ...).
   *  Accumulated each move and snapshotted onto the ResultEntry at finish, so
   *  "which engines did this game use" survives after the per-move recentMoves
   *  log rolls off its cap. Lets us answer e.g. "what engines did our
   *  grandmaster losses use" for any retained result. */
  engineCounts?: Record<string, number>;
  /** Opponent-selected difficulty: a DIFFICULTY_LEVELS key, "grandmaster",
   *  or unset (= use the default for both gamemodes: grandmaster).
   *  Settable any time via chat, so the opponent can change it mid-game. */
  difficulty?: string;
  /** The difficulty actually used on the last move (after applying the
   *  default). Recorded onto the ResultEntry so past-games shows
   *  what was really played, not the raw (possibly unset) choice. */
  effectiveDifficulty?: string;
  /** True if this game is realtime ("play"), false if turn-based
   *  ("asyncplay"). Recorded from the live status (the authoritative
   *  signal) the first time we see the table in play, because the terminal
   *  status is unreliable for this — async games frequently roll straight to
   *  `archive` (not `asyncfinished`), which would otherwise leave the
   *  past-games "live" flag ambiguous. */
  realtime?: boolean;
  /** Opponent's BGA interface-language code (2-letter), parsed from the
   *  game page. Drives which language the bot's chat is sent in. Unset =
   *  not yet detected / unknown → English. */
  oppLanguage?: string;
  /** True if the opponent has a BGA premium membership, false if free.
   *  Parsed from the game-page player blob (is_premium). Unset = not yet
   *  detected (e.g. opponent only seen via the lobby fallback). */
  oppPremium?: boolean;
  /** Wall-clock ms we marked the table finished. Set wherever
   *  `finished = true` is set. */
  finishedAt?: number;
  /** True once the archive move log has been captured onto this table's
   *  ResultEntry. Gates the per-tick capture so we stop fetching once we
   *  have the moves. */
  movesCaptured?: boolean;
  /** Number of archive-log fetch attempts so far. Bounds retries when the
   *  log is slow to populate after a realtime game flips to finished. */
  moveCaptureAttempts?: number;
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
  /** Placement field (FEN field 0) of every position the bot has handed the
   *  opponent this game, oldest first. The repetition guard counts a
   *  candidate move's resulting placement against this list: two prior
   *  occurrences mean playing it would create a claimable threefold. Reset on
   *  the bot's own irreversible moves and capped at REPETITION_HISTORY_CAP. */
  posHistory?: string[];
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
  /** Opponent's BGA player id (the players-map key), captured alongside
   *  oppName. Powers the profile link (player?id=…) in past games. */
  oppId?: string;
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
      | "declined-draw"
      | "decline-draw-failed"
      | "no-parse"
      | "opp-turn"
      | "no-dests"
      | "skip-opp-neutralized"
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
  /** Per-difficulty win/loss/draw counters, keyed by DIFFICULTY_ORDER. Lets
   *  the dashboard break the top-line stats down by strength tier. Absent on
   *  blobs written before this field existed — backfilled from recentResults
   *  on boot (see backfillDifficultyStats). */
  byDifficulty?: Record<string, { wins: number; losses: number; draws: number }>;
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
  | "oppQuit"            // opponent flagged zombie/neutralized (realtime or async)
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
  /** Why a non-scored game ended, for the dashboard's troubleshooting table.
   *  Only set on tally==="none" entries we record for games that never
   *  produced a clean W/L/D: a short code such as a ConcedeReason
   *  ("errors" / "tableAge" / "lostSeat" / "oppQuit" / "opponentInactivity")
   *  or a premium-gate void ("premium:realtime-free" / "premium:async-limit").
   *  Undefined on scored games and on legacy "none" entries (an unparseable
   *  BGA finish score). */
  reason?: string;
  /** Legacy: an earlier build force-marked some finished games tally "none"
   *  (a since-removed "no moves played" / "neutralized" guard) even though BGA
   *  had assigned a clean score, recording WHY here ("no-moves" /
   *  "neutralized"). No longer written by the current scorer; retained only so
   *  the dashboard can label, and `/bot/retally-unscored` can re-tally, the
   *  backlog of such entries. */
  uncountedReason?: string;
  /** Snapshot of game stats at finish, for the past-games table. All
   *  optional — entries written before these fields existed leave them
   *  undefined, and the dashboard renders a dash. */
  durationMs?: number;
  moveCount?: number;
  botColor?: "white" | "black";
  oppName?: string;
  /** Opponent's BGA player id, for the profile link in past games. */
  oppId?: string;
  /** Difficulty the game was played at. Unset on entries written before
   *  this field existed → the dashboard treats those as "grandmaster". */
  difficulty?: string;
  /** Opponent's BGA interface-language code, for the past-games flag. */
  oppLanguage?: string;
  /** True if the opponent was a BGA premium member, false if free. Unset on
   *  entries written before this field existed, or when membership wasn't
   *  detected. Drives the premium/free breakdown on the dashboard. */
  oppPremium?: boolean;
  /** True if the game was realtime, false if turn-based (async). Derived
   *  from the terminal status ("finished" = realtime, "asyncfinished" =
   *  async). Undefined when the status didn't disambiguate ("archive") or
   *  the entry predates this field. */
  realtime?: boolean;
  /** Opponent's raw score at finalization. Captured to disambiguate the
   *  BGA-friendly draw quirk (some draws come back as 0/0 instead of
   *  0.5/0.5); kept on the record so retroactive triage doesn't need to
   *  re-fetch tableinfos. Older entries written before this field was
   *  added will be undefined. */
  oppRawScore?: string | null;
  /** UCI move list reconstructed from BGA's archive replay log at finish
   *  (e.g. "e2e4", "e1g1" castle, "g7g8q" promotion). Lets a historical
   *  game be replayed and analyzed (derive the FEN at any ply). Best-effort:
   *  undefined when the log wasn't available or couldn't be parsed. */
  moves?: string[];
  /** Final-position FEN derived by replaying `moves`. Best-effort; undefined
   *  when reconstruction failed. */
  finalFen?: string;
  /** Per-engine count of the bot's moves in this game, keyed by engineSource
   *  (e.g. "stockfish.online", "cache:chess-api.com", "js-chess-engine
   *  (local DO)"). Snapshotted from the table memo at finish so engine
   *  provenance survives after recentMoves rolls off. Undefined on entries
   *  written before this field existed. */
  engineCounts?: Record<string, number>;
}

/**
 * One "upgrade to BGA Premium" nudge the bot sent a free member after
 * bouncing them off a limited resource (a realtime game, or a 2nd
 * concurrent async game). Captured so we can show BGA, with data, that the
 * bot drives membership interest: who we nudged and when.
 */
interface PremiumNudge {
  /** Wall-clock time the nudge chat was sent. */
  ts: number;
  /** Opponent's BGA player id. */
  uid: string;
  /** Opponent display name at the time, best-effort. */
  name?: string;
  /** Table the nudge was sent on. */
  tableId: string;
  /** Which limited resource they hit. */
  mode: GateMode;
  /** Why we blocked: "realtime-free" or "async-limit". */
  reason: PremiumBlockReason;
  /** Opponent's BGA interface language the message was localized to. */
  lang?: string;
}

/**
 * One click on a premium upgrade link, recorded by the worker's
 * /go/premium endpoint and forwarded into the DO. Demonstrates the nudge
 * converted to interest (a click-through toward BGA's membership page).
 */
interface PremiumClick {
  /** Wall-clock time the click was logged. */
  ts: number;
  /** Opponent's BGA player id from the link (u=), if present. */
  uid?: string;
  /** Table id the link was minted for (t=), if present. */
  tableId?: string;
  /** Mode the link was minted for (m=), if present. */
  mode?: string;
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
  /** Rolling log of "upgrade to premium" nudges we sent to free members we
   *  bounced off a limited resource (realtime / 2nd async). Persisted so we
   *  can demonstrate to BGA that the bot drives membership interest. Capped
   *  at PREMIUM_LOG_CAP. */
  premiumNudges?: PremiumNudge[];
  /** Rolling log of clicks on the premium link (recorded by /go/premium on
   *  the worker, forwarded into the DO). Capped at PREMIUM_LOG_CAP. */
  premiumClicks?: PremiumClick[];
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
  /** Operator pause flag. Set by /bot/stop, cleared by /bot/start. The cron
   *  watchdog honors it so a deliberate stop isn't silently overridden by the
   *  once-a-minute poke. A fresh deploy defaults to false, so the bot still
   *  auto-starts on the first cron tick. */
  paused: boolean;
}

export class BotDriver extends DurableObject<Env> {
  private client: BGAClient | null = null;
  private uid: string | null = null;
  private status: BotStatus = {
    loggedIn: false, uid: null, running: false,
    lastTickAt: null, lastErr: null,
    recentErrors: [], recentMoves: [], recentResults: [],
    premiumNudges: [], premiumClicks: [],
    stats: { wins: 0, losses: 0, draws: 0, concedes: 0, engineUses: {}, byDifficulty: emptyDifficultyTally() },
    tables: {},
    openInvites: { realtime: emptyInvite(), async: emptyInvite() },
    consecutiveTickFailures: 0,
    nextTickEarliest: null,
    paused: false,
  };
  private booted = false;
  /** Persistent Centrifugo websocket for realtime PRESENCE. BGA neutralizes
   *  a player it doesn't see connected, so a poll-only bot loses realtime
   *  games. We hold this socket open and subscribed to each live realtime
   *  table so BGA sees the bot present. The poll loop still drives moves;
   *  this is purely the presence/keepalive layer (phase 2a). Null when no
   *  realtime game is live or the socket dropped (reconnected next tick). */
  private ws: WebSocket | null = null;
  /** Channels currently subscribed on `ws`, so we only sub new ones. */
  private wsChannels = new Set<string>();
  /** Monotonic Centrifugo command id. */
  private wsCmdId = 1;
  /** Unix ms of the last move-cache GC pass. Throttles gcMoveCache(). */
  private lastCacheGcAt = 0;
  /** Hash of each status blob as last persisted, so the per-tick persist
   *  loop can skip the storage write when nothing changed. Without this the
   *  loop rewrote every blob every 5s; `recentResults` now carries per-game
   *  move logs that never change after a game finishes, so the unconditional
   *  rewrite was pure write amplification. Empty after a DO restart → the
   *  next tick writes each blob once to re-seed. */
  private persistHashes: Record<string, number> = {};
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
    if (url.pathname === "/watchdog") {
      await this.boot();
      await this.watchdog();
      return Response.json({
        ok: true, running: this.status.running, paused: this.status.paused,
      });
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
    if (url.pathname === "/premium-click") {
      // The worker's /go/premium endpoint logs a click here before 302ing
      // the user to BGA's membership page. Carries the who/where/mode the
      // upgrade link was minted with (u/t/m), all optional.
      await this.boot();
      await this.appendPremiumClick({
        ts: Date.now(),
        uid: url.searchParams.get("u") ?? undefined,
        tableId: url.searchParams.get("t") ?? undefined,
        mode: url.searchParams.get("m") ?? undefined,
      });
      return Response.json({ ok: true });
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
    if (url.pathname === "/ws-probe") {
      // Spike: verify the bot's authed centrifuge token actually connects and
      // receives pushes. Read-only — does not touch the poll loop. Fetches a
      // table's game page (for the inlined token + our uid), connects, subs to
      // the player + table channels, answers pings, and returns raw frames.
      await this.boot();
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "missing id (table id)" }, { status: 400 });
      if (!this.client) return Response.json({ error: "no client" });
      try { await this.client.login(); } catch (e) {
        return Response.json({ error: "login failed: " + String(e).slice(0, 200) });
      }
      let gs = this.status.tables[id]?.gameserver ?? null;
      if (gs == null) gs = await this.client.resolveGameserver(id).catch(() => null);
      if (gs == null) return Response.json({ error: "could not resolve gameserver for table " + id });
      const html = await this.client.fetchGamePage(gs, id);
      const auth = extractCentrifugeAuth(html);
      if (!auth) {
        return Response.json({ error: "no centrifuge token found in game page", htmlLen: html.length });
      }
      if (isVisitorId(auth.userId)) {
        return Response.json({
          error: "extracted a VISITOR id — bot cookies aren't authing the game page",
          userId: auth.userId,
        });
      }
      const collectMs = Math.min(Number(url.searchParams.get("ms") ?? 8000) || 8000, 20000);
      const result = await probeCentrifuge({
        userId: auth.userId,
        username: "bot_stockfish",
        token: auth.token,
        channels: channelsFor(auth.userId, [id]),
        collectMs,
      });
      return Response.json({
        table: id,
        gameserver: gs,
        userId: auth.userId,
        tokenLen: auth.token.length,
        channels: channelsFor(auth.userId, [id]),
        pings: result.pings,
        frameCount: result.frames.length,
        frames: result.frames,
        error: result.error,
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
    if (url.pathname === "/retally-unscored") {
      await this.boot();
      const apply = url.searchParams.get("apply") === "1";
      const result = await this.retallyUnscored(apply);
      return Response.json(result);
    }
    if (url.pathname === "/resync-stats") {
      await this.boot();
      const apply = url.searchParams.get("apply") === "1";
      const result = await this.resyncStats(apply);
      return Response.json(result);
    }
    if (url.pathname === "/purge-cache") {
      await this.boot();
      const apply = url.searchParams.get("apply") === "1";
      const result = await this.purgeMoveCache(apply);
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
    const byDifficulty = emptyDifficultyTally();
    for (const r of results) {
      if (r.tally !== "win" && r.tally !== "loss" && r.tally !== "draw") continue;
      const diff = r.difficulty || "grandmaster";
      const bucket = byDifficulty[diff] ?? (byDifficulty[diff] = { wins: 0, losses: 0, draws: 0 });
      if (r.tally === "win") { tallies.wins++; bucket.wins++; }
      else if (r.tally === "loss") { tallies.losses++; bucket.losses++; }
      else if (r.tally === "draw") { tallies.draws++; bucket.draws++; }
    }
    const before: BotStats = {
      wins: this.status.stats.wins,
      losses: this.status.stats.losses,
      draws: this.status.stats.draws,
      concedes: this.status.stats.concedes,
      engineUses: { ...this.status.stats.engineUses },
      byDifficulty: this.status.stats.byDifficulty,
    };
    const after: BotStats = {
      ...before,
      wins: tallies.wins,
      losses: tallies.losses,
      draws: tallies.draws,
      byDifficulty,
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

  /**
   * One-time backlog fix. An earlier build force-marked some finished games
   * tally "none" (a since-removed "no moves played" / "neutralized" guard)
   * even though BGA had assigned a definitive score, leaving real wins/losses
   * uncounted (they showed as "unscored finishes"). Walk recentResults and
   * re-tally any tally==="none" entry whose rawScore parses to a clean result,
   * using the SAME rule as the live scorer (1=win, 0.5 or mutual-zero=draw,
   * 0=loss). Entries whose score doesn't parse stay "none". Dry-run by default;
   * ?apply=1 commits via fixResult, which rebalances both the top-line and
   * per-difficulty counters.
   */
  private async retallyUnscored(apply: boolean): Promise<{
    apply: boolean;
    inspected: number;
    candidates: Array<{
      tableId: string; ts: number; rawScore: string | null;
      oppRawScore: string | null; was?: string;
      recommendation: "win" | "loss" | "draw";
    }>;
    applied: number;
    stats?: BotStats;
  }> {
    const results = this.status.recentResults || [];
    const candidates: Array<{
      tableId: string; ts: number; rawScore: string | null;
      oppRawScore: string | null; was?: string;
      recommendation: "win" | "loss" | "draw";
    }> = [];
    let inspected = 0;
    for (const r of results) {
      if (r.tally !== "none") continue;
      inspected++;
      const score = r.rawScore == null ? null : Number(r.rawScore);
      if (score == null || !Number.isFinite(score)) continue; // truly unscored
      const opp = r.oppRawScore == null ? null : Number(r.oppRawScore);
      const mutualZero = score === 0 && opp === 0;
      let rec: "win" | "loss" | "draw" | null = null;
      if (score === 1) rec = "win";
      else if (score === 0.5 || mutualZero) rec = "draw";
      else if (score === 0) rec = "loss";
      if (!rec) continue;
      candidates.push({
        tableId: r.tableId, ts: r.ts, rawScore: r.rawScore,
        oppRawScore: r.oppRawScore ?? null,
        was: r.uncountedReason ?? r.reason, recommendation: rec,
      });
    }
    let applied = 0;
    if (apply) {
      for (const c of candidates) {
        const fix = await this.fixResult(c.tableId, c.recommendation);
        if (fix.ok && fix.after?.tally === c.recommendation) applied++;
      }
    }
    console.log(
      `bot:retallyUnscored apply=${apply} inspected=${inspected} ` +
      `candidates=${candidates.length} applied=${applied}`,
    );
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
    // Rebalance BOTH the top-line counters and the per-difficulty bucket so
    // the dashboard's difficulty tabs stay consistent with the "all" totals.
    // (Skipping byDifficulty here used to leave it drifted until a separate
    // /resync-stats pass.) The bucket is keyed by the entry's recorded
    // difficulty, defaulting to grandmaster for pre-field entries.
    if (!this.status.stats.byDifficulty) {
      this.status.stats.byDifficulty = emptyDifficultyTally();
    }
    const diffKey = prev.difficulty || "grandmaster";
    const bucket = this.status.stats.byDifficulty[diffKey]
      ?? (this.status.stats.byDifficulty[diffKey] = { wins: 0, losses: 0, draws: 0 });
    const decTop = (k: keyof BotStats) => {
      const v = this.status.stats[k];
      if (typeof v === "number" && v > 0) (this.status.stats as any)[k] = v - 1;
    };
    const decBucket = (k: "wins" | "losses" | "draws") => {
      if (bucket[k] > 0) bucket[k] -= 1;
    };
    if (prev.tally === "win") { decTop("wins"); decBucket("wins"); }
    else if (prev.tally === "loss") { decTop("losses"); decBucket("losses"); }
    else if (prev.tally === "draw") { decTop("draws"); decBucket("draws"); }
    if (next === "win") { this.status.stats.wins++; bucket.wins++; }
    else if (next === "loss") { this.status.stats.losses++; bucket.losses++; }
    else if (next === "draw") { this.status.stats.draws++; bucket.draws++; }
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
      // Poll fast (1s) while a realtime invite is open and unfilled, so a
      // joining human is detected and launched quickly. Backoff on failures
      // takes precedence. Once filled, the invite slot clears and we drop
      // back to the normal cadence.
      const waitingRealtimeInvite = this.status.openInvites.realtime.id != null;
      const delay = this.status.consecutiveTickFailures > 0
        ? TICK_BACKOFF_MS[Math.min(this.status.consecutiveTickFailures - 1, TICK_BACKOFF_MS.length - 1)]
        : (waitingRealtimeInvite ? INVITE_FAST_TICK_MS : TICK_MS);
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

  /**
   * Send a table chat, splitting long messages into word-boundary chunks.
   * BGA's say.html silently rejects messages over its length limit (returns
   * a status-0 envelope, no throw) — which is why the long localized greeting
   * and concede/timeout messages never appeared. Each chunk is sent
   * sequentially so order is preserved. Returns true only if every chunk was
   * accepted. Short messages send as a single chunk (unchanged behaviour).
   */
  private async sendChat(tableId: string, msg: string): Promise<boolean> {
    if (!this.client) return false;
    // Split at sentence/line boundaries (not mid-sentence) under BGA's cap.
    const chunks = chunkChat(msg, 220);
    let ok = true;
    for (let i = 0; i < chunks.length; i++) {
      // Pace multi-chunk sends: BGA's say.html silently drops chats fired
      // back-to-back (flood control), which truncated long greetings to just
      // the first chunk. A 2s gap per chunk clears BGA's anti-flood window.
      if (i > 0) await new Promise((r) => setTimeout(r, 2_000));
      try {
        const env = await this.client.chat(tableId, chunks[i]) as { status?: number | string };
        if (env && Number(env.status) !== 1) {
          ok = false;
          this.recordError("chatRejected", JSON.stringify(env).slice(0, 160), tableId);
        }
      } catch (e) {
        ok = false;
        this.recordError("chatFailed", e, tableId);
      }
    }
    return ok;
  }

  /**
   * Send the opening greeting exactly once per table. Called from both the
   * poll path (handleTable) and the move path (maybePlayMove / push
   * reactions), which can fire within the same multi-second window. The send
   * is slow (chunked), so we CLAIM saidHi=true *before* awaiting — otherwise
   * two concurrent callers both see saidHi=false and each send the greeting
   * (the double-intro bug). We do not reset on failure: better a missing/
   * partial opener than a duplicate. A partial send is logged.
   */
  /**
   * Refresh the opponent's id, display name, and language from the live game
   * page (authoritative). The lobby snapshot captures these once and freezes
   * them, which can be the wrong player: an open invite may cache one joiner
   * before that game falls through, then a different player joins the same
   * table id and actually plays. The game page always reflects the real
   * opponent. Preserves prior values when the page yields nothing.
   */
  private refreshOpponent(m: TableMemo, html: string): void {
    const opp = parseOpponent(html, this.uid ?? undefined);
    if (!opp) return;
    m.oppId = opp.id;
    m.oppName = opp.name;
    if (opp.language) m.oppLanguage = opp.language;
    if (opp.premium !== undefined) m.oppPremium = opp.premium;
  }

  private async maybeGreet(tableId: string, m: TableMemo, _isRealtime: boolean): Promise<void> {
    if (!this.client || m.saidHi) return;
    m.saidHi = true;
    // Both gamemodes default to full grandmaster Stockfish, so the same
    // greeting applies — it states the grandmaster default and the opt-in
    // difficulty keywords.
    const ok = await this.sendChat(tableId, tr("greeting", m.oppLanguage));
    if (!ok) this.recordError("greetingPartial", "greeting send incomplete", tableId);
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
    this.status.paused = (await storage.get<boolean>("paused")) ?? false;

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
    this.status.premiumNudges =
      (await storage.get<PremiumNudge[]>("premiumNudges")) ?? [];
    this.status.premiumClicks =
      (await storage.get<PremiumClick[]>("premiumClicks")) ?? [];
    // Backfill per-difficulty counters for blobs persisted before the field
    // existed. Derived from recentResults (same source resyncStats uses), so
    // it's only as deep as the retained log — good enough for the dashboard
    // breakdown, and live tallies keep it current from here on.
    if (!this.status.stats.byDifficulty) {
      const byDifficulty = emptyDifficultyTally();
      for (const r of this.status.recentResults) {
        if (r.tally !== "win" && r.tally !== "loss" && r.tally !== "draw") continue;
        const diff = r.difficulty || "grandmaster";
        const bucket = byDifficulty[diff] ?? (byDifficulty[diff] = { wins: 0, losses: 0, draws: 0 });
        if (r.tally === "win") bucket.wins++;
        else if (r.tally === "loss") bucket.losses++;
        else if (r.tally === "draw") bucket.draws++;
      }
      this.status.stats.byDifficulty = byDifficulty;
      await storage.put("stats", this.status.stats);
    }
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
    // An explicit start clears any operator pause so the cron watchdog
    // resumes managing the alarm chain.
    this.status.paused = false;
    await this.ctx.storage.put("running", true);
    await this.ctx.storage.put("paused", false);
    await this.ctx.storage.setAlarm(Date.now() + 100);
  }

  private async stop(): Promise<void> {
    await this.boot();
    this.status.running = false;
    // Latch a pause so the once-a-minute cron watchdog doesn't restart the
    // bot. Cleared only by an explicit /bot/start.
    this.status.paused = true;
    await this.ctx.storage.put("running", false);
    await this.ctx.storage.put("paused", true);
    await this.ctx.storage.deleteAlarm();
    // Drop the realtime presence socket so a stopped bot can't keep reacting
    // to websocket pushes and playing moves. ensurePresence reopens it on the
    // next tick after a resume.
    if (this.ws) {
      try { this.ws.close(); } catch { /* already closed */ }
      this.ws = null;
      this.wsChannels.clear();
    }
  }

  /** Cron watchdog entry point. Re-arms the alarm chain and runs one tick,
   *  but honors an operator pause: once /bot/stop sets paused=true the cron
   *  must not silently restart the bot. A fresh deploy has paused=false, so
   *  the bot still auto-starts on the first poke after a deploy. */
  private async watchdog(): Promise<void> {
    if (this.status.paused) return;
    await this.start();
    await this.tick();
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

  /**
   * 2b: react to a websocket push for one table by processing it immediately,
   * instead of waiting up to a full poll interval. Shares the tickInFlight
   * lock with the poll so a push-reaction and a scheduled tick can't both
   * fire selectCell on the same table (the 901 "not your turn" race). If the
   * lock is held we simply skip — the in-flight processing already has fresh
   * state, and the safety poll backstops anything missed. Realtime-only
   * (we only subscribe live realtime tables), so isRealtime=true.
   */
  private async reactToPush(tableId: string): Promise<void> {
    // Honor an operator pause: a paused/stopped bot must not play moves even
    // if a presence socket from before the stop is still delivering pushes.
    if (!this.client || !this.uid || this.tickInFlight || !this.status.running) return;
    const m = this.status.tables[tableId];
    if (!m || m.finished || m.conceded || m.gameserver == null) return;
    this.tickInFlight = true;
    try {
      console.log(`ws:react t=${tableId}`);
      // Honor a difficulty keyword before reacting: the move path locks the
      // difficulty window on the bot's first move, so a push-driven game must
      // process pending chat first or the opponent's level pick is lost.
      await this.pollAndReplyChat(tableId, m).catch(() => {});
      await this.maybePlayMove(tableId, m, true);
      await this.ctx.storage.put("tables", this.status.tables).catch(() => {});
    } catch (e) {
      this.recordError("pushReact", e, tableId);
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
    // BGA occasionally answers myTables with an HTML interstitial (rate
    // limit / session bounce) that the client parses to an EMPTY array
    // rather than throwing. An empty snapshot looks identical to "the bot
    // genuinely has no open tables", so on its own it can't bump the
    // reconcile counters. We pair it with the per-table getTableInfo
    // results below: if myTables was empty AND not a single live memo
    // resolved this tick, the whole snapshot is suspect and we skip the
    // miss bump (see SUSPECT_BLOCK handling in the reconcile loop).
    const myTablesEmpty = tables.length === 0;

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
    // Cheap pass first: GC memos that never reached live play and are old
    // enough to be definitively dead, without spending a network call. This
    // keeps the reconcile fetch set bounded to genuinely-active games so a
    // backlog of dead setups can't snowball into a per-tick getTableInfo
    // storm (the cause of ~30s ticks). See STALE_UNPLAYED_MS.
    const toReconcile: Array<[string, TableMemo]> = [];
    const staleUnplayed: string[] = [];
    for (const [id, m] of missing) {
      if (
        !m.saidHi
        && m.startedAt != null
        && Date.now() - m.startedAt > STALE_UNPLAYED_MS
      ) {
        m.finished = true;
        m.finishedAt = Date.now();
        staleUnplayed.push(id);
        continue;
      }
      toReconcile.push([id, m]);
    }
    // One summary entry rather than one-per-table: a backlog drain can GC
    // 100+ memos in a single tick and would otherwise flush the error log.
    if (staleUnplayed.length > 0) {
      this.recordError(
        "staleUnplayed",
        `GC'd ${staleUnplayed.length} memo(s) that never reached play (saidHi=false, >${
          STALE_UNPLAYED_MS / 60_000
        }m old): ${staleUnplayed.slice(0, 10).join(", ")}${
          staleUnplayed.length > 10 ? ", …" : ""
        }`,
      );
    }
    // Bounded-parallel reconcile for the remaining (potentially live) tables.
    // Phase 1: fetch each table; re-inject the live ones and collect the
    // misses WITHOUT bumping yet. We need the whole tick's resolution count
    // before we can tell a genuine vanish from a transient BGA block.
    let reconcileResolved = 0;
    const missedThisTick: Array<[string, TableMemo]> = [];
    for (let i = 0; i < toReconcile.length; i += RECONCILE_CONCURRENCY) {
      const batch = toReconcile.slice(i, i + RECONCILE_CONCURRENCY);
      await Promise.all(
        batch.map(async ([id, m]) => {
          const t = await this.client!.getTableInfo(id).catch(() => null);
          if (t) {
            m.reconcileMissCount = 0;
            tables.push(t);
            reconcileResolved++;
            return;
          }
          missedThisTick.push([id, m]);
        }),
      );
    }
    // Phase 2: a suspected snapshot block is myTables coming back empty AND
    // not a single getTableInfo resolving this tick, with at least two live
    // memos in play (one missing realtime table can't be distinguished from
    // a block, so it falls through to normal GC). When BGA wedges every
    // request for a tick, bumping all counters would poison the data and, at
    // RECONCILE_MISS_LIMIT, falsely GC every realtime game at once. Skip the
    // bump and log a single summary instead of one error per table.
    const suspectBlock =
      myTablesEmpty && reconcileResolved === 0 && missedThisTick.length >= 2;
    if (suspectBlock) {
      this.recordError(
        "reconcileSnapshotSuspect",
        `myTables returned empty and all ${missedThisTick.length} live memo lookup(s) failed this tick; treating as a transient BGA block and skipping reconcile-miss bump`,
      );
    } else {
      for (const [id, m] of missedThisTick) {
        m.reconcileMissCount = (m.reconcileMissCount ?? 0) + 1;
        // Realtime games GC after RECONCILE_MISS_LIMIT misses; async games
        // fail OPEN (never abandoned on a flake). See decideReconcileMiss.
        const decision = decideReconcileMiss(
          m.reconcileMissCount, m.realtime, RECONCILE_MISS_LIMIT,
        );
        if (decision.log) {
          this.recordError(
            "reconcileMiss",
            decision.reason === "fail-open-async"
              ? `Async table ${id} missing from myTables and getTableInfo for ${m.reconcileMissCount} ticks; leaving live (fail open, not abandoning)`
              : `Table ${id} missing from both myTables and getTableInfo for ${m.reconcileMissCount} ticks; marking finished`,
            id,
          );
        }
        if (decision.markFinished) {
          m.finished = true;
          m.finishedAt = Date.now();
        }
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
    // Sweep no-interaction orphan memos. getMemo() stamps a memo the moment
    // handleTable touches ANY snapshot table, but several handleTable paths
    // early-return before setting an interaction flag (reclaim seat, lost
    // seat, a freshly-created open-invite slot a human never joins). If such
    // a table then falls off the snapshot, the memo has acceptedSeat/
    // ackedStart/saidHi all false — so it matches neither the reconcile
    // `missing` filter (which REQUIRES an interaction flag) nor the
    // finished/conceded GC above, and leaks forever (e.g. table 857063590).
    // GC any orphan that's absent from the snapshot, never interacted, not a
    // currently-advertised open-invite slot, and older than STALE_UNPLAYED_MS.
    // A null startedAt (legacy memo) is stamped now so the grace clock starts
    // rather than GC'ing it blind on first sight.
    const openInviteIds = new Set(
      Object.values(this.status.openInvites)
        .map((s) => s.id)
        .filter((id): id is string => id != null),
    );
    const orphans: string[] = [];
    for (const id of Object.keys(this.status.tables)) {
      const m = this.status.tables[id];
      if (liveIds.has(id)) continue;
      if (m.finished || m.conceded) continue;
      if (m.acceptedSeat || m.ackedStart || m.saidHi) continue;
      if (openInviteIds.has(id)) continue;
      if (m.startedAt == null) { m.startedAt = Date.now(); continue; }
      if (Date.now() - m.startedAt > STALE_UNPLAYED_MS) {
        delete this.status.tables[id];
        orphans.push(id);
      }
    }
    if (orphans.length > 0) {
      this.recordError(
        "orphanSweep",
        `GC'd ${orphans.length} no-interaction orphan memo(s) (off-snapshot, never joined, >${
          STALE_UNPLAYED_MS / 60_000
        }m old): ${orphans.slice(0, 10).join(", ")}${
          orphans.length > 10 ? ", …" : ""
        }`,
      );
    }
    await this.putIfChanged("tables", this.status.tables);
    await this.putIfChanged("stats", this.status.stats);
    await this.putIfChanged("recentErrors", this.status.recentErrors);
    await this.putIfChanged("recentMoves", this.status.recentMoves);
    await this.putIfChanged("recentResults", this.status.recentResults ?? []);
    await this.putIfChanged("premiumNudges", this.status.premiumNudges ?? []);
    await this.putIfChanged("premiumClicks", this.status.premiumClicks ?? []);

    try { await this.maybeCreateOpenInvite(tables); }
    catch (e) { this.recordError("openInvite", e); }

    // Maintain the realtime presence socket (phase 2a). Never throws into
    // the tick — presence is best-effort and the poll loop above is the
    // source of truth for actually playing.
    try { await this.ensurePresence(tables); }
    catch (e) { this.recordError("ensurePresence", e); }

    // Bound the per-FEN move cache. Throttled so the list pass is negligible.
    if (Date.now() - this.lastCacheGcAt > MOVE_CACHE_GC_INTERVAL_MS) {
      this.lastCacheGcAt = Date.now();
      try { await this.gcMoveCache(); }
      catch (e) { this.recordError("gcMoveCache", e); }
    }
  }

  /**
   * Persist a status blob only when its serialized form changed since the
   * last write. The per-tick loop previously rewrote every blob every 5s
   * unconditionally; `recentResults` now carries per-game move logs that are
   * immutable once a game finishes, so re-writing it on every tick was pure
   * write amplification. We compare a cheap hash of the serialized value and
   * skip the storage write when it matches. JSON.stringify here is CPU-only
   * (cheap); the savings is the avoided storage write. Idle ticks (no live
   * games, no new moves/results) now write nothing.
   */
  private async putIfChanged(key: string, value: unknown): Promise<void> {
    const hash = djb2(JSON.stringify(value ?? null));
    if (this.persistHashes[key] === hash) return;
    await this.ctx.storage.put(key, value);
    this.persistHashes[key] = hash;
  }

  /**
   * Evict the oldest entries from the per-FEN move cache when it exceeds
   * MOVE_CACHE_CAP. The cache writes one `mc:<fen>` key per unique position
   * with no expiry, so without this it grows unbounded over the bot's
   * lifetime. Lists all cache keys, and if over the cap, deletes the oldest
   * (by stored ts) until back at the cap. Cheap enough to run hourly.
   */
  private async gcMoveCache(): Promise<void> {
    const entries = await this.ctx.storage.list<CachedMove>({ prefix: MOVE_CACHE_PREFIX });
    if (entries.size <= MOVE_CACHE_CAP) return;
    const sorted = [...entries.entries()].sort(
      (a, b) => (a[1]?.ts ?? 0) - (b[1]?.ts ?? 0),
    );
    const victims = sorted.slice(0, entries.size - MOVE_CACHE_CAP).map(([k]) => k);
    // storage.delete accepts up to 128 keys per call; chunk to stay under it.
    for (let i = 0; i < victims.length; i += 128) {
      await this.ctx.storage.delete(victims.slice(i, i + 128));
    }
    console.log(`bot:gcMoveCache evicted=${victims.length} kept=${MOVE_CACHE_CAP}`);
  }

  /**
   * Evict every move-cache entry whose verdict did NOT come from a
   * Stockfish/lichess source (isCacheableEngine). One-shot cleanup for legacy
   * entries written before the cache-write gate was tightened — e.g. a
   * js-chess-engine move cached when the remote race fully failed during a
   * grandmaster game, or a `random-fallback` slipping through an older gate.
   * After this runs (and the tightened write gate is deployed), every `mc:`
   * key is guaranteed to be a remote Stockfish/lichess verdict. Dry-run by
   * default; pass apply=true to actually delete. Returns a per-engine
   * breakdown of what stays vs goes.
   */
  private async purgeMoveCache(apply: boolean): Promise<{
    apply: boolean;
    total: number;
    kept: number;
    removed: number;
    keptByEngine: Record<string, number>;
    removedByEngine: Record<string, number>;
  }> {
    const entries = await this.ctx.storage.list<CachedMove>({ prefix: MOVE_CACHE_PREFIX });
    const keptByEngine: Record<string, number> = {};
    const removedByEngine: Record<string, number> = {};
    const victims: string[] = [];
    for (const [key, val] of entries) {
      const engine = val?.engine ?? "(missing)";
      if (isCacheableEngine(engine)) {
        keptByEngine[engine] = (keptByEngine[engine] ?? 0) + 1;
      } else {
        removedByEngine[engine] = (removedByEngine[engine] ?? 0) + 1;
        victims.push(key);
      }
    }
    if (apply) {
      // storage.delete accepts up to 128 keys per call; chunk to stay under it.
      for (let i = 0; i < victims.length; i += 128) {
        await this.ctx.storage.delete(victims.slice(i, i + 128));
      }
      console.log(
        `bot:purgeMoveCache removed=${victims.length} kept=${entries.size - victims.length}`,
      );
    }
    return {
      apply,
      total: entries.size,
      kept: entries.size - victims.length,
      removed: victims.length,
      keptByEngine,
      removedByEngine,
    };
  }

  /**
   * Keep a Centrifugo websocket open and subscribed to every LIVE realtime
   * table, so BGA registers the bot as present and doesn't neutralize it.
   * Realtime-only: async games don't need presence (90-day clocks) and stay
   * fully on polling. This does not move pieces — the poll loop does — it
   * only holds the connection and answers pings.
   *
   * Lifecycle: the socket lives on the DO instance across the 5s ticks. If it
   * drops (close/error) we null it and reconnect next tick. If no realtime
   * game is live we close it. Token + uid come from a live game page (same
   * extraction the probe validated).
   */
  private async ensurePresence(tables: RawTableInfo[]): Promise<void> {
    if (!this.client || !this.uid) return;
    const realtimeLive = tables.filter((t) => t.status === "play");

    // No realtime game → no presence needed; drop any open socket.
    if (realtimeLive.length === 0) {
      if (this.ws) {
        try { this.ws.close(); } catch { /* already closed */ }
        this.ws = null;
        this.wsChannels.clear();
      }
      return;
    }

    const want = new Set<string>(channelsFor(this.uid, realtimeLive.map((t) => t.id)));

    // (Re)connect when we have no socket.
    if (!this.ws) {
      const seed = realtimeLive[0];
      const gs = this.status.tables[seed.id]?.gameserver
        ?? await this.client.resolveGameserver(seed.id).catch(() => null);
      if (gs == null) return;
      let html: string;
      try { html = await this.client.fetchGamePage(gs, seed.id); }
      catch (e) { this.recordError("wsFetchPage", e, seed.id); return; }
      const auth = extractCentrifugeAuth(html);
      if (!auth || isVisitorId(auth.userId)) {
        this.recordError("wsAuth", "no/visitor centrifuge token", seed.id);
        return;
      }
      let ws: WebSocket;
      try { ws = await openCentrifugeSocket(); }
      catch (e) { this.recordError("wsConnect", e); return; }
      this.ws = ws;
      this.wsChannels = new Set();
      this.wsCmdId = 1;
      ws.addEventListener("message", (ev: MessageEvent) => {
        const text = typeof ev.data === "string" ? ev.data : "";
        for (const f of parseFrames(text)) {
          if (f.isPing) { try { ws.send("{}"); } catch { /* closed */ } continue; }
          // 2b fast path: a published event on a table channel means
          // something changed there (opponent moved, draw offered, …).
          // React immediately instead of waiting for the next poll. We treat
          // it as a wake signal — reactToPush re-fetches the page for the
          // authoritative state. Presence join/leave frames have no `pub`,
          // so they don't trigger this.
          if (f.push?.pub && typeof f.push.channel === "string") {
            const tm = /^\/table\/t(\d+)$/.exec(f.push.channel);
            if (tm) void this.reactToPush(tm[1]);
          }
        }
      });
      const drop = () => {
        if (this.ws === ws) { this.ws = null; this.wsChannels.clear(); }
      };
      ws.addEventListener("close", drop);
      ws.addEventListener("error", drop);
      const cmds: string[] = [JSON.stringify({
        connect: { data: { user_id: auth.userId, username: "bot_stockfish", credentials: auth.token }, name: "js" },
        id: this.wsCmdId++,
      })];
      for (const ch of want) {
        cmds.push(JSON.stringify({ subscribe: { channel: ch }, id: this.wsCmdId++ }));
        this.wsChannels.add(ch);
      }
      try { ws.send(cmds.join("\n")); }
      catch (e) { this.recordError("wsSend", e); drop(); return; }
      console.log(`ws:presence connected uid=${auth.userId} tables=${realtimeLive.map((t) => t.id).join(",")}`);
      return;
    }

    // Connected already → subscribe to any newly-live realtime tables.
    const fresh = [...want].filter((ch) => !this.wsChannels.has(ch));
    if (fresh.length > 0) {
      const cmds = fresh.map((ch) => {
        this.wsChannels.add(ch);
        return JSON.stringify({ subscribe: { channel: ch }, id: this.wsCmdId++ });
      });
      try { this.ws.send(cmds.join("\n")); }
      catch (e) { this.recordError("wsSub", e); }
    }
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
    chatMessage?: string,
  ): Promise<void> {
    if (!this.client || m.conceded) return;
    await this.sendChat(tableId, chatMessage ?? tr("concede", m.oppLanguage));
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
    this.recordNonResult(tableId, m, "conceded", reason);
  }

  /**
   * Record a NON-scored game into recentResults with tally "none" and a
   * `reason` code, so games that ended without a clean win/loss/draw (we
   * conceded, the opponent quit, we aborted, or a premium-gate void) surface
   * in the dashboard's troubleshooting table instead of vanishing into the
   * logs. Shares the cap/trim with scored results. Stats (wins/losses/draws)
   * are untouched — recomputeStats skips non-W/L/D entries.
   */
  private recordNonResult(
    tableId: string,
    m: TableMemo,
    status: string,
    reason: string,
  ): void {
    const now = Date.now();
    const entry: ResultEntry = {
      ts: now,
      tableId,
      status,
      rawScore: null,
      parsedScore: null,
      tally: "none",
      reason,
      durationMs: m.startedAt != null ? now - m.startedAt : undefined,
      moveCount: m.moveCount,
      engineCounts: m.engineCounts,
      botColor: m.botColor,
      oppName: m.oppName,
      oppId: m.oppId,
      difficulty: m.effectiveDifficulty ?? m.difficulty ?? "grandmaster",
      oppLanguage: m.oppLanguage,
      oppPremium: m.oppPremium,
      realtime: m.realtime,
    };
    if (!this.status.recentResults) this.status.recentResults = [];
    this.status.recentResults.push(entry);
    if (this.status.recentResults.length > RECENT_RESULTS_CAP) {
      this.status.recentResults.splice(
        0, this.status.recentResults.length - RECENT_RESULTS_CAP,
      );
    }
  }

  /** Append a premium nudge to the rolling log (trim to PREMIUM_LOG_CAP). */
  private recordPremiumNudge(n: PremiumNudge): void {
    if (!this.status.premiumNudges) this.status.premiumNudges = [];
    this.status.premiumNudges.push(n);
    if (this.status.premiumNudges.length > PREMIUM_LOG_CAP) {
      this.status.premiumNudges.splice(
        0, this.status.premiumNudges.length - PREMIUM_LOG_CAP,
      );
    }
  }

  /** Append a premium-link click (recorded by the worker's /go/premium) and
   *  persist immediately — this path runs outside the tick's persist cycle. */
  private async appendPremiumClick(c: PremiumClick): Promise<void> {
    if (!this.status.premiumClicks) this.status.premiumClicks = [];
    this.status.premiumClicks.push(c);
    if (this.status.premiumClicks.length > PREMIUM_LOG_CAP) {
      this.status.premiumClicks.splice(
        0, this.status.premiumClicks.length - PREMIUM_LOG_CAP,
      );
    }
    await this.ctx.storage.put("premiumClicks", this.status.premiumClicks);
  }

  /** Counted games so far (wins + losses + draws). Drives the gate-hold check. */
  private gamesPlayed(): number {
    const s = this.status.stats;
    return (s.wins ?? 0) + (s.losses ?? 0) + (s.draws ?? 0);
  }

  /**
   * Premium gate. The bot's playing time is the scarce resource: it has a
   * single realtime slot and can only sanely juggle so many async games, so
   * realtime and 2nd-or-later concurrent async games are reserved for BGA
   * Premium members. When a FREE member lands on one of those, send the
   * localized "upgrade to BGA Premium" nudge, log it (so we can show BGA, with
   * data, that the bot drives memberships), and mark the memo so we never
   * greet / move / tally it. Returns true when the table was blocked.
   *
   * The actual void (leaveTable → neutralized, NO win awarded) is DEFERRED by
   * PREMIUM_KICK_DELAY_MS so the bounced member has time to read the message
   * before the game vanishes — see maybeKickPremiumBlocked. We never block the
   * tick on a 30s sleep (that would freeze every other live game); the kick
   * fires on a later tick.
   *
   * Membership (`is_premium`) is only readable from the live game page, so the
   * earliest we can decide is the first play tick. Blocking here voids the game
   * before any move is played — the closest practical realization of "don't
   * start a game we shouldn't" given no pre-launch premium signal exists.
   *
   * Held OFF during the growth phase (isPremiumGateActive): until the bot has
   * played 10k counted games, this returns false for everyone.
   *
   * Fails OPEN: unknown membership (oppPremium === undefined) never blocks, so
   * a paying member is never wrongly turned away.
   */
  private async enforcePremiumGate(tableId: string, m: TableMemo): Promise<boolean> {
    if (!this.client) return false;
    // Already nudged: stay idempotent, and run the deferred void if it's due.
    // (Any table flagged before the gate was held off still finishes its kick.)
    if (m.premiumBlocked) {
      await this.maybeKickPremiumBlocked(tableId, m);
      return true;
    }
    // Growth-phase hold: the gate stays OFF until the bot is popular enough
    // (>= 10k counted games). Until then everyone plays unblocked — which also
    // avoids the disruptive realtime-kick path entirely.
    if (!isPremiumGateActive(this.gamesPlayed())) return false;
    const isRealtime = m.realtime === true;
    const secondaryAsync = !isRealtime
      && !!m.oppId
      && isSecondaryAsyncGame(this.status.tables, m.oppId, tableId);
    const reason = decidePremiumBlock({
      isRealtime,
      oppPremium: m.oppPremium,
      secondaryAsync,
    });
    if (!reason) return false;

    const mode: GateMode = isRealtime ? "realtime" : "async";
    const uid = m.oppId ?? "";
    const link = buildPremiumLink(uid, tableId, mode);
    const now = Date.now();
    let msg = tr("premiumGate", m.oppLanguage, { link });
    // For the 2nd-async block, point them at the one async game they may keep
    // (their oldest active async game with the bot), so they're not left
    // wondering where their allowed game went.
    if (reason === "async-limit") {
      const primaryId = primaryAsyncGameId(this.status.tables, uid);
      if (primaryId && primaryId !== tableId) {
        const gameLink = buildGameLink(primaryId);
        msg += " " + tr("premiumGateAsyncOther", m.oppLanguage, { gameLink });
      }
    }
    await this.sendChat(tableId, msg);
    this.recordPremiumNudge({
      ts: now, uid, name: m.oppName, tableId, mode, reason,
      lang: m.oppLanguage,
    });
    // Flag the memo now so we stop greeting/moving immediately, but DEFER the
    // void: the opponent gets PREMIUM_KICK_DELAY_MS to read the message, then
    // a later tick voids the table (maybeKickPremiumBlocked). We deliberately
    // do NOT set finished yet — the game is still live during the read window.
    m.premiumBlocked = true;
    m.premiumNudgedAt = now;
    const safeOpp = (m.oppName ?? "").replace(/\s+/g, "_") || "?";
    console.log(
      `bot:premiumGate ts=${new Date(now).toISOString()} t=${tableId} ` +
      `mode=${mode} reason=${reason} uid=${uid || "?"} opp=${safeOpp} ` +
      `lang=${m.oppLanguage ?? "en"} kickInMs=${PREMIUM_KICK_DELAY_MS}`,
    );
    return true;
  }

  /**
   * Deferred half of the premium gate: once PREMIUM_KICK_DELAY_MS has elapsed
   * since the nudge, void the table (leaveTable → neutralized, no win awarded)
   * and mark it finished so the per-tick GC drops the memo. No-op until the
   * read-grace window passes, and idempotent via premiumKicked so a table is
   * never left twice. Called every tick a premium-blocked table is still in
   * the snapshot.
   */
  private async maybeKickPremiumBlocked(tableId: string, m: TableMemo): Promise<void> {
    if (!this.client || m.premiumKicked) return;
    if (m.premiumNudgedAt == null) return; // nudge hasn't fired yet
    if (Date.now() - m.premiumNudgedAt < PREMIUM_KICK_DELAY_MS) return; // let them read it
    m.premiumKicked = true;
    // Void the table: neutralized=true, so neither side is awarded a win and
    // the game never counts. Best-effort — a failed leave still marks the memo
    // finished so we stop touching it.
    await this.client.leaveTable(tableId).catch((e) => {
      this.recordError("premiumLeave", e, tableId);
    });
    const now = Date.now();
    m.finished = true;
    m.finishedAt = now;
    // realtime games are blocked as "realtime-free"; async games (2nd+
    // concurrent) as "async-limit" — see decidePremiumBlock. m.realtime is
    // authoritative here, so we can recover the reason without storing it.
    const blockReason = m.realtime === true ? "realtime-free" : "async-limit";
    this.recordNonResult(tableId, m, "premium-blocked", `premium:${blockReason}`);
    console.log(
      `bot:premiumKick ts=${new Date(now).toISOString()} t=${tableId} ` +
      `afterMs=${now - m.premiumNudgedAt}`,
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
    // their gamemode. Covers two recovery cases:
    //   1. DO storage was cleared (restart) but BGA still has our tables.
    //   2. The slot was nulled mid-flight (older builds did this on the
    //      `oppSeated` transient, then lost the table when opp left) and
    //      the table sits orphaned in BGA's records, blocking every future
    //      createTable with "you are already at a real-time table".
    // inviteSlotModeOf (not gamemodeOf) maps `setup`/`init` to "realtime",
    // so a bot-owned table in the brief setup transitional state is also
    // re-adopted into the realtime slot and can be cleaned up by the
    // setup-timeout path below.
    for (const t of myJoinable) {
      const mode = inviteSlotModeOf(t.status);
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
          const oppSeated = !!t.players
            && Object.keys(t.players).some((pid) => pid !== this.uid);
          if (actualMode === null) {
            // Transient init/setup status — BGA hasn't promoted the
            // table to open/asyncopen yet. Within the 15-min launch
            // window, do nothing so handleTable's launch handshake can
            // drive the table to play (including when oppSeated — that
            // means a real realtime game is being launched and a
            // leaveTable here would silently quit it). Past 15 min the
            // launch is genuinely stuck: opp ghosted between Join and
            // Accept, or BGA wedged the table mid-handshake. Without an
            // escape the table holds the realtime slot indefinitely and
            // blocks every future createTable ("you are already at a
            // real-time table about to start"). Abort regardless of
            // oppSeated.
            const age = now - (slot.createdAt ?? now);
            if (age <= OPEN_INVITE_SETUP_TIMEOUT_MS) continue;
            this.recordError(
              `setupTimeout:${mode}`,
              `table stuck in ${t.status} for ${Math.round(age / 60_000)}m${oppSeated ? " (opp seated)" : ""}`,
              slot.id,
            );
            await this.client.leaveTable(slot.id).catch(() => {});
          } else {
            // Confirmed wrong mode (e.g. realtime demoted to async).
            // Never leave a wrong-mode table with an opp already seated:
            // they joined a real game and leaving would silently quit
            // it. Just keep the slot parked; status will move to
            // play/finished on its own and clear the slot below.
            if (oppSeated) continue;
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
        // BGA refuses a second realtime table while one is already launching
        // ("about to start") or mid-game — expected during the window between
        // an opponent joining our invite and the game reaching `play`. The
        // per-mode cooldown (lastAttempt, set above) is already armed, so just
        // back off quietly instead of flooding recentErrors ~1/min. Genuine
        // faults (HTML error pages, auth loss) still get recorded.
        if (isBenignCreateTableError(String(e))) {
          console.log(`createTable ${mode} deferred — already at a realtime table`);
        } else {
          this.recordError(`createTable:${mode}`, e);
        }
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
    // Friendly-only enforcement — the prime directive. The bot only ever
    // creates Training-mode (friendly, no-ELO) tables itself, so tables it
    // owns are trusted. For ANY other table (an invite from another player)
    // we fail CLOSED: play only when BGA carries a positive friendly signal.
    // Training mode hides the ranking (game_hide_ranking="1"), or the table
    // is explicitly unranked (unranked="1"). If neither signal is present —
    // including when BGA omits the fields entirely — skip the table rather
    // than risk playing a ranked / ELO-affecting game. (Recon shows a
    // friendly Training table reports unranked="0" but game_hide_ranking="1",
    // so the hide-ranking flag is the reliable friendly marker — the old
    // `unranked==="0" && game_hide_ranking==="0"` check failed open whenever
    // BGA omitted either field.)
    if (!this.uid || t.table_creator !== this.uid) {
      const friendly = raw.game_hide_ranking === "1" || raw.unranked === "1";
      if (!friendly) return true;
    }
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
    // A premium-blocked table was already nudged; never greet/move/tally it.
    // The void is deferred so the member can read the nudge, so keep driving
    // the kick each tick — it fires once the read-grace window passes, then
    // the per-tick GC drops the memo.
    if (m.premiumBlocked) {
      await this.maybeKickPremiumBlocked(t.id, m);
      return;
    }

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
      await this.concedeTable(t.id, m, "tableAge", tr("oldGameConcede", m.oppLanguage)).catch((e) => {
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
        if (seat.fullname) { m.oppName = seat.fullname; m.oppId = pid; break; }
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

    // 2. Launch handshake. IMPORTANT: everything past the asyncopen branch
    //    is REALTIME-ONLY and deliberately walled off from async so that
    //    realtime fixes can't touch the (working) async path:
    //      - Async games only ever sit in `asyncopen` here, handled in the
    //        first branch, then auto-progress to `asyncplay`. They never
    //        need a launch or a ready handshake.
    //      - The realtime branch additionally only fires once a human is
    //        actually seated (`oppSeated`). A freshly-created table of
    //        EITHER mode can momentarily report `init`/`setup` with no
    //        opponent; that guard keeps the realtime launch logic from ever
    //        running against such a table (including a nascent async one).
    if (isJoinableStatus(t.status)) {
      if (t.status === "asyncopen") {
        // ASYNC: nothing to launch; BGA promotes asyncopen → asyncplay.
        m.ackedStart = true;
        return;
      }
      // REALTIME (open / setup / init): drive the launch handshake to "play"
      // in ONE tight sequence instead of one step per 5s poll. The old
      // step-per-tick flow stacked start→setup→play across ~3 ticks (~15-30s)
      // so a joining human thought the bot was dead. Here the host launches
      // (startgame.html), then we poll the table ~1s cadence, sending
      // acceptGameStart whenever BGA parks it in the setup/ack phase, until
      // it reaches "play" — usually 1-3s. Capped so we never hold the tick
      // (and thus other games) for long; if it doesn't finish, the next tick
      // resumes (ackedStart only latches once we've actually launched).
      const oppSeated = Object.keys(t.players ?? {}).some((pid) => pid !== this.uid);
      if (oppSeated) {
        const launchStep = async (status: string): Promise<void> => {
          if (status === "open" && t.table_creator === this.uid) {
            await this.client!.startTable(t.id).catch((e) => this.recordError("startTable", e, t.id));
          } else if (status !== "open" && isJoinableStatus(status)) {
            await this.client!.acceptGameStart(t.id).catch(() => {});
          }
        };
        await launchStep(t.status);
        // Bound the inline handshake by wall-clock, not a fixed iteration
        // count: this whole block runs inside the tick's per-table loop while
        // tickInFlight is held, so every second spent here is a second other
        // live games can't move and websocket push reactions are dropped. A
        // ~3s budget catches the common 1-3s launch; anything slower resumes
        // on the next tick (ackedStart only latches once we reach `play`).
        const LAUNCH_POLL_INTERVAL_MS = 600;
        const LAUNCH_MAX_WAIT_MS = 3_000;
        const deadline = Date.now() + LAUNCH_MAX_WAIT_MS;
        let launched = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, LAUNCH_POLL_INTERVAL_MS));
          const cur = await this.client.getTableInfo(t.id).catch(() => null);
          if (!cur) continue;
          if (isLivePlayStatus(cur.status)) { launched = true; break; }
          if (!isJoinableStatus(cur.status)) break; // finished/aborted — stop
          await launchStep(cur.status);
        }
        if (launched) {
          m.ackedStart = true;
          console.log(`ws:realtime launched fast t=${t.id}`);
        }
      }
      return;
    }

    // 3. in play (realtime "play" or turn-based "asyncplay")
    if (isLivePlayStatus(t.status)) {
      // Record the gamemode from the authoritative live status the first time
      // we see it. The terminal status can't be trusted for this (async games
      // often roll straight to `archive`), so capture it while it's unambiguous.
      if (m.realtime == null) m.realtime = t.status === "play";
      // Async games never went through the ackedStart branch above.
      if (!m.ackedStart) m.ackedStart = true;
      // resolve gameserver number once we're live
      if (m.gameserver == null) {
        const gs = await this.client.resolveGameserver(t.id).catch(() => null);
        if (gs != null) m.gameserver = gs;
      }
      // Greet once. Detect the opponent's interface language from the game
      // page first so the greeting (and every later message) is in their
      // language. Deferred until gameserver resolves so we can fetch the
      // page; one extra fetch per game is negligible.
      if (!m.saidHi && m.gameserver != null) {
        try {
          const html = await this.client.fetchGamePage(m.gameserver, t.id);
          this.refreshOpponent(m, html);
        } catch { /* fall back to English */ }
        // Premium gate runs BEFORE the greeting: a free member bounced off a
        // limited resource gets the upgrade nudge, not a "good luck" opener.
        if (await this.enforcePremiumGate(t.id, m)) return;
        await this.maybeGreet(t.id, m, t.status === "play");
      }

      // chat-reply
      await this.pollAndReplyChat(t.id, m).catch(() => {});

      // Accept a "Propose to abandon the game collectively" proposal: it ends
      // the game with no draw score, so it doesn't skew stats. This is the
      // table-level decision blob (`globalThis.gameui.decision`), which only
      // ever carries `abandon` — a draw offer is a chess gamestate (id 5),
      // handled (and declined) in maybePlayMove, not here. If a `draw` ever
      // does surface in the decision blob, refuse it (decision=0); we never
      // accept a draw. `acceptedAbandon` is the legacy field name — kept to
      // avoid migrating stored memos.
      if (!m.acceptedAbandon && m.gameserver != null) {
        try {
          const pending = await this.pollPendingDecision(t.id, m.gameserver);
          if (pending === "abandon") {
            await this.client.decide(t.id, "abandon", 1, m.gameserver);
            m.acceptedAbandon = true;
          } else if (pending === "draw") {
            await this.client.decide(t.id, "draw", 0, m.gameserver);
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
    // Archive of a game we never actually played (joined but it died in
    // setup / opponent declined, so saidHi was never set). Mark it finished
    // with no GG and no tally, purely so the per-tick GC drops the memo.
    // Without this these memos are re-fetched via getTableInfo every single
    // tick forever — the source of the 100+ stale-memo backlog and its
    // getTableInfo storm. An archived table is definitively over (an active
    // game is "play"/"asyncplay"), so this can't drop a live game.
    if (t.status === "archive" && !m.saidHi) {
      if (!m.finished) {
        m.finished = true;
        m.finishedAt = Date.now();
      }
      return;
    }
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
        // If our score reads as a loss (0) but the opponent's score is missing
        // from this snapshot, the friendly-draw quirk (BGA reporting 0/0
        // instead of 0.5/0.5) would be misclassified as a loss. Re-fetch the
        // authoritative per-table info once to backfill the opponent's score
        // before tallying — this closes the live-path window that previously
        // had to be repaired retroactively via /bot/reconcile-results.
        if (score === 0 && oppRawScore == null && this.client) {
          const ti = await this.client.getTableInfo(t.id).catch(() => null);
          if (ti?.players) {
            for (const [pid, seat] of Object.entries(ti.players)) {
              if (pid === this.uid) continue;
              if (seat.score != null) { oppRawScore = String(seat.score); break; }
            }
          }
        }
        const oppScore = oppRawScore == null ? null : Number(oppRawScore);
        const mutualZero = score === 0 && oppScore === 0;
        let tally: ResultEntry["tally"] = "none";
        if (score === 1) { this.status.stats.wins++; tally = "win"; }
        else if (score === 0.5 || mutualZero) { this.status.stats.draws++; tally = "draw"; }
        else if (score === 0) { this.status.stats.losses++; tally = "loss"; }
        const tallyDifficulty = m.effectiveDifficulty ?? m.difficulty ?? "grandmaster";
        if (tally !== "none") {
          if (!this.status.stats.byDifficulty) this.status.stats.byDifficulty = emptyDifficultyTally();
          const bucket = this.status.stats.byDifficulty[tallyDifficulty]
            ?? (this.status.stats.byDifficulty[tallyDifficulty] = { wins: 0, losses: 0, draws: 0 });
          if (tally === "win") bucket.wins++;
          else if (tally === "draw") bucket.draws++;
          else if (tally === "loss") bucket.losses++;
        }
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
          durationMs: m.startedAt != null ? Date.now() - m.startedAt : undefined,
          moveCount: m.moveCount,
          engineCounts: m.engineCounts,
          botColor: m.botColor,
          oppName: m.oppName,
          oppId: m.oppId,
          difficulty: tallyDifficulty,
          oppLanguage: m.oppLanguage,
          oppPremium: m.oppPremium,
          // Prefer the gamemode captured during live play (authoritative);
          // fall back to the terminal status only for legacy memos that
          // finished before m.realtime was recorded. `archive` is ambiguous,
          // so it resolves to undefined rather than guessing realtime.
          realtime: m.realtime ?? (t.status === "finished" ? true
            : t.status === "asyncfinished" ? false : undefined),
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
      // Best-effort: capture the full move log so historical games can be
      // replayed/re-analyzed offline (derive the FEN at any ply). Runs
      // outside the !m.finished gate so it can retry on later ticks — BGA's
      // archive log can lag a few seconds behind the finished flip. The
      // memo lingers (and is revisited) until BGA drops the table from the
      // polled list, giving us a retry window; we bound attempts so a
      // permanently-missing log can't re-fetch every tick.
      if (
        this.client
        && !m.movesCaptured
        && (m.moveCaptureAttempts ?? 0) < MOVE_CAPTURE_MAX_ATTEMPTS
      ) {
        m.moveCaptureAttempts = (m.moveCaptureAttempts ?? 0) + 1;
        try {
          const log = await this.client.getGameLog(t.id);
          if (log != null) {
            const { uci, finalFen } = reconstructMoves(parseGameLog(log));
            if (uci.length > 0) {
              const rec = this.status.recentResults?.find((r) => r.tableId === t.id);
              if (rec) {
                rec.moves = uci;
                if (finalFen) rec.finalFen = finalFen;
              }
              m.movesCaptured = true;
            }
          }
        } catch (e) {
          this.recordError("movelog", e, t.id);
        }
      }
      if (!m.saidGg) {
        await this.sendChat(t.id, tr("closing", m.oppLanguage));
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
      .filter((h) => h.type == null || h.type === "tablechat" || h.type === "chat")
      // Ascending id order so the per-message cursor advance below never
      // skips an unanswered message when a mid-loop send fails.
      .sort((a, b) => Number(a.id) - Number(b.id));
    for (const h of fresh) {
      // Difficulty command: an exact, case-insensitive match of a single
      // keyword, accepted at any point in the game so the opponent can
      // dial the bot up or down mid-match. Anything else (including
      // keywords embedded in a sentence) is treated as untrusted chatter
      // and gets the canned reply — this keeps the injection surface a
      // closed enum rather than free text.
      const word = String(h.msg ?? "").trim().toLowerCase();
      const isCmd = word === "grandmaster" || word in DIFFICULTY_LEVELS;
      let reply = tr("chatReply", m.oppLanguage);
      if (isCmd) {
        if (word === "grandmaster") {
          // Store explicitly (not undefined) so an opponent who re-selects
          // grandmaster after dialing down sticks there even though it
          // matches the default.
          m.difficulty = "grandmaster";
          reply = tr("difficultyGrandmaster", m.oppLanguage);
        } else {
          m.difficulty = word;
          reply = tr("difficultySet", m.oppLanguage, { level: word, elo: DIFFICULTY_ELO[word] });
        }
      }
      // If the send fails, stop here WITHOUT advancing past this message so it
      // (and only messages from here on) is retried next tick. Advancing the
      // cursor per successfully-answered message means a transient mid-loop
      // failure no longer re-sends replies to messages we already answered.
      if (!(await this.sendChat(tableId, reply))) return;
      m.lastSeenChatId = Number(h.id);
    }
    m.lastSeenChatId = maxId;
  }

  private async maybePlayMove(
    tableId: string, m: TableMemo, isRealtime: boolean,
  ): Promise<void> {
    if (!this.client || m.gameserver == null) return;
    const html = await this.client.fetchGamePage(m.gameserver, tableId);
    // Keep the opponent's id/name/language fresh from the authoritative game
    // page (greeting-time detection can miss it if the lobby snapshot hadn't
    // resolved the seat yet, and it corrects stale names after a rename).
    this.refreshOpponent(m, html);
    // Premium gate before greet/move — but ONLY up to first contact (!saidHi),
    // so it applies to games we haven't greeted yet (new joins) and never
    // disrupts a game already in progress. handleTable's live-play branch also
    // gates (likewise !saidHi), but a fast realtime game is often driven
    // entirely by websocket push reactions (reactToPush → here) which bypass
    // that branch, so without this a new free member could slip past the gate
    // and get played. A blocked game keeps saidHi=false (we bounce before
    // greeting), so the deferred void still gets driven here on the push path.
    if (!m.saidHi && await this.enforcePremiumGate(tableId, m)) return;
    // Greet from the common move path too. handleTable's live-play branch
    // also greets, but a fast realtime game is often driven entirely by
    // websocket push reactions (reactToPush → here) which bypass that
    // branch, so without this the opener never gets sent.
    await this.maybeGreet(tableId, m, isRealtime);
    const parsed = parseGameHtml(html);
    if (!parsed) {
      m.lastMoveAttempt = { ts: Date.now(), result: "no-parse" };
      return;
    }
    // Reset the draw-decline chat latch once the game is no longer in the
    // draw-offer state, so a later, distinct offer notifies the opponent again.
    if (parsed.gamestateId !== 5) m.saidDrawDecline = false;

    // Opponent quit detection (both realtime AND async). BGA sets `zombie:1` /
    // `neutralized_player_id` when a player has left/timed out. These flags
    // also flip transiently on reconnects/bookkeeping, so we require the
    // signal to PERSIST for OPP_QUIT_CONFIRM_MS before acting (a momentary
    // blip must never throw a live game — that was the old "bot quit my game
    // the moment I joined" bug). Once confirmed: friendly games have no rating
    // penalty, so we quit too rather than sit on a dead game — freeing the
    // single realtime slot, or (for async) cleaning the table up immediately
    // instead of waiting out the 15-min inactivity timer / 30-day age sweep /
    // BGA's own end-of-game sweep.
    if (this.uid) {
      let reason = "";
      // "0" is BGA's "nobody neutralized" sentinel — never treat it as a real
      // player id (defense-in-depth; parseGameHtml also drops it).
      if (parsed.neutralizedPlayerId && parsed.neutralizedPlayerId !== "0" && parsed.neutralizedPlayerId !== this.uid) {
        reason = `neutralized=${parsed.neutralizedPlayerId}`;
      } else if (parsed.zombieByPlayer) {
        const z = Object.entries(parsed.zombieByPlayer)
          .find(([pid, v]) => pid !== this.uid && Number(v) === 1);
        if (z) reason = `zombie=${z[0]}`;
      }
      if (reason) {
        if (!m.oppQuitSince) {
          m.oppQuitSince = Date.now();
          this.recordError(
            "oppFlagged",
            `${reason} botUid=${this.uid} mode=${isRealtime ? "realtime" : "async"} zombie=${JSON.stringify(parsed.zombieByPlayer ?? {})}; will concede if it persists ${OPP_QUIT_CONFIRM_MS / 1000}s`,
            tableId,
          );
        } else if (Date.now() - m.oppQuitSince >= OPP_QUIT_CONFIRM_MS) {
          const secs = Math.round((Date.now() - m.oppQuitSince) / 1000);
          this.recordError(
            "oppQuit",
            `${reason} persisted ${secs}s (${isRealtime ? "realtime" : "async"}); conceding — opponent quit, friendly game, no penalty`,
            tableId,
          );
          await this.concedeTable(tableId, m, "oppQuit", tr("oppQuit", m.oppLanguage)).catch((e) => {
            this.recordError("oppQuitConcede", e, tableId);
          });
          return;
        }
      } else if (m.oppQuitSince) {
        m.oppQuitSince = null;
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
      const moved: Array<{ pid: string; from: string; to: string; type: string; color: string }> = [];
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
            color: c.piece_color,
          });
        }
      }
      const pick = moved.find((mv) => mv.type === "king") ?? moved[0];
      if (pick && (pick.from !== m.lastMoveFrom || pick.to !== m.lastMoveTo)) {
        m.lastMoveFrom = pick.from;
        m.lastMoveTo = pick.to;
      }
      // Authoritative "opponent has replied" signal: any opponent-colored
      // piece changed squares since our last observation. BGA's table HTML
      // lags a few seconds after our selectCell (still echoing our turn), and
      // a fast opponent can reply between two of our ticks — so the lag-based
      // awaitingOppMove flag would otherwise stay pinned for the full
      // AWAITING_OPP_TTL_MS even though it's genuinely our turn again. Their
      // pieces only move when they move, so this clears the flag the instant
      // we see it, letting the bot (and websocket push reactions) respond
      // immediately instead of waiting out the TTL.
      if (m.awaitingOppMove && m.botColor) {
        const oppColor = m.botColor === "white" ? "black" : "white";
        if (moved.some((mv) => mv.color === oppColor)) {
          m.awaitingOppMove = false;
          m.awaitingOppSince = null;
        }
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
      // Realtime only: if the opponent has been on THIS turn (since their
      // last move) for OPPONENT_INACTIVITY_LIMIT_MS without moving, treat it
      // as an abandonment and concede to free the one realtime slot. The
      // timer resets the moment they move (ourTurn → cleared above), so this
      // is "15m since we've been waiting on their move", never since game
      // start. This is the one allowed exception to "don't quit a live game"
      // — 15m of dead silence in realtime is a genuine ghost.
      const now = Date.now();
      if (!m.opponentTurnSince) {
        m.opponentTurnSince = now;
      } else if (now - m.opponentTurnSince >= OPPONENT_INACTIVITY_LIMIT_MS) {
        const mins = Math.round((now - m.opponentTurnSince) / 60_000);
        this.recordError(
          "opponentInactivity",
          `opponent on their turn ${mins}m without moving (limit ${OPPONENT_INACTIVITY_LIMIT_MS / 60_000}m); conceding`,
          tableId,
        );
        await this.concedeTable(tableId, m, "opponentInactivity", tr("opponentTimeout", m.oppLanguage)).catch((e) => {
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

    // Draw-decline gate. gamestate.id === 5 (`playerAgreeToDraw`) means the
    // opponent offered a draw and BGA is blocking on our answer (state 5's
    // possibleactions are agree/decline; there are no piece destinations, so
    // without this the bot falls through to "no-dests" and the offer sits
    // forever). The bot NEVER accepts a draw — agreeing records as 0.5/0.5
    // and skews the win/loss stats — so we send the `decline` chess action
    // and tell the opponent how to end the game cleanly instead (resign, or
    // propose a collective abandon, which we DO accept since it carries no
    // draw score). wakeup nudges BGA the same way a move does.
    if (parsed.gamestateId === 5) {
      // Refuse via the chess `declineDraw` action (endpoint confirmed from a
      // captured browser request). The bot never accepts a draw — it records
      // as 0.5/0.5 and skews the win/loss stats. declineDraw() throws on a
      // non-2xx / rejected ack; we catch so a transient failure neither
      // concedes a likely-winning game nor spams.
      let declined = false;
      try {
        await this.client.declineDraw(m.gameserver, tableId);
        declined = true;
      } catch (e) {
        this.recordError("declineDraw", e, tableId);
      }
      await this.client.wakeup(m.gameserver, tableId).catch(() => {});
      if (declined) {
        // Explain the decline once per offer. Gated on saidDrawDecline
        // (cleared when the game leaves the draw state) so a draw that stays
        // pending across ticks, or a retry, doesn't spam the same message.
        if (!m.saidDrawDecline) {
          await this.sendChat(tableId, tr("drawDecline", m.oppLanguage));
          m.saidDrawDecline = true;
        }
        m.lastMoveAttempt = {
          ts: Date.now(), result: "declined-draw", activePlayer: parsed.activePlayer,
        };
        console.log(`t=${tableId} declined draw`);
      } else {
        // Could not decline (endpoint not yet confirmed). DON'T concede a
        // likely-winning game over a draw offer — just record and retry next
        // tick. The decision blob path (handleTable) also attempts a decline
        // if the draw surfaces there.
        m.lastMoveAttempt = {
          ts: Date.now(), result: "decline-draw-failed", activePlayer: parsed.activePlayer,
        };
        console.log(`t=${tableId} FAILED to decline draw (endpoint unconfirmed)`);
      }
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
        // Rethrow so handleTable's catch counts this toward the table's
        // error budget. A move/promote that BGA keeps rejecting otherwise
        // loops on our turn forever (errorCount never climbs, opponent-
        // inactivity never fires because it's our turn) and pins the slot.
        throw e;
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

    // Skip-on-neutralized guard. When the opponent has been flagged
    // neutralized/zombie (abandoned or timed out), BGA can freeze the turn
    // mid-position — sometimes in an *illegal* state (e.g. the bot is in
    // check yet it's marked our turn). Every engine rejects the illegal FEN,
    // and in difficulty mode there's no remote race to fall back on, so we'd
    // otherwise drop to a random legal move and shovel garbage into a dead
    // game throughout the OPP_QUIT_CONFIRM_MS concede grace (that's the "3
    // random moves" failure). Don't move at all: the neutralized block above
    // sets/clears m.oppQuitSince each tick and will concede the table once
    // the flag persists. parseGameNeutralized is a direct HTML read kept as
    // defense-in-depth (catches game_result_neutralized that parsed misses).
    if (shouldSkipMoveForNeutralized(m.oppQuitSince, html)) {
      m.lastMoveAttempt = {
        ts: Date.now(), result: "skip-opp-neutralized",
        activePlayer: parsed.activePlayer,
      };
      console.log(`t=${tableId} skip move — opponent flagged neutralized/abandoned`);
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
    // Both gamemodes default to full grandmaster Stockfish (the remote race)
    // — the bot is named bot_stockfish, so Stockfish is the expected default
    // and opponents must opt down via a chat keyword. The grandmaster race
    // can take up to ~5s/move; realtime friendly clocks tolerate that.
    const effectiveDifficulty = m.difficulty ?? "grandmaster";
    m.effectiveDifficulty = effectiveDifficulty;
    // useDifficulty = play the local js-chess-engine at a level; otherwise
    // grandmaster = the remote race.
    const useDifficulty = effectiveDifficulty !== "grandmaster"
      && effectiveDifficulty in DIFFICULTY_LEVELS;
    // Engine evals (chess-api.com, lichess-cloud-eval, stockfish.online) are
    // all reported from White's perspective. Flip the sign when the bot plays
    // Black so every stored cp/mate is bot-relative (positive = bot winning),
    // matching what the dashboard and move log claim. Applied once at
    // ingestion; cache writes below store the already-normalized value, so
    // cache-hit reads need no further flip.
    const toBotEval = (v: number | null | undefined): number | null | undefined =>
      v == null ? v : (ourColor === "black" ? -v : v);
    const fen = buildFen(parsed.pieces, ourColor, parsed.destinationsByPiece);
    // Use the engine-grade FEN (correct castling rights) for the cache
    // and snapshot. The per-tick path above already wrote a placement
    // snapshot; overwrite with the more accurate one now.
    m.lastBoardFen = fen;

    let chosen: { pieceId: string; dest: Destination } | null = null;
    let engineSource = "unknown";
    let engineResults: EngineAltEntry[] | undefined;
    let engineErr: string | undefined;
    // Set when the repetition guard swapped off the top engine move (or
    // bypassed the cache) to dodge a threefold. Used to skip the cache WRITE
    // below: the deviation is game-specific (depends on this table's
    // posHistory), so caching it would pollute the shared cache with a
    // context-bound pick. The cache must keep holding the true best move.
    let avoidedRepetition = false;
    const history = m.posHistory ?? [];
    const completesThreefold = (pieceId: string, dest: Destination): boolean => {
      const placement = placementAfterMove(parsed.pieces, pieceId, dest);
      return placement != null
        && history.filter((p) => p === placement).length >= 2;
    };

    // Cache lookup: identical FENs across games reuse a prior engine
    // verdict. lookupUciMove still validates against the current legal
    // table so a cached move BGA no longer accepts falls through to a
    // fresh engine race.
    // The shared FEN cache holds grandmaster-grade verdicts, so skip it
    // entirely for difficulty-limited games — both reading (don't serve a
    // strong move to a beginner) and writing (don't pollute the cache with
    // weak js-chess-engine moves that grandmaster games would then reuse).
    const cacheKey = `${MOVE_CACHE_PREFIX}${fen}`;
    const cached = useDifficulty
      ? undefined
      : await this.ctx.storage.get<CachedMove>(cacheKey).catch(() => undefined);
    if (cached) {
      const cachedChosen = lookupUciMove(cached.move, parsed.pieces, parsed.destinationsByPiece);
      if (cachedChosen) {
        // The cache is the engine of the repetition bug: it hands back the
        // same move for a recurring placement. If replaying it would complete
        // a threefold AND the bot is winning (a draw would throw the edge
        // away), bypass the cache so the engine race below can offer
        // alternatives the guard can pick from. When even/losing, take it —
        // the draw is fine.
        const cacheWinning = (cached.mate != null && cached.mate > 0)
          || (cached.cp != null && cached.cp >= REPETITION_AVOID_EVAL);
        if (cacheWinning && completesThreefold(cachedChosen.pieceId, cachedChosen.dest)) {
          avoidedRepetition = true;
        } else {
          chosen = cachedChosen;
          engineSource = `cache:${cached.engine}`;
          if (cached.cp != null || cached.mate != null) {
            m.lastEval = { cp: cached.cp, mate: cached.mate, engine: cached.engine, ts: Date.now() };
          }
        }
      }
    }

    if (!chosen) {
      try {
        const result = await this.askEngine(fen, useDifficulty ? DIFFICULTY_LEVELS[effectiveDifficulty] : undefined);
        if (result) {
          engineResults = result.alternatives;
          // Candidate list best-first: the race winner, then the other
          // engines' moves in precedence order (alternatives is already
          // precedence-sorted). chooseRepetitionAwareMove resolves each
          // against BGA's legal table, skips unresolvable ones, and — when
          // the bot is winning — returns the best move that doesn't complete
          // a threefold (falling back to the top pick if every move repeats).
          const candidates: MoveCandidate[] = [];
          if (result.move) candidates.push({ uci: result.move, engine: result.engine });
          for (const alt of result.alternatives ?? []) {
            if (!alt.move || alt.error || alt.engine === result.engine) continue;
            candidates.push({ uci: alt.move, engine: alt.engine });
          }
          // avoidDraw only when the bot is clearly ahead — otherwise a draw is
          // an acceptable (or, when behind, welcome) result and we keep the
          // engine's top move. Eval is White-relative off the wire; normalize
          // to bot-relative via toBotEval before comparing.
          const winner = result.alternatives?.find((a) => a.engine === result.engine);
          const winnerCp = toBotEval(winner?.eval);
          const winnerMate = toBotEval(winner?.mate);
          const avoidDraw = (winnerMate != null && winnerMate > 0)
            || (winnerCp != null && winnerCp >= REPETITION_AVOID_EVAL);
          const pick = chooseRepetitionAwareMove(
            candidates, parsed.pieces, parsed.destinationsByPiece, history, avoidDraw,
          );
          if (pick) {
            chosen = { pieceId: pick.pieceId, dest: pick.dest };
            engineSource = pick.engine;
            if (pick.avoidedRepetition) avoidedRepetition = true;
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

    // Resolve eval/think info for the move record up front (pure reads off
    // the parsed page) but DON'T mutate persisted/logged state yet — see the
    // selectCell ordering note below. For an engine race we pull eval/think
    // from the winning alt; on a cache hit there's no winnerAlt, so fall back
    // to the cached cp/mate (no thinkMs since no engine ran).
    const winnerAlt = engineResults?.find((r) => r.engine === engineSource);
    let moveCp: number | undefined;
    let moveMate: number | null | undefined;
    let moveThinkMs: number | undefined;
    if (winnerAlt) {
      moveCp = toBotEval(winnerAlt.eval) ?? undefined;
      moveMate = toBotEval(winnerAlt.mate) ?? null;
      moveThinkMs = winnerAlt.ms;
    } else if (engineSource.startsWith("cache:") && cached) {
      moveCp = cached.cp;
      moveMate = cached.mate ?? null;
    }
    const isCapture = (chosen.dest.captured?.length ?? 0) > 0;
    const movedPiece = parsed.pieces[chosen.pieceId];

    // Send the move FIRST, and only record/cache/advance state once BGA
    // accepts it. Recording before selectCell inflated recentMoves,
    // moveCount, engineUses, the gallery eval, and the move cache with moves
    // BGA rejected — and since a rejected move is retried every tick until
    // MAX_TABLE_ERRORS, each dead game polluted those by up to 3 phantom
    // entries before conceding.
    try {
      await this.client.selectCell(m.gameserver, tableId, chosen.dest.dest_x, chosen.dest.dest_y, chosen.pieceId);
    } catch (e) {
      m.lastMoveAttempt = {
        ts: Date.now(), result: "select-cell-failed",
        activePlayer: parsed.activePlayer, err: String(e).slice(0, 200),
      };
      this.recordError("selectCell", e, tableId);
      // Rethrow so handleTable's catch counts this toward the table's error
      // budget (MAX_TABLE_ERRORS → concede). Swallowing it here let a table
      // whose moves BGA persistently rejects spin on our turn indefinitely.
      throw e;
    }

    // --- move confirmed by BGA: now safe to record + cache + advance state.

    // Snapshot the engine eval for the gallery view. Pull from whichever
    // engine produced the chosen move so the displayed eval matches the
    // move that was played. cp is in pawns, normalized via toBotEval so
    // positive = bot winning regardless of which color the bot plays.
    if (winnerAlt && (winnerAlt.eval != null || winnerAlt.mate != null)) {
      m.lastEval = {
        cp: toBotEval(winnerAlt.eval) ?? undefined, mate: toBotEval(winnerAlt.mate) ?? null,
        engine: engineSource, ts: Date.now(),
      };
    }
    this.recordMove({
      tableId, from: fromSq, to: toSq, engine: engineSource, engineResults,
      botColor: ourColor, oppName: m.oppName,
      cp: moveCp, mate: moveMate, thinkMs: moveThinkMs,
      captured: isCapture,
      pieceType: movedPiece?.piece_type,
    });
    m.moveCount = (m.moveCount ?? 0) + 1;
    // Tally engine provenance per game so it outlives the capped recentMoves
    // log (snapshotted onto the ResultEntry at finish).
    m.engineCounts = m.engineCounts ?? {};
    m.engineCounts[engineSource] = (m.engineCounts[engineSource] ?? 0) + 1;
    console.log(
      `t=${tableId} move ${fromSq}→${toSq} engine=${engineSource} ` +
      `color=${ourColor} piece=${movedPiece?.piece_type ?? "?"} ` +
      `capture=${isCapture ? "1" : "0"} ` +
      `cp=${moveCp ?? "?"} mate=${moveMate ?? "?"} thinkMs=${moveThinkMs ?? "?"}`,
    );

    // Cache fresh engine verdicts so future hits on the same FEN reuse the
    // result. UCI is just from+to; lookupUciMove ignores the promo char,
    // matching how the bot already delegates the promoted-piece choice to
    // BGA's default.
    //
    // Only REMOTE Stockfish/lichess verdicts may enter the cache
    // (isCacheableEngine): cache hits, the random fallback, AND the local
    // js-chess-engine are all excluded, so the shared cache never serves a
    // weak local move into a grandmaster game. This is the guarantee that
    // "only requests to Stockfish engines or lichess enter the cache".
    //
    // Also skip when the repetition guard deviated from the engine's top move
    // (avoidedRepetition): that pick is specific to THIS game's move history,
    // so caching it would pollute the shared cache with a context-bound move.
    //
    // Precedence-gated: only write if the new engine ranks at least as
    // well as whatever the cache already holds. Otherwise a one-off run
    // where the top engine was offline would downgrade a previously
    // cached top-engine verdict.
    if (!useDifficulty && !avoidedRepetition && isCacheableEngine(engineSource)) {
      const newRank = enginePrecedenceRank(engineSource);
      const cachedRank = cached ? enginePrecedenceRank(cached.engine) : Number.POSITIVE_INFINITY;
      if (newRank <= cachedRank) {
        await this.ctx.storage.put<CachedMove>(cacheKey, {
          move: `${fromSq}${toSq}`, engine: engineSource,
          cp: toBotEval(winnerAlt?.eval) ?? undefined, mate: toBotEval(winnerAlt?.mate) ?? null,
          ts: Date.now(),
        }).catch(() => {});
      }
    }
    m.lastMoveFrom = fromSq;
    m.lastMoveTo = toSq;
    // Record the placement we just handed the opponent for the repetition
    // guard. The bot's own irreversible moves (captures / pawn pushes) make
    // every earlier position unreachable, so reset the window on those —
    // older placements can never recur and would only risk a false veto.
    // Otherwise append and trim to REPETITION_HISTORY_CAP as a backstop.
    const playedPlacement = placementAfterMove(parsed.pieces, chosen.pieceId, chosen.dest);
    if (playedPlacement) {
      const irreversible = isCapture || movedPiece?.piece_type === "pawn";
      const hist = irreversible ? [] : (m.posHistory ?? []);
      hist.push(playedPlacement);
      if (hist.length > REPETITION_HISTORY_CAP) {
        hist.splice(0, hist.length - REPETITION_HISTORY_CAP);
      }
      m.posHistory = hist;
    }
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
      await this.sendChat(tableId, tr("randomFallback", m.oppLanguage));
      m.saidRandomFallback = true;
    }
  }

  private async askEngine(fen: string, level?: number): Promise<{
    move: string; engine: string; alternatives?: EngineAltEntry[];
  } | null> {
    // Hit our own engine via service binding — same Worker, so just call
    // the Stockfish DO directly through env.ENGINE. A `level` means a
    // difficulty-limited game: run only the local js-chess-engine at that
    // level (localOnly) instead of the remote Stockfish race.
    const id = this.env.ENGINE.idFromName(`bot:${this.uid ?? "anon"}`);
    const stub = this.env.ENGINE.get(id);
    const body = level != null
      ? { fen, localOnly: true, level }
      : { fen, depth: ENGINE_DEPTH, movetime: ENGINE_MOVETIME_MS };
    const resp = await stub.fetch("https://do/bestmove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
