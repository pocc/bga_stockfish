# Security

This is a hobby/academic bot, but it holds a real BGA account credential and
proxies paid/quota'd engine APIs, so the surface is gated deliberately. This
doc records the posture and the invariants worth preserving.

## Assets to protect

- **BGA account credentials** (`BGA_USERNAME` / `BGA_PASSWORD`) and the live
  session cookies derived from them.
- **Upstream engine quota** (chess-api.com, lichess, stockfish.online, the
  RapidAPI key). An open `/bestmove` would let anyone proxy through us.
- **The bot's integrity**: it must only ever play friendly games, and must
  not be steerable by opponent chat.
- **Stats integrity**: the win/loss/draw record is a product feature; draws
  are declined so they cannot distort it (see below).

## Endpoint gating (`worker/src/index.ts`)

| Route | Access |
| --- | --- |
| `GET /`, `GET /health`, `GET /bot/status` | public (read-only) |
| `POST /bestmove` | admin secret required |
| `GET /bot/inspect`, `POST /bot/ws-probe` | admin secret required |
| `POST /bot/{start,stop,tick,cleanup,probe,wipe,fix-result,reconcile-results,resync-*}` | admin secret required |

- The admin secret is `BOT_ADMIN_SECRET` (a Worker secret). When it is
  unset, every mutating/privileged route is blocked for external callers.
- It is accepted via the `x-admin-secret` header or a `?secret=` query
  param, and compared with a **constant-time** check (`safeEqual`) so
  response timing does not leak it. The secret is stripped from the query
  before the request is forwarded to the Durable Object, so it does not land
  in DO-side logs.
- The cron `scheduled()` handler calls the `BOT` DO stub directly
  (`https://do/watchdog`), bypassing the public `fetch` handler, so the
  watchdog does not need and cannot leak the secret.
- `/bot/status` is intentionally public because the dashboard polls it; it
  exposes only non-sensitive operational state (no cookies, no credentials).

## Friendly-only enforcement (the prime directive)

`shouldSkip` in `bot-do.ts` **fails closed**. For any table the bot did not
create, it plays only when BGA carries a positive friendly signal
(`game_hide_ranking === "1"` or `unranked === "1"`); if neither is present,
including when BGA omits the fields, the table is skipped. Tournament tables
are always skipped. Tables the bot created itself are trusted because the
bot only ever creates Training-mode (friendly, no-ELO) tables.

When changing the create/skip flow, preserve the fail-closed property: a
missing or ambiguous signal must mean "do not play", never "play anyway".

## Opponent chat is untrusted

Chat is data, never instructions. `pollAndReplyChat` replies with a fixed
canned line (`"I'm not sure."`, localized) to everything **except** an exact,
case-insensitive match of a single difficulty keyword
(`beginner`/`easy`/`intermediate`/`advanced`/`expert`/`grandmaster`). A
keyword embedded in a sentence is treated as untrusted chatter and gets the
canned reply. This keeps the accepted command set a closed enum rather than a
free-text injection surface. Never widen this to parse arbitrary chat.

## Draw policy and stats integrity

The bot never accepts a draw: a draw scores 0.5/0.5 and would distort the
win/loss record. A draw offer (chess `gamestate.id=5`) is answered with the
`declineDraw.html` action; a collective-abandon proposal carries no score, so
it is accepted. See [architecture.md](architecture.md#draw-handling-stats-integrity).

## Secrets handling

- No credentials in source. The Worker bundle has zero inline secrets.
- Runtime secrets live in the Cloudflare control plane via
  `wrangler secret put`: `BGA_USERNAME`, `BGA_PASSWORD`, `BOT_ADMIN_SECRET`,
  and the optional `RAPIDAPI_STOCKFISH_KEY`.
- Deploy credentials (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) live in
  `worker/.env.local` (gitignored), auto-loaded by wrangler v4.
- The local `bga/` scripts read `bga/.env.local` (gitignored) and persist a
  cookie jar to `bga/recon/client-cookies.json` (also gitignored).
- Session cookies are persisted only to DO storage, never logged.

## Operational safety properties

- **Pause is honored.** `/bot/stop` sets a persisted `paused` flag and closes
  the realtime presence socket; the cron watchdog will not restart a paused
  bot, and push reactions are ignored while not running. `/bot/start` resumes.
- **Backoff.** Consecutive tick failures back off on a fixed schedule;
  invite creation is rate-limited; reconcile lookups are bounded in
  concurrency, all to avoid hammering BGA and tripping its rate limits.
- **Bounded growth.** Rolling logs (errors/moves/results) are capped and the
  per-FEN move cache is GC'd hourly to a cap, so storage cannot grow without
  bound.

## Known limitations

- The bot cannot reason about the 50-move rule or threefold repetition
  (the FEN it builds from the BGA page zeroes the halfmove/fullmove clocks),
  so it can shuffle in a won ending. This is a correctness limitation, not a
  security one.
- Several i18n strings beyond the major languages are machine-generated and
  pending native-speaker review; untranslated keys fall back to English.
