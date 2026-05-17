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

export type Gamemode = "realtime" | "async";
export const GAMEMODES: readonly Gamemode[] = ["realtime", "async"];

/** Match a bot-owned joinable table to the gamemode that produced it. */
export function gamemodeOf(status: string): Gamemode | null {
  if (status === "open") return "realtime";
  if (status === "asyncopen") return "async";
  // init/setup carry no gamemode hint in the status alone.
  return null;
}
