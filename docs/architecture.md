# Architecture

Everything production runs inside one Cloudflare Worker
(`worker/`, deployed to `stockfish.ross.gg`). The Worker hosts both the
chess engine and the autonomous BGA bot. There is no separate server.

## Components

```
                       Cloudflare Worker (src/index.ts)
                       ┌───────────────────────────────────────┐
  GET  /               │  landing page + live dashboard (HTML)  │
  GET  /health         │  health probe                          │
  GET  /bot/status     │  public bot snapshot (drives dashboard)│
  POST /bestmove       │  admin-gated engine probe              │
  POST /bot/* (admin)  │  start/stop/tick/cleanup/probe/...     │
  cron */1 * * * *  ──▶│  scheduled() → BOT /watchdog           │
                       └──────────┬───────────────┬─────────────┘
                                  │               │
                    service binding              service binding
                                  ▼               ▼
                    ┌──────────────────┐   ┌──────────────────────┐
                    │ BotDriver  (BOT) │   │ StockfishEngine       │
                    │ Durable Object   │   │ (ENGINE) Durable Obj  │
                    │ singleton        │   │ one per gameId        │
                    │ - BGA session    │   │ - parallel engine race│
                    │ - per-table memo │   │ - precedence pick     │
                    │ - alarm/tick loop│   └──────────────────────┘
                    │ - presence ws    │
                    └──────────────────┘
                                  │ HTTPS (BGAClient)
                                  ▼
                         boardgamearena.com
```

- **`StockfishEngine`** (`src/stockfish-do.ts`), namespace `ENGINE`,
  SQLite-backed, keyed per `gameId` so a game keeps a warm DO across moves.
- **`BotDriver`** (`src/bot-do.ts`), namespace `BOT`, a single
  `idFromName("singleton")` instance that owns the whole bot.
- `StockfishContainer` (`src/container-do.ts`) is dormant (native Stockfish
  in a container; binding is commented out in `wrangler.toml`).

## Engine race (`StockfishEngine`)

`POST /bestmove` fires every available engine in parallel and waits up to a
5s ceiling, then picks the best result by `ENGINE_PRECEDENCE` (lower is
stronger):

1. `lichess-cloud-eval` - community-cached evals at very deep nominal depths;
   hits only for common positions (404 = miss, falls to the next engine).
2. `stockfish.online` - free Stockfish API (depth <= 15).
3. `chess-api.com` - public REST, returns eval + continuation.
4. `rapidapi-stockfish-16` - only when `RAPIDAPI_STOCKFISH_KEY` is set.
5. `stockfish-container` - dormant.
6. `js-chess-engine (local DO)` - pure-JS engine that always returns a move,
   so the race is never empty when the remotes are slow or offline.
7. Random legal move via `chess.js` - last resort if everything fails.

Each task is wrapped so it never rejects (failures are captured), aborted at
the ceiling, and reported in an `alternatives[]` array so the dashboard can
show every engine's pick. Difficulty-limited games bypass the race and run
only `js-chess-engine` at a level (1 to 5).

Lichess 429s trigger an in-memory 60s skip so a rate limit does not stall
the race.

## Bot driver (`BotDriver`)

### The tick loop

- The DO self-schedules via `storage.setAlarm` every `TICK_MS` (5s). While a
  realtime invite is open and unfilled it polls faster (1s) so a joining
  human is launched in about a second.
- A cron trigger (`*/1 * * * *`) calls the internal `/watchdog`, which
  re-arms the alarm and runs one tick in case the alarm chain ever drops.
  The watchdog honors an operator pause: once `/bot/stop` sets a persisted
  `paused` flag, the cron does not restart the bot. `/bot/start` clears it.
- `tickInFlight` is a re-entrancy guard so a cron-driven tick and an
  alarm-driven tick (or a websocket push reaction) cannot both fire
  `selectCell` on the same table.

### Per tick (`tickInner`)

1. Log in if needed; list the bot's chess tables (`myTables`, a union of
   open/setup/play/finished snapshots plus the player-scoped list).
2. **Reconcile** in-flight tables that fell off the lobby snapshots by
   fetching them directly by id (bounded parallelism). Memos that BGA can no
   longer find for several ticks, or that never reached play and are old,
   are GC'd so they stop blocking new `createTable` calls.
3. `handleTable` each table through its lifecycle: accept seat, launch
   handshake, greet once, reply to chat, decline draws / accept abandons,
   play a move, and on finish tally the result and say GG.
4. `maybeCreateOpenInvite` keeps one realtime and one async friendly invite
   live (the friendly-mode toggle quirk is handled here).
5. `ensurePresence` keeps a Centrifugo websocket open for live realtime
   games so BGA does not neutralize the bot for being "absent".

### Move selection (`maybePlayMove`)

The in-game HTML embeds a `pieces` map and a `destinations_by_piece` legal
move table when it is the bot's turn. The bot:

1. Builds a FEN from the live board (castling rights and en-passant target
   derived from BGA's own legal-move table; halfmove/fullmove are zeroed).
2. Looks up the position in a per-FEN move cache (skipped for
   difficulty-limited games), else asks the engine race.
3. Maps the engine's UCI move back to a `piece_id` + destination and
   **sends `selectCell` first**, then records the move, increments counters,
   and writes the cache only after BGA accepts it (so a rejected move never
   pollutes stats or the cache).
4. Handles the pawn-promotion gamestate (always queens) and the draw-offer
   gamestate (always declines, see below).

### Opponent-quit handling (realtime and async)

BGA flags an absent player with `zombie:1` / `neutralized_player_id`. These
flip transiently on reconnects, so the bot requires the flag to persist for
`OPP_QUIT_CONFIRM_MS` (60s) before acting. Once confirmed, because friendly
games have no rating penalty, the bot concedes too — freeing the single
realtime slot immediately, or (for async) cleaning up the dead table rather
than waiting out the 15-min opponent-inactivity timer, the 30-day age sweep,
or BGA's own end-of-game sweep. (A concede is tracked under `stats.concedes`,
not as a loss, and is not added to `recentResults`.)

### State & persistence

All durable state lives in DO storage and is re-read on boot, so deploys and
evictions are transparent:

- `cookies`, `running`, `paused`
- `tables` (per-table memo), `openInvites`
- `stats`, `recentErrors`, `recentMoves`, `recentResults`
- `mc:<fen>` move-cache entries (GC'd hourly down to a cap)

## BGA client (`BGAClient`, `src/bga-client.ts`)

A Workers-compatible HTTP client with an in-memory cookie jar (persisted by
the caller to DO storage). It mirrors `bga/src/client.ts`. It pins a Chrome
user-agent and client hints, mirrors the CSRF token into `x-request-token`,
and exposes the table-lifecycle and in-game chess endpoints. See
[bga/docs/chess-api.md](../bga/docs/chess-api.md) for the endpoint shapes.

## Draw handling (stats integrity)

A draw on BGA scores 0.5/0.5 and would distort the bot's win/loss record, so
the bot never accepts one:

- A draw offer parks the chess game in `gamestate.id=5` (`playerAgreeToDraw`).
  The bot calls the chess `declineDraw.html` action (the bare `decline.html`
  label 500s) and posts a chat suggesting the opponent resign or propose a
  collective abandon.
- A "Propose to abandon the game collectively" proposal (the table-level
  `decide.html` decision, `decision_type:"abandon"`) ends the game with no
  score, so the bot accepts it.
