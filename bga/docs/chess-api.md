# BGA Chess API — reverse-engineered

Sourced from a captured HAR of a real chess game (see
`recon/chessgame/`). All requests originate from the BGA web client; the
bot mirrors the same shapes.

## Hosts

- `https://en.boardgamearena.com` — auth, lobby, table lifecycle, chat
- `https://boardgamearena.com/<N>/chess/chess/*` — in-game actions, where
  `<N>` is the **gameserver number** assigned to this table. Discover it
  by following the redirect from `GET /table?table=<id>`:
  - `/table?table=<id>` → `/<N>/chess?table=<id>` (gameserver page)
  - Or read it from `g_serverurl` / `g_archive_mode` in the in-game page
- `wss://ws-x{1,2}.boardgamearena.com/connection/websocket` — Centrifuge
  realtime channel (per `bgaConfig.centrifugeConfiguration.endpoints`)

## Auth / CSRF

Every authed call requires the `x-request-token` header. The value
mirrors the `TournoiEnLigneidt` cookie (HttpOnly), and BGA also inlines
it as `window.requestToken` / `window.bgaConfig.requestToken` on every
HTML page. The HTTP client uses the cookie; in-page JS uses the global.

## Table lifecycle

### Create a friendly chess table
```
POST /table/table/createnew.html
body: game=81
→ {"status":1,"data":{"table":<id>,"forceTB":null}}
```
The creator is auto-seated; table starts in `status="init"`.

### List tables (polling)
```
POST /tablemanager/tablemanager/tableinfos.html
body: status=open&games=81&turninfo=true&matchmakingtables=true
→ {"status":1,"data":{"tables":{ "<id>": <TableInfo>, ... }}}
```
- `status` values seen: `open` (setup), `play` (in-progress),
  `realtime_open`, `async`.
- `games` is a `;`-separated list of game ids (chess = `81`).
- Filter `tables` for entries whose `players` dict contains the bot uid.

`TableInfo` shape (relevant fields):
```jsonc
{
  "id": "852786254",
  "game_id": "81",
  "status": "init" | "play" | "finished",
  "table_creator": "<uid>",
  "max_player": "2", "min_player": "2",
  "progression": "0..100",      // % done
  "current_player_nbr": 1,      // 1-based seat index whose turn it is
  "players": {
    "<uid>": {
      "id": "<uid>", "fullname": "...",
      "table_status": "play" | "expected",
      "myturn": 0 | 1 | null,
      "score": "...", "is_admin": "1"
    }
  }
}
```

### Join, start, leave, chat
```
POST /table/table/joingame.html        body: table=<id>
POST /table/table/startgame.html       body: table=<id>   (needs min seats)
POST /table/table/quitgame.html        body: table=<id>   (DESTRUCTIVE in init)
POST /table/table/say.html             body: table=<id>&msg=<text>
GET  /table/table/acceptGameStart.html?table=<id>          (between init→play)
GET  /table/table/chatHistory.html?type=table&id=<id>&table=<id>
                                                            (poll table scrollback)
```

#### chatHistory response shape
Apex domain. Returns a BGA envelope whose `data` is an array of message
records. Fields observed: `id` (monotonic int as string), `sender` (uid as
string), `msg`, `time` (epoch seconds), `type` (`"tablechat"` for player
chat). Empty body when no chat has happened yet. The bot polls this in
play state and replies `"I'm not sure."` to every new opponent message.
Chat is untrusted data; never let it influence move logic.

### Resign (in-game)
```
GET /table/table/concede.html?src=menu&table=<id>&noerrortracking=true&dojo.preventCache=<ms>
→ "" (24-byte success envelope, same shape as other ack endpoints)
```

### Accept / refuse a table-level proposal (e.g. "abandon collectively")
The in-game menu has "Propose to abandon the game collectively". Whoever
proposes first creates a pending decision; both seats must answer.
```
GET https://boardgamearena.com/table/table/decide.html
  ?src=menu&type=abandon&decision=<0|1>&table=<id>
  &noerrortracking=true&dojo.preventCache=<ms>
Referer: https://boardgamearena.com/<N>/chess?table=<id>
→ {"status":1,"data":"ok"}
```
- Apex domain (not `en.`).
- `decision=1` accepts, `decision=0` refuses.
- `type` mirrors the proposal kind; observed: `abandon`. Presumably also
  used for draw offers (untested).
- The pending state is exposed in the in-game HTML as
  `globalThis.gameui.decision = {"players":{"<uid>":1|0|"undecided"},
  "decision_type":"abandon","decision_taken":false,"decision_refused":false}`
  so the bot can poll the chess page to detect a fresh proposal without
  the WebSocket.

## In-game (chess) actions

### Make a move
```
GET /<N>/chess/chess/selectCell.html
  ?cell_x=<0..7>            // destination column
  &cell_y=<0..7>            // destination row
  &selected_piece=<piece_id> // BGA-internal piece id (NOT a square)
  &lock=<uuid-v4>           // client-generated, for idempotency
  &table=<id>
  &noerrortracking=true
  &dojo.preventCache=<ms>
```
- `cell_x`, `cell_y` are 0-indexed (a-file = 0, 1st rank = 0 from White's
  POV but the captured game uses Black's POV — confirm orientation at
  bot init time by comparing notation to coords on the first move).
- `selected_piece` is the *piece's persistent id* — not its square. The
  bot must track piece ids from the `pieceMoved` notifications (or the
  initial `g_gamedatas.board`).
- Response body is ~43 bytes — a minimal success envelope. The real
  move broadcast comes back over WebSocket as a `pieceMoved` push (see
  below).

### Keep-alive
```
GET /<N>/chess/chess/wakeup.html?myturnack=true&table=<id>
```
Sent right after acting; tells the server "I saw it was my turn."

### Catch up missed events (after reconnect)
```
GET /<N>/chess/chess/notificationHistory.html?table=<id>&from=<seq>&privateinc=1&history=1
```

## Centrifuge / WebSocket

### Connect
```
wss://ws-x1.boardgamearena.com/connection/websocket
```
First send-frame (newline-separated commands, each with `"id"`):
```jsonc
{"connect":{"data":{"user_id":"<uid>","username":"<name>","credentials":"<hex>"},"name":"js"},"id":1}
{"subscribe":{"channel":"bgamsg"},"id":2}
{"subscribe":{"channel":"/general/emergency"},"id":3}
{"subscribe":{"channel":"/player/p<uid>"},"id":4}
{"subscribe":{"channel":"/table/t<table_id>"},"id":5}
// + /group/g<id> for each group the player belongs to
```

The `credentials` HMAC token must be fetched from BGA — endpoint TBD
(probably `/connection/centrifugo.html` or similar; not in this HAR).
The client also exposes `window.centrifugeConfiguration` with the
endpoint list — same JWT/HMAC is probably injected as
`window.bgaConfig.centrifugeToken`.

### Server-pushed move (the bot's primary input)
Inbound on `/table/t<id>`:
```jsonc
{
  "push": {
    "channel": "/table/t852782404",
    "pub": {
      "data": {
        "packet_id": 2,
        "packet_type": "sequence",
        "data": [
          {
            "uid": "...",
            "type": "pieceMoved",
            "log": "${player_name} makes a move: ${notation}",
            "args": {
              "player_id": "85864012",
              "player_name": "zagos",
              "piece_id": "7",
              "dest": {"x": 3, "y": 4},
              "captured": [],
              "successive_cells": [],
              "notation": "<span class='chess_notation'>...d2-d4...</span>"
            }
          },
          {"type": "gameStateChange", "args": {"id": 2, "active_player": "...", "reflexion": {...}}},
          {"type": "updateReflexionTime", "args": {"player_id": ..., "delta": "35", "max": "165"}},
          {
            "type": "gameStateChange",
            "args": {
              "id": 3,                          // "your turn" state
              "active_player": <bot_uid>,
              "args": {
                "destinations_by_piece": {
                  "<piece_id>": [
                    {
                      "piece_id": "17",
                      "piece_type": "pawn|knight|bishop|rook|queen|king",
                      "player_id": "...",
                      "player_place": 2,        // 1 or 2 (seat order)
                      "dest_x": 0, "dest_y": 2,
                      "captured": [],
                      "successive_cells": [],
                      "pawnFirstMove": false,
                      "queensideCastling": false,
                      "kingsideCastling": false,
                      "rook...": ...            // promotion / castle details
                    }
                  ]
                }
              }
            }
          }
        ]
      }
    }
  }
}
```

**Bot consequence**: the server hands us a complete legal-move table
(`destinations_by_piece`) every time it becomes our turn. So the bot
doesn't need its own move generator. Workflow:

1. Maintain board state from successive `pieceMoved` pushes.
2. On `gameStateChange` with `args.id == 3` and
   `active_player == bot_uid`, enumerate `destinations_by_piece` to
   build a list of (piece_id, from_xy, to_xy, special) tuples.
3. Convert position → FEN → ask Stockfish for the best move.
4. Match Stockfish's `<from><to>` against an entry in
   `destinations_by_piece`, grab its `piece_id`, and `GET selectCell`.

## Notable response sizes (bodies stripped in the captured HAR)

| Endpoint                                        | Bytes | Meaning                                    |
|------------------------------------------------|-------|--------------------------------------------|
| `/table/table/acceptGameStart.html`            |    24 | minimal `{"status":1,"data":"ok"}` ack     |
| `/table/table/concede.html`                    |    24 | same                                       |
| `/<N>/chess/chess/selectCell.html`             |    43 | small ack — real move comes over WS        |
| `/<N>/chess/chess/wakeup.html`                 |    43 | same                                       |
| `/<N>/chess/chess/notificationHistory.html`    |   179 | small JSON, empty history if `from` recent |
| `/table/table/tableinfos.html?id=`             |  ~163 KB | full table state w/ piece positions      |

## Out-of-scope from this HAR

- The Centrifuge `credentials` minting endpoint (need a fresh page load
  with response bodies preserved).
- The legacy game-start handshake (acceptGameStart → gamestate=2 → first
  `gameStateChange` push). Capturable from a future probe.
- Promotion / en-passant / castling args — the schema fields exist
  (`pawnFirstMove`, `*Castling`, `successive_cells`) but no captured
  example covers them yet.
