/**
 * Premium-membership gating for the bot's two limited resources.
 *
 * BGA "friendly" chess games are free to create, but the bot's *playing
 * time* is the scarce thing: it can only ever play ONE realtime game at a
 * time (the single realtime slot), and an unbounded pile of simultaneous
 * async games would swamp it too. So we reserve those for BGA Premium
 * members and nudge free members toward an upgrade (which also helps BGA
 * sell memberships — we log every nudge so that can be demonstrated):
 *
 *   - Realtime is premium-only. A free member never gets a realtime game.
 *   - A free member may have at most ONE concurrent async game with the bot.
 *     The oldest stays; any newer concurrent async game is a violation.
 *
 * Premium membership is read from the opponent's game-page profile blob
 * (`is_premium`, see parseOpponent). It can be `undefined` when we haven't
 * been able to read it — in that case we FAIL OPEN (never block), so a
 * paying member is never wrongly turned away.
 *
 * This module is intentionally pure (no I/O, no DO/bot-do imports) so the
 * gating policy is unit-testable in isolation.
 */

/** Public origin that fronts the worker — the premium link routes through
 *  here so the click can be logged before redirecting to BGA. */
export const PREMIUM_REDIRECT_ORIGIN = "https://stockfish.ross.gg";
/** Path on the worker that logs the click and 302s to BGA's membership page. */
export const PREMIUM_REDIRECT_PATH = "/go/premium";
/** Where /go/premium ultimately sends the user. */
export const BGA_PREMIUM_URL = "https://boardgamearena.com/premium";
/** Generic BGA table URL prefix. BGA bounces this to the right player/game
 *  view, so it works without the per-table gameserver number — handy for
 *  pointing a free member back at the one async game they may keep. */
export const BGA_TABLE_URL = "https://boardgamearena.com/table?table=";

export type PremiumBlockReason = "realtime-free" | "async-limit";
export type GateMode = "realtime" | "async";

/** Minimal structural view of a table memo this module needs — declared
 *  locally so premium.ts never imports bot-do.ts (avoids a cycle). */
export interface PremiumMemoView {
  /** true = realtime ("play"), false = async ("asyncplay"), unset = unknown. */
  realtime?: boolean;
  /** Opponent's BGA player id. */
  oppId?: string;
  finished?: boolean;
  conceded?: boolean;
}

/**
 * Build the upgrade link that the bot puts in the nudge message. It points
 * at the worker's /go/premium endpoint (carrying who/where/which-mode) so
 * the click is logged, then that endpoint redirects to BGA's membership
 * page. Values are URL-encoded.
 */
export function buildPremiumLink(
  uid: string,
  tableId: string,
  mode: GateMode,
): string {
  const qs = new URLSearchParams({ u: uid, t: tableId, m: mode });
  return `${PREMIUM_REDIRECT_ORIGIN}${PREMIUM_REDIRECT_PATH}?${qs.toString()}`;
}

/**
 * Direct BGA link to a specific table. Used to point a free member bounced
 * off a 2nd async game back at the one async game they're allowed to keep.
 * Not routed through /go/premium — there's nothing to log here, it's just a
 * convenience pointer to their own in-progress game.
 */
export function buildGameLink(tableId: string): string {
  return `${BGA_TABLE_URL}${encodeURIComponent(tableId)}`;
}

/** An active game is one we're still responsible for (not finished/conceded). */
function isActive(m: PremiumMemoView): boolean {
  return !m.finished && !m.conceded;
}

/** The opponent's active async game ids with the bot (realtime === false). */
function activeAsyncPeerIds(
  tables: Record<string, PremiumMemoView>,
  oppId: string,
): string[] {
  const peerIds: string[] = [];
  if (!oppId) return peerIds;
  for (const [id, m] of Object.entries(tables)) {
    if (m.realtime !== false) continue; // async only (realtime === false)
    if (!isActive(m)) continue;
    if (m.oppId !== oppId) continue;
    peerIds.push(id);
  }
  return peerIds;
}

/**
 * The PRIMARY async game id for this opponent — the single oldest of their
 * active async games with the bot (smallest numeric BGA table id, since ids
 * increase monotonically). This is the one game a free member is allowed to
 * keep. Returns null when they have no active async game with the bot.
 */
export function primaryAsyncGameId(
  tables: Record<string, PremiumMemoView>,
  oppId: string,
): string | null {
  const peerIds = activeAsyncPeerIds(tables, oppId);
  if (peerIds.length === 0) return null;
  return peerIds.reduce((a, b) => ((Number(a) || 0) <= (Number(b) || 0) ? a : b));
}

/**
 * Is `tableId` a SECONDARY async game for this opponent — i.e. NOT the single
 * oldest of their active async games with the bot? The oldest is the one a
 * free member is allowed to keep; every newer concurrent async game by the
 * same player is a violation.
 *
 * "Oldest" is by numeric BGA table id ascending (ids are monotonically
 * increasing, so the smallest id is the earliest-created table) — a stable,
 * tick-independent ordering, which matters because BOTH games are processed
 * each tick and we must never flag both (that would void the opponent's only
 * permitted game too).
 *
 * Returns false unless `tableId` is itself among the opponent's active async
 * games, so a stray call can't wrongly flag a table.
 */
export function isSecondaryAsyncGame(
  tables: Record<string, PremiumMemoView>,
  oppId: string,
  tableId: string,
): boolean {
  if (!oppId) return false;
  const peerIds = activeAsyncPeerIds(tables, oppId);
  if (peerIds.length <= 1) return false;
  if (!peerIds.includes(tableId)) return false;
  // Primary = smallest numeric id; everyone else is secondary.
  const primary = peerIds.reduce((a, b) => ((Number(a) || 0) <= (Number(b) || 0) ? a : b));
  return primary !== tableId;
}

/**
 * Core gate decision. Returns the block reason, or null to allow the game.
 *
 *   - oppPremium !== false  → allow (premium, or unknown → fail open).
 *   - realtime + free        → "realtime-free".
 *   - async + free + 2nd     → "async-limit".
 *   - otherwise              → allow.
 */
export function decidePremiumBlock(opts: {
  isRealtime: boolean;
  oppPremium: boolean | undefined;
  secondaryAsync: boolean;
}): PremiumBlockReason | null {
  if (opts.oppPremium !== false) return null;
  if (opts.isRealtime) return "realtime-free";
  if (opts.secondaryAsync) return "async-limit";
  return null;
}
