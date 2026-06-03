/**
 * Pure status enum helpers used by the BotDriver.
 *
 * Extracted from bot-do.ts so unit tests can import them without dragging
 * in `cloudflare:workers`. These three predicates are the source of the
 * "asyncplay was silently ignored" / "asyncfinished never said GG" class
 * of bug — keep their fixture coverage tight.
 */

/**
 * BGA reports several distinct statuses for a table that is still in the
 * "waiting for players" phase: `open` (realtime, published), `asyncopen`
 * (turn-based, published), and `init`/`setup` (created but not yet
 * published). All mean "the bot has not started a game here yet".
 */
export function isJoinableStatus(status: string): boolean {
  return (
    status === "open" ||
    status === "asyncopen" ||
    status === "init" ||
    status === "setup"
  );
}

/** Live-play statuses: `play` for realtime, `asyncplay` for turn-based. */
export function isLivePlayStatus(status: string): boolean {
  return status === "play" || status === "asyncplay";
}

/** Finished statuses: `finished` for realtime, `asyncfinished` for turn-based. */
export function isFinishedStatus(status: string): boolean {
  return status === "finished" || status === "asyncfinished";
}

/**
 * Should handleTable finalize a game purely from its terminal status, even
 * though BGA dropped our seat from the lean snapshot row?
 *
 * When a game ends, BGA's myTables row for it can go lean — `{id, status,
 * creator, game_id}` with no `players` map. That leaves `meSeat` undefined, so
 * the normal finish/tally path (which reads `meSeat.score`) is skipped and the
 * memo never reaches `finished`: the result goes uncounted and the memo ghosts
 * until the 30-day age sweep. This is common for realtime abandons, which BGA
 * flags/archives server-side (often before our 15-min inactivity timer fires).
 *
 * Returns true for a game we actually played (`saidHi`) whose status is
 * terminal (`finished` / `asyncfinished` / `archive`) and isn't already
 * finalized — the signal to recover scores via getTableInfo and tally. Pure so
 * it's unit-testable.
 */
export function shouldFinalizeSeatlessTerminal(opts: {
  status: string;
  saidHi: boolean;
  finished: boolean;
}): boolean {
  if (opts.finished || !opts.saidHi) return false;
  return isFinishedStatus(opts.status) || opts.status === "archive";
}

/**
 * Should the finish handler re-fetch authoritative per-table info (one
 * getTableInfo) before tallying, because the polled snapshot is missing a
 * score we need to classify the result correctly?
 *
 *   - our own score is absent (`myRawScore == null`): BGA sometimes ships a
 *     seated-but-scoreless finished row. Tallying it verbatim banks an
 *     uncounted "none", silently dropping a real win/loss from W/L/D — this
 *     dropped ~40 realtime games before the guard generalized past the 0/0
 *     case below (waler alone accounted for ~half of them).
 *   - our score is a loss (0) but the opponent's score is missing
 *     (`oppRawScore == null`): the friendly-draw quirk (BGA reporting 0/0
 *     instead of 0.5/0.5) would otherwise be misclassified as a loss.
 *
 * Returns false once we hold a non-null own score with either a win/draw value
 * or a present opponent score — no point spending a getTableInfo. Pure so it's
 * unit-testable.
 */
export function needsFinishScoreRefetch(
  myRawScore: string | null | undefined,
  oppRawScore: string | null | undefined,
): boolean {
  if (myRawScore == null) return true;
  return Number(myRawScore) === 0 && oppRawScore == null;
}

export type Gamemode = "realtime" | "async";
export const GAMEMODES: readonly Gamemode[] = ["realtime", "async"];

/** Match a bot-owned joinable table to the gamemode that produced it. */
export function gamemodeOf(status: string): Gamemode | null {
  if (status === "open") return "realtime";
  if (status === "asyncopen") return "async";
  // init/setup carry no gamemode hint in the status alone.
  return null;
}

/**
 * Mode this status should occupy in the bot's invite-slot tracker.
 *
 * Differs from `gamemodeOf` ONLY for `setup`/`init`: those map to "realtime"
 * here. Rationale — our own `createTable` returns the published status
 * directly (`open` for realtime, `asyncopen` for async); `setup`/`init` only
 * appears as the brief transitional state of a realtime table while BGA
 * promotes it to `open`, so a bot-owned table sitting in setup is always
 * realtime in practice. This lets the slot tracker adopt a freshly-created
 * realtime table on the same tick it was made, instead of waiting for `open`
 * — important because the cleanup paths only fire when slot.id is set, and a
 * setup table whose slot was never assigned (DO restart, or an `oppSeated`
 * transient clear) sits in BGA's records forever and blocks every future
 * realtime createTable with "you are already at a real-time table".
 */
export function inviteSlotModeOf(status: string): Gamemode | null {
  if (status === "setup" || status === "init") return "realtime";
  return gamemodeOf(status);
}

export interface ReconcileMissDecision {
  /** Flip the memo to finished so the per-tick GC drops it. Realtime only. */
  markFinished: boolean;
  /** Record a `reconcileMiss` row in `recentErrors` this tick. */
  log: boolean;
  reason: "below-threshold" | "gc-realtime" | "fail-open-async";
}

/**
 * Decide what to do when a tracked table is missing from both `myTables`
 * and a direct `getTableInfo` lookup. `missCount` is the post-increment
 * count of consecutive misses (>= 1); `realtime` is the memo's recorded
 * gamemode (false === turn-based/async, true === realtime, undefined ===
 * not yet observed live).
 *
 *   - Below `limit` misses: wait. BGA returns null for a single tick on
 *     tables that are still live; bouncing the memo would re-trigger every
 *     downstream lifecycle action when it came back.
 *   - Realtime at/over `limit`: GC. A dead realtime slot blocks every
 *     subsequent createTable ("you are already at a real-time table"), and
 *     a vanished realtime table is almost always a genuine rage-quit +
 *     archive. Unknown gamemode (undefined) is treated as realtime — only
 *     a positive async signal earns fail-open.
 *   - Async at/over `limit`: fail OPEN, never finish. A turn-based game can
 *     sit idle for hours or days, so a null lookup is almost always a
 *     transient BGA flake; marking it finished would make the bot stop
 *     moving and forfeit the game on the clock (cost us table 856600921, a
 *     bogus 3-move "loss"). Log once at the threshold so a permanently-
 *     missing async memo can't flood the error log every tick.
 */
export function decideReconcileMiss(
  missCount: number,
  realtime: boolean | undefined,
  limit: number,
): ReconcileMissDecision {
  if (missCount < limit) {
    return { markFinished: false, log: false, reason: "below-threshold" };
  }
  if (realtime === false) {
    return {
      markFinished: false,
      log: missCount === limit,
      reason: "fail-open-async",
    };
  }
  return { markFinished: true, log: true, reason: "gc-realtime" };
}

/**
 * True when a failed `createTable` is the expected "you can only have one
 * realtime table" back-off rather than a genuine fault. BGA rejects a second
 * realtime createnew during the brief window between an opponent joining the
 * bot's invite and the game reaching `play` status:
 *
 *   - feException "You are already at a real-time table about to start!"
 *   - feException "...game in progress at another table..."
 *   - a `mmstarted` envelope (status:1 but no `data.table`) returned when a
 *     rapid follow-up createnew is folded back into the matchmaking session
 *     that the previous call already started.
 *
 * These are self-resolving: the launching game advances to `play`/`finished`,
 * the realtime slot frees, and the next tick recreates the invite. The
 * per-mode cooldown is already armed before the attempt, so the caller should
 * swallow these instead of recording them as errors (they otherwise flood
 * `recentErrors` ~1/min and mask real failures like the createnew HTML-page
 * outage). Genuine faults (HTML error pages, auth/session loss, unknown
 * exceptions) return false and stay logged.
 */
export function isBenignCreateTableError(message: string): boolean {
  return (
    /already at a [\w-]+ table/i.test(message) ||
    /game in progress at another table/i.test(message) ||
    /\bmmstarted\b/.test(message)
  );
}
