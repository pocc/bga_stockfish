# BGA endpoints — observed shapes & gotchas

Empirical notes captured via Playwright (`scripts/recon-endpoints.ts`,
`scripts/play-vs-prod-bot.ts`) driving the `bot_stockfish2` account, plus
behaviors found while debugging the worker bot driver. Complements
[bga-api.md](bga-api.md) and [chess-api.md](chess-api.md) — this file focuses on
response **shapes** and the **non-obvious quirks** that have bitten us.

Last verified: 2026-05-24.

## Hosts

- `boardgamearena.com` (apex) and `en.boardgamearena.com` mirror most table
  endpoints. Some calls only behave on one host (see `tableinfos` below).
- AJAX endpoints end in `.html` and return a JSON envelope `{ status, data, error? }`.
  `status: 1` = ok, `status: 0` = error (message in `error`).
- CSRF: mirror the `TournoiEnLigneidt` cookie value into an `x-request-token`
  header on every AJAX call. In Playwright, read it from `context.cookies()`.

## `tableinfos.html` — two variants, very different behavior

There are two endpoints that both "get table info" by id. They are **not**
interchangeable:

| Variant | URL | Behavior |
| --- | --- | --- |
| **tablemanager** | `…/tablemanager/tablemanager/tableinfos.html?id=<id>` | Under load returns `status: 0`, `error: "Sorry, we didn't manage to process your request fast enough. Please retry."` — i.e. it rate-limits. Do **not** rely on this for per-table lookups. |
| **table/table** (use this) | `https://boardgamearena.com/table/table/tableinfos.html?id=<id>&nosuggest=true&table=<id>&noerrortracking=true` | Returns the full table object. This is what `worker/src/bga-client.ts#getTableInfo` uses. |

`data` (table/table variant) top-level keys include:

```
id, game_id, status, table_creator, max_player, min_player, progression,
unranked, game_hide_ranking, game_name, gamestart, gameserver, duration, players, result
```

- **`gameserver`** — the `<N>` in `/<N>/chess?table=<id>`. Present once the game
  is live; lets you skip the `/table?table=` 302 to resolve it.
- **Per-seat scores are NOT in `players[pid].score`** on this endpoint. For a
  finished game BGA puts authoritative scores under **`result.player[]`**
  (`{ player_id, score }`). `getTableInfo` backfills these onto `players[pid].score`.

### `status` is multi-stage and gamemode-ambiguous

A table walks through several status values. The terminal value is **not** a
reliable gamemode signal:

| status | meaning |
| --- | --- |
| `init` / `setup` | created, not yet published (no gamemode hint) |
| `open` | realtime invite, published & joinable |
| `asyncopen` | turn-based invite, published & joinable |
| `play` | realtime game live |
| `asyncplay` | turn-based game live |
| `finished` / `asyncfinished` | just ended |
| `archive` | older finished game, still shown in lists |

**Gotcha that caused the dashboard "LIVE" bug:** `finished` does **not** reliably
mean "realtime". Async games are sometimes reported as `finished` (and very
often roll straight to `archive`, skipping `asyncfinished` entirely). Deriving
realtime-vs-async from the terminal status mislabels async games as live.
**Classify from the in-play status (`play` → realtime, `asyncplay` → async) and
record it while the game is live** — that is the only unambiguous source. (Fixed
in `worker/src/bot-do.ts` by storing `m.realtime` during live play.)

## `joingame.html` — same-location anti-collusion

`POST en…/table/table/joingame.html` body `table=<id>`. Returns `status: 0` with:

> "You play from the same location as `<player>` (`<code>`). Playing from the
> same location is not allowed."

when the joining account and a seated player share a location/IP. This is a hard
BGA policy block — it makes **bot-vs-bot self-play impossible from one network**
(both bot accounts and any local dev share the same egress). Use server-side
signals (`/bot/status`) to verify bot behavior instead of a self-play game.

## `chatHistory.html`

`GET …/table/table/chatHistory.html?type=table&id=<id>&table=<id>`. The array of
messages can live under `data`, `data.data`, `data.history`, or `results`
depending on the call — normalize defensively (see `client.ts#chatHistory`).
Each entry: `{ id|msg_id, sender (uid string), msg, time (epoch s), type }`.

- Anti-flood: chat lines fired faster than ~2s apart are **silently dropped**.
  The bot's chunked greeting spaces chunks 2s apart for this reason
  (`scripts/probe-chat-chunks.ts` proves it).

## Game-start handshake (realtime)

To launch a realtime table both seats must signal ready:

1. Host: `POST en…/table/table/startgame.html` body `table=<id>` (only once
   `min_player` seats are filled).
2. Each player: `GET …/table/table/acceptGameStart.html?table=<id>` (apex host;
   response often empty). Poll the table ~1s until status reaches `play`
   (typically 1–3s).

Async tables need none of this — `asyncopen` auto-promotes to `asyncplay`.

## In-game chess moves

- Move: `GET /<N>/chess/chess/selectCell.html?cell_x=<0-7>&cell_y=<0-7>&selected_piece=<piece_id>&lock=<uuid>&table=<id>`.
  `selected_piece` is BGA's internal piece id (not a square); destinations come
  from the in-page `destinations_by_piece` legal-move table.
- Keep-alive: `GET /<N>/chess/chess/wakeup.html?myturnack=true&table=<id>`.
- The in-game HTML at `GET /<N>/chess?table=<id>` embeds `pieces`,
  `destinations_by_piece`, and any pending `globalThis.gameui.decision` proposal.

## Endpoints seen during lobby/table navigation (recon-endpoints.ts)

| method | endpoint | notes |
| --- | --- | --- |
| POST | `/account/account/setFp.html` | fingerprint ack on login; `data` is a string |
| POST | `/gamelist/gamelist/gameDetails.html` | `data: { status, results }` |
| GET | `/table/table/tableinfos.html?id=` | full table object (see above) |
| POST | `/tablemanager/tablemanager/getTableCounterStatus.html` | `data` keyed by game_id (chess = `81`) → live counters |

Raw capture: `bga/recon/endpoints-seen.json` (regenerate with
`npx tsx scripts/recon-endpoints.ts`).
