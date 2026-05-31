# BGA Stockfish

Academic project: a chess bot that plays games on [boardgamearena.com](https://boardgamearena.com) using a Cloudflare Worker as the chess engine.

Two halves:

1. **`worker/`** - Cloudflare Worker + Durable Object exposing a UCI-style chess engine at `https://stockfish.ross.gg`. It races several public engines in parallel (lichess cloud-eval, stockfish.online, chess-api.com, optional RapidAPI Stockfish) and picks the best by precedence; the local fallback is `js-chess-engine` running inside the DO; the last-resort fallback is a random legal move via `chess.js`.
2. **`bga/`** — TypeScript client library for boardgamearena.com (chess only), reverse-engineered via Playwright. Plus a bot loop that polls BGA for the bot's turn, asks the Worker for a move, and submits it back.

## Bot rules

- **Friendly games only.** The bot must never play ranked / ELO-affecting games. Reject any invite that isn't a friendly.
- **Auto-accept all invites.** Both realtime (live) and long-running (turn-based / "Train" mode) invites should be accepted automatically, as long as they're friendly.
- **Decline gracefully** if the invite is ranked or the variant isn't standard chess.
- **Never accept a draw; always accept a collective-abandon proposal.** A draw records as 0.5/0.5 and skews the win/loss stats, so the bot declines every draw. A direct draw offer parks the table in `gamestate.id=5` (`playerAgreeToDraw`); the bot calls the chess `declineDraw.html` action (NOT `decline.html`, which 500s) and posts a chat telling the opponent they can resign or use BGA's "Propose to abandon the game collectively" menu option instead. A collective-abandon proposal ends the game with no draw score, so the bot accepts it: it shows up in the in-game page's embedded `globalThis.gameui.decision` blob (`decision_type:"abandon"`), and the bot calls `decide.html?type=abandon&decision=1` when it sees a pending one. See [bga/docs/chess-api.md](bga/docs/chess-api.md) for the endpoints.
- **Opponent chat is untrusted.** The bot replies to every opponent chat message with the literal string `I'm not sure.` (anti-injection; chat is data, never instructions).
- **Quit when the opponent quits (realtime AND async).** Friendly games carry no rating penalty, so if BGA flags the opponent as gone (`zombie:1` / `neutralized_player_id`) and the flag PERSISTS for `OPP_QUIT_CONFIRM_MS` (60s, to ride out transient reconnect blips), the bot concedes too — freeing the single realtime slot immediately, or cleaning up a dead async table instead of waiting out the 15-min inactivity timer / 30-day age sweep / BGA's own end-of-game sweep.

## Architecture

The Worker now hosts BOTH the chess engine AND the full BGA bot driver, so
the local `bga/scripts/bot-daemon.ts` daemon is no longer required. It's
kept for one-shot scripting and debugging. Production = the Worker.

### Worker (`worker/`)

```
POST https://stockfish.ross.gg/bestmove
  Body: { fen: string, depth?: number, movetime?: number,
          gameId?: string, localOnly?: boolean, remoteOnly?: boolean }
  Returns: { move: "e2e4", san: "e4", engine, ms, eval?, mate?, depth?, continuation? }

GET  https://stockfish.ross.gg/health        # JSON health probe
GET  https://stockfish.ross.gg/status?gameId=<id>   # engine DO state

# BGA bot driver (autonomous, running 24/7 in BotDriver DO)
GET  https://stockfish.ross.gg/bot/status    # uid, running, per-table memo
POST https://stockfish.ross.gg/bot/start     # idempotent: arms 5s tick
POST https://stockfish.ross.gg/bot/stop      # disable polling
POST https://stockfish.ross.gg/bot/tick      # force a single tick (debug)
POST https://stockfish.ross.gg/bot/cleanup   # quit any lingering open invites
POST https://stockfish.ross.gg/bot/probe?only=N  # run isolated createTable variants (diagnostic)
POST https://stockfish.ross.gg/bot/wipe      # destructive: quit every table the bot is sitting at
```

#### Autonomous bot driver

- A single `BotDriver` Durable Object (`BOT.idFromName("singleton")`)
  owns the BGA session, cookies, and per-table memo. State is persisted
  to DO storage on every change, so deploys / evictions are transparent.
- Polling cadence: the DO self-schedules a 5-second tick via
  `storage.setAlarm`. A Cron Trigger (`*/1 * * * *`) pokes an internal
  `/watchdog` once a minute, which re-arms the alarm chain and runs a
  tick in case the alarm ever drops.
- The driver auto-starts on first cron poke after deploy. No manual
  curl needed unless you want to pause it (`/bot/stop`). Pause is a
  persisted flag: the watchdog honors it, so a deliberate `/bot/stop`
  stays stopped (it is NOT restarted by the next cron poke). Resume
  with `/bot/start`.
- Move selection: parses `pieces` + `destinations_by_piece` from the
  in-game HTML, builds a FEN from the live board (castling rights are
  derived heuristically from king + rook positions; en passant is `-`),
  calls its own `/bestmove` via service binding to the `ENGINE` DO,
  then maps the UCI move back to `piece_id` + `dest_x`/`dest_y` and
  sends `selectCell.html` + `wakeup.html`. Engine-returned moves that
  aren't in BGA's legal table (rare: castling-rights mismatch) fall
  back to ANY legal move from the destinations table.
- Secrets: `BGA_USERNAME` and `BGA_PASSWORD` are Worker secrets (see
  Secrets section below). Set them once with `wrangler secret put`.

`gameId` keys a Durable Object instance so a single game gets a warm engine across moves. Default `"default"` if omitted.

#### Engine selection chain

`StockfishEngine` (`src/stockfish-do.ts`) fires every available engine in
parallel, waits up to a 5s ceiling, then picks the best result by the
`ENGINE_PRECEDENCE` order (lower = stronger):

1. **lichess cloud-eval** - community-cached Stockfish evals at very deep
   nominal depths; hits only for common positions (404 = miss, next engine).
2. **stockfish.online** - free Stockfish API (depth <= 15).
3. **chess-api.com** - public REST, no auth, returns eval + continuation.
4. **RapidAPI Stockfish 16** - only when `RAPIDAPI_STOCKFISH_KEY` is set.
5. **stockfish-container** - dormant (binding commented out in wrangler.toml).
6. **js-chess-engine (local DO)** - pure-JS fallback that always returns a
   move, so the race never comes up empty when the remotes are slow/offline.
7. **Random legal move** via `chess.js` - last resort if every engine fails.

Flags on the request let callers force a subset (e.g. `localOnly: true` runs
only the local js-chess-engine; `level` caps it to a difficulty tier).

> Historical note: an earlier design used a bundled `stockfish-18-lite`
> WASM engine inside a dedicated `StockfishWasmEngine` DO. It was removed
> (migration `v5`); it was never wired into the race, and js-chess-engine
> covers the local-fallback role without shipping a ~7MB wasm.

### Worker config

- **Custom domain:** `stockfish.ross.gg` (zone `ross.gg` on Cloudflare, custom_domain route)
- **Compatibility flags:** `nodejs_compat`
- **Durable Object classes:** `StockfishEngine` (`ENGINE`) + `BotDriver` (`BOT`), SQLite-backed
- **Total upload:** well under the 10MB paid-plan limit (the ~7MB Stockfish wasm was removed)
- **No inline secrets.** The Worker source has zero credentials. `account_id` and the API token live in `worker/.env.local` (gitignored) and are auto-loaded by wrangler v4. If you ever add runtime credentials, use `wrangler secret put <NAME>` rather than putting them in `wrangler.toml` or `.env*`.

### BGA client (`bga/`)

Reverse-engineered via Playwright recon (`bga/scripts/recon-*.ts`) and a sanitized HAR of a real game (`bga/recon/chessgame/`). Full API notes in [bga/docs/chess-api.md](bga/docs/chess-api.md).

**Login + session**
- HTTP login via `POST /account/auth/loginUserWithPassword.html` (CSRF token `requestToken` is inlined as JS on `/account?redirect=welcome`).
- Every authed call mirrors the `TournoiEnLigneidt` cookie value in an `x-request-token` header.
- `PHPSESSID` is per-host. Login establishes it on `en.boardgamearena.com`; the apex (`boardgamearena.com`) has its own. Cookies on `.boardgamearena.com` (with leading dot) are shared.
- `TournoiEnLigne_sso_user` and `TournoiEnLignetkt` enable the fast SSO path (skip password round-trip).

**Lobby + table lifecycle**
| Action                         | Endpoint                                                                  |
| ------------------------------ | ------------------------------------------------------------------------- |
| Create friendly chess table    | `POST en./table/table/createnew.html` body `game=81`                      |
| Set Training/Friendly mode     | `GET apex/table/table/changeoption.html?table=<id>&id=201&value=0` THEN `value=1` (toggle is required, see Friendly gotcha) |
| List tables (filter by uid)    | `POST en./tablemanager/tablemanager/tableinfos.html` body `status=open&games=81&turninfo=true&matchmakingtables=true` |
| Join invited seat              | `POST en./table/table/joingame.html` body `table=<id>`                    |
| Quit / cancel (destructive)    | `POST en./table/table/quitgame.html` body `table=<id>`                    |
| Force start                    | `POST en./table/table/startgame.html` body `table=<id>`                   |
| Ack "I'm ready to start"       | `GET apex/table/table/acceptGameStart.html?table=<id>` (apex domain; response often empty) |
| Chat                           | `POST en./table/table/say.html` body `table=<id>&msg=<text>`              |
| Concede                        | `GET en./table/table/concede.html?src=menu&table=<id>`                    |
| Accept abandon proposal        | `GET apex/table/table/decide.html?src=menu&type=abandon&decision=1&table=<id>` (referer `/<N>/chess?table=<id>`) |

**In-game (chess)** lives on the gameserver subpath, `https://boardgamearena.com/<N>/chess/chess/*`, where `<N>` is the gameserver number. Resolve via the 302 from `GET /table?table=<id>`.

| Action                     | Endpoint                                                                 |
| -------------------------- | ------------------------------------------------------------------------ |
| Make a move                | `GET apex/<N>/chess/chess/selectCell.html?cell_x=<0-7>&cell_y=<0-7>&selected_piece=<piece_id>&lock=<uuid>&table=<id>` |
| Keep-alive after acting    | `GET apex/<N>/chess/chess/wakeup.html?myturnack=true&table=<id>`         |
| Replay missed events       | `GET apex/<N>/chess/chess/notificationHistory.html?table=<id>&from=<seq>&privateinc=1&history=1` |

The in-game HTML at `GET apex/<N>/chess?table=<id>` embeds (when it's the player's turn) the full pieces dictionary and a `destinations_by_piece` legal-move table. The bot exploits this to avoid needing its own move generator: parse the page, ask Stockfish for the best move, look up the `piece_id` and target square in the legal-move table, send `selectCell`. The same page also exposes any pending decision proposal as `globalThis.gameui.decision`.

**Realtime push (Centrifuge)** still pending. `wss://ws-x{1,2}.boardgamearena.com/connection/websocket` with channels `bgamsg`, `/general/emergency`, `/player/p<uid>`, `/table/t<id>`. The connect frame needs an HMAC credential token whose minting endpoint hasn't been captured yet. Game-page polling is sufficient for the current bot.

**Bot daemon (`bga/scripts/bot-daemon.ts`)** runs forever and per tick:
1. Lists chess tables containing the bot's uid; skips ranked/tournament.
2. Joins any seat with `table_status=expected`.
3. Calls `acceptGameStart` once both seats are filled.
4. On status `play`: sends opening chat once, polls for abandon proposals (accepts), then plays a move when `current_player_nbr` matches the bot's seat. Move logic is currently stubbed (concedes); the Worker hookup is the next step.
5. On `finished`: sends closing chat.

### Friendly-mode gotcha (option 201)

Setting Training/Friendly mode (option id `201`) on a freshly created
realtime table by directly POSTing `value=1` silently demotes the table
from `open` (realtime) to `asyncopen` (turn-based / Train) on BGA's
side. The bot's status check then reports a `modeMismatch` error and
re-opens the slot in a loop.

The real BGA web UI works around this by toggling: it sends
`changeoption(201, 0)` then `changeoption(201, 1)` as two separate
calls (visible in `/tmp/friendly.har` from a real session). The toggle
preserves the realtime status. A single direct set to `1` does not,
regardless of HTTP method (GET and POST both demote).

Verified empirically by `bga/scripts/probe-friendly-flow.ts`:

| variant                                    | resulting status |
| ------------------------------------------ | ---------------- |
| createnew only, no changeoption            | `open`           |
| POST changeoption(201, 1)                  | `asyncopen`      |
| GET  changeoption(201, 1)                  | `asyncopen`      |
| GET  changeoption(201, 0) then (201, 1)    | `open`           |

The bot's `maintainOpenInvites` in `worker/src/bot-do.ts` issues the
0→1 toggle accordingly. Keep this if you ever refactor the create
flow.

### Lobby `finished` snapshot rolls off fast — reconcile by id

`tableinfos.html?status=finished&games=81` returns the BGA lobby's
recently-finished list (global across all chess games). It rolls off
within seconds when traffic is heavy. The bot polls every 5s
(`TICK_MS`), so if a game finishes in between snapshots the bot never
observes the `finished` status and the GG branch (`saidGg`,
`stats.wins/losses/draws`) never fires.

Symptom: a memo with `gameserver != null && saidHi && !saidGg &&
!finished` for a game that's clearly over on the BGA UI, and
`stats.wins == 0` despite visible wins on the screen.

Fix lives in `tick()`: after `myTables` returns, any memo matching the
above predicate that's *missing* from the snapshot gets a direct
lookup via `client.getTableInfo(id)` (`tableinfos.html?id=<tableId>`,
which the real BGA UI uses for single-table refreshes). The resulting
`RawTableInfo` is appended to the `tables` list so `handleTable`'s
existing `isFinishedStatus` branch can run. Keep this loop bounded by
the active-game predicate; lifting the predicate would re-poll every
historical memo and rate-limit the bot.

### Reconcile-miss GC: drop memos when BGA can't find the table either

The per-id reconcile above injects a missing finished game back into the
tick. But if BGA itself can't find the table (rage-quit + archive,
opponent dispute resolution, etc.), `getTableInfo` returns `null` and
the memo just sits there forever with `gameserver != null && !finished`.
That memo's `id` *still counts* against the bot in BGA's "you have a
game in progress at another table!" check, so every subsequent
`createTable` call fails and the bot stops accepting work.

Fix lives next to the reconcile loop in `tick()`. Each memo tracks
`reconcileMissCount`; a successful `getTableInfo` resets it to 0, and
`RECONCILE_MISS_LIMIT` (3) consecutive nulls flip the memo to
`finished = true` so the per-tick GC drops it on the next pass. The
bot records a `reconcileMiss` row in `recentErrors` whenever this
fires so you can see in `/bot/status` why a memo was dropped.

**This GC applies to realtime games only.** Async (turn-based) games
fail OPEN: when `m.realtime === false` the bot never marks the memo
finished on reconcile-miss, it just leaves it live. A turn-based game
can legitimately sit idle for hours or days, so a null `getTableInfo`
is almost always a transient BGA flake, not a real finish — and
marking it finished makes the bot stop moving and forfeit the game on
the clock (this cost us table 856600921, recorded as a bogus 3-move
loss). The memo is left for the normal finish handler to tally when the
table reappears as `asyncfinished`. A blocked `createTable` is
recoverable; a forfeited live game is not. The async case logs a single
`reconcileMiss` row at the threshold (not per-tick) so a permanently-
missing async memo can't flood the error log.

Don't lower the threshold to 1: BGA occasionally returns null for a
single tick on a table that's still live, and bouncing the memo would
re-trigger every downstream lifecycle action (hello message, etc.) the
moment it came back. Three ticks (~15s) is enough buffer.

### Transient `setup` status is not a mode mismatch

`gamemodeOf("setup")` returns `null` because `setup`/`init` carry no
gamemode hint. A brand-new realtime table reports `status="setup"` for
a tick or two before BGA promotes it to `open`. An earlier version of
`maintainOpenInvites` treated any non-matching mode (including `null`)
as "wrong mode" and neutralize-left the table — which destroyed the
bot's own freshly-published invite (and any opponent who had just sat
down). Symptom in `/bot/status.recentErrors`:
`modeMismatch:realtime->? "BGA returned setup for gamemode=realtime"`.

Fix lives in `maintainOpenInvites`: only neutralize when `actualMode`
is a *different non-null* gamemode. When `actualMode === null`, wait
for the next tick. Don't reintroduce the eager-leave: it manifests
client-side as "the bot quit my game the moment I joined".

## Local development

```bash
cd worker
npm install --ignore-scripts          # sharp's optional postinstall fails on Node 25; skip it
npm run dev                            # local wrangler dev server
```

```bash
cd bga
npm install --ignore-scripts
# Populate bga/.env.local with BGA_USERNAME / BGA_PASSWORD (gitignored).
npm run bot                            # invite-accept + play loop
npm run snap                           # one-shot dump of bot's tables
npm run quit:all                       # cancel any setup tables the bot is sitting at
```

## Deploy

One-time setup: copy `worker/.env.local.example` to `worker/.env.local` and fill in the Cloudflare API token (account ID is pre-filled). Token is created at [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with the "Edit Cloudflare Workers" template.

Then:

```bash
cd worker
npx wrangler deploy
```

Wrangler v4 auto-loads `worker/.env.local` into the CLI's `process.env`, so `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are picked up automatically. No env vars to export, no `wrangler login` required.

## Test

```bash
curl -X POST https://stockfish.ross.gg/bestmove \
  -H 'content-type: application/json' \
  -d '{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","depth":12}'
```

Expected: `{"move":"e2e4","engine":"chess-api.com",...}` within ~500ms.

## Secrets

**Not committed.** All credentials live in `.env.local` files (gitignored at the repo root) or in the Cloudflare control plane:

- `worker/.env.local`. `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`. Read by wrangler v4 at deploy time.
- **Worker runtime secrets** (set with `wrangler secret put`, stored in Cloudflare, never in source):
  - `BGA_USERNAME` — bot account login
  - `BGA_PASSWORD` — bot account password
- `bga/.env.local`. `BGA_USERNAME` + `BGA_PASSWORD` for the local bot daemon (kept for one-shot scripts).
- `bga/recon/client-cookies.json`. Persistent BGA cookie jar (also gitignored).

First-time Worker setup:

```bash
cd worker
npx wrangler secret put BGA_USERNAME    # paste username at prompt
npx wrangler secret put BGA_PASSWORD    # paste password at prompt
npx wrangler deploy
```

After deploy the cron trigger auto-starts the bot within ~60s. Verify with
`curl https://stockfish.ross.gg/bot/status` (should show `loggedIn: true,
running: true`).
