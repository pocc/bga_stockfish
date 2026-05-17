# BGA API surface (reverse-engineered)

Everything documented here was captured by `scripts/recon-login.ts` and
`scripts/recon-lobby.ts` on 2026-05-16 while logged in as `bot_stockfish`
(user_id `99861258`).

Source of truth: `recon/login-summary.md`, `recon/lobby-summary.md`,
`recon/captured-requests*.json`, `recon/login.har`, `recon/lobby.har`.

## Hosts

- `https://boardgamearena.com` — apex (no language prefix). Most APIs accept calls here when the session cookie is set on `.boardgamearena.com`.
- `https://en.boardgamearena.com` — English locale. Login goes through this host so the bot sees English UI strings.
- `https://x.boardgamearena.net` — static asset CDN (themes, fonts, gamepreviews).
- `https://r.boardgamearena.net` — realtime (socket.io) host — used once a player is at a table. Not yet inspected; need a real game to capture the handshake.
- `https://en.doc.boardgamearena.com` — wiki / docs (chess piece sprites are served from `/images/...`).
- `https://sentry.bga.li` — Sentry tenant. Ignore.

## Chess identifiers

- Game slug: `chess`
- Game id: `81`
- BGG id: `171`
- Player count: `[2]`
- Times: `fast_additional_time=30`, `medium_additional_time=40`, `slow_additional_time=50` (seconds added per move on top of base clock)

## Auth

### Step 1 — fetch the login page so `PHPSESSID` + a `request_token` are issued

```
GET https://en.boardgamearena.com/account?redirect=welcome
```

The login UI is a Svelte two-step form. The `request_token` (64-char hex)
is rendered in inline JS / hidden inputs on this page. For a headless
flow, either parse it from the HTML or do the whole login through
Playwright (current approach).

### Step 2 — POST credentials

```
POST https://en.boardgamearena.com/account/auth/loginUserWithPassword.html
content-type: application/x-www-form-urlencoded

username=<u>&password=<p>&remember_me=false&request_token=<csrf>
```

Response (200):

```json
{"status":1,"data":{"success":true,"username":"bot_stockfish","user_id":"99861258","avatar":"_def_2298","is_premium":"0","partner_event":[]}}
```

On success the server sets these cookies (all `HttpOnly` + `Secure`):

| Cookie | Domain | Purpose |
|---|---|---|
| `PHPSESSID` | `boardgamearena.com` + `en.boardgamearena.com` | session |
| `TournoiEnLigne_sso_user` | `.boardgamearena.com` | SSO user id |
| `TournoiEnLigne_sso_id` | `.boardgamearena.com` | SSO session id |
| `TournoiEnLigneidt` | `.boardgamearena.com` | identity token |
| `TournoiEnLignetkt` | `.boardgamearena.com` | full auth ticket (64 chars) |

The session is shared across `boardgamearena.com` and
`en.boardgamearena.com`, so subsequent API calls can use either host.

### Step 3 — fingerprint ack (optional)

```
POST https://boardgamearena.com/account/account/setFp.html
id=<32-hex md5-shaped fingerprint>
→ {"status":1,"data":"ok"}
```

The site sends this after login but never gates anything on it AFAICT.

## Lobby / panel APIs

All of these are `POST` with `application/x-www-form-urlencoded` bodies
unless noted, and all return `{"status":1, ...}` on success.

| Endpoint | Body | Notes |
|---|---|---|
| `/gamelist/gamelist/gameDetails.html` | `game=chess` | game metadata (publisher, players, clock defaults) |
| `/gamepanel/gamepanel/getData.html` | `game_id=81&with_ranking_info=false` | returns `recommendedExampleGame`, `defaultGameMode`, awards |
| `/gamepanel/gamepanel/getForumPosts.html` | `game_id=81` | game forum |
| `/lobby/lobby/getGamePreferencesNew.html` | `game=81&gamemode=realtime&withtime=true&rankingmode=simple` | user prefs for that game / mode |
| `/lobby/lobby/timeJokerInfos.html` | — | unrelated; remaining "time jokers" |
| `/gameranking/gameranking/arenaInfos.html` | — | arena season info |
| `/tablemanager/tablemanager/getTableCounterStatus.html` | — | per-game/level/reputation table counts (used to power the green "X tables open" badge) |
| `/community/community/getPageData.html` | — | community page bootstrap |

### Player feed

```
GET https://boardgamearena.com/message/board?type=player&id=<user_id>&social=true&per_page=14&dojo.preventCache=<ts>
→ {"status":1,"data":{"restrictedBoard":false,"news":[...]}}
```

Polled by the homepage feed widget. `dojo.preventCache` is a unix-ms
timestamp used as a cache-buster; any unique value works.

```
GET https://boardgamearena.com/message/board?type=playerresult&id=<user_id>&social=false&per_page=10&dojo.preventCache=<ts>
```

Same shape; returns recent finished-game results.

## CSRF — `x-request-token` header

Every authed POST (and any "do something" GET) requires:

```
x-request-token: <value of TournoiEnLigneidt cookie>
```

The token rotates with the SSO ticket. If you skip this header, the
endpoint returns:

```json
{"status":"0","exception":"feException","error":"Invalid session information for this action. Please try reloading the page or logging in again.","expected":1,"code":806}
```

Cookies alone are not enough — a same-site `XMLHttpRequest` would
include cookies but a CSRF attacker can't set a custom request header
cross-origin, so the header is the actual auth check.

## Realtime — Centrifuge, not socket.io

BGA's `/account` HTML inlines a `centrifugeConfiguration` JSON blob:

```json
{
  "endpoints": [
    { "transport": "websocket", "endpoint": "wss://ws-x1.boardgamearena.com/connection/websocket" },
    { "transport": "websocket", "endpoint": "wss://ws-x2.boardgamearena.com/connection/websocket" },
    { "transport": "http_stream", "endpoint": "https://ws-x1.boardgamearena.com/connection/http_stream" },
    { "transport": "http_stream", "endpoint": "https://ws-x2.boardgamearena.com/connection/http_stream" }
  ],
  "emulationEndpoint": "https://ws-x2.boardgamearena.com/emulation"
}
```

So the bot will use a [Centrifuge](https://centrifugal.dev/) client
(WebSocket) for push:

- Auth: a connect token retrieved from BGA's HTTP API (not yet captured — likely an inline JS variable or `/notif/notif/getConnectionToken.html`)
- Channels: by convention `general:<id>`, `player:p<user_id>`, `table:t<table_id>`. The exact namespace prefixes still need confirmation.
- Invites likely land on `player:p<user_id>` as a `gainvit`-style payload.

**Follow-up recon needed**: capture the centrifuge connect token + the
first frames sent over the WS by loading any lobby page through
Playwright with `page.on("websocket", ws => ws.on("framereceived", ...))`.

## Table / game actions (NOT YET CAPTURED)

By BGA convention, in-game actions are:

```
POST https://boardgamearena.com/<game>/<game>/<action>.html?table=<table_id>
```

For chess (game slug `chess`, server entry point also `chess`):

- Move: probably `POST /chess/chess/playMove.html?table=<id>` with `from=e2&to=e4` (and `promotion=` for the 8th rank) — to be confirmed.
- Resign: `/chess/chess/resign.html?table=<id>` — to be confirmed.
- Game state: `/<game>/<game>/notificationHistory.html` or initial state via the game page's inline `g_gamedatas`.

The canonical authoritative source for table state when reconnecting is
the inline `g_gamedatas` JSON on the game HTML page:

```
GET https://boardgamearena.com/4/chess?table=<table_id>
```

This serves the full game HTML; the FEN-equivalent (BGA stores piece
positions in its own format, but we'll convert to FEN client-side) is
in `g_gamedatas.board`.

## Open questions / TODO

1. Capture invitation push payload — need a second BGA account that can `friend` the bot, then send a friendly chess invite.
2. Capture move endpoint + payload by creating a chess table from the bot and playing one move against a second account.
3. Capture realtime socket.io handshake + channel names from a live table.
4. Find the table-creation endpoint (probably `POST /table/table/createnew.html` with `game=81&gamemode=realtime&...`).
5. Verify how "friendly" vs "ranked" is signaled — likely a flag on the invitation payload (`isfriend` / `isranked`).
