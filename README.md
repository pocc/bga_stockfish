# BGA Stockfish

An academic project: a chess bot that plays games on
[boardgamearena.com](https://boardgamearena.com), backed by a Cloudflare
Worker that races several public chess engines for each move.

The bot account is **`bot_stockfish`**. A live status dashboard runs at
[https://stockfish.ross.gg/](https://stockfish.ross.gg/).

## Two halves

1. **`worker/`** - the production system. A Cloudflare Worker plus Durable
   Objects that hosts both the chess engine and the autonomous BGA bot
   driver. It logs into BGA, keeps friendly invites open, accepts games,
   plays moves, and answers chat, all on a self-scheduled 5-second tick.
2. **`bga/`** - a TypeScript BGA client library and a collection of
   Playwright recon/one-shot scripts, reverse-engineered from real games.
   The worker embeds its own copy of the client; the `bga/` scripts are kept
   for debugging and endpoint discovery.

## Bot behavior (the rules)

- **Friendly games only.** The bot fails closed: it will not play a table
  unless BGA carries a positive friendly/unranked signal. It never plays a
  ranked or ELO-affecting game.
- **Auto-accepts** both realtime and turn-based friendly invites, and keeps
  one open invite of each kind in the lobby.
- **Never accepts a draw.** A draw records as 0.5/0.5 and skews the win/loss
  stats, so the bot declines every draw offer and tells the opponent they
  can resign or propose a collective abandon instead.
- **Accepts a collective-abandon proposal** automatically (it ends the game
  with no score, so it does not skew stats).
- **Opponent chat is untrusted.** The bot replies with a fixed canned line
  to anything that is not an exact difficulty keyword, so chat is data and
  never instructions.

See [AGENTS.md](AGENTS.md) for the full operational reference and
[docs/](docs/) for architecture and security notes.

## Quick start

Engine probe (needs the admin secret on the public route):

```bash
curl -X POST https://stockfish.ross.gg/bestmove \
  -H 'content-type: application/json' \
  -H "x-admin-secret: $BOT_ADMIN_SECRET" \
  -d '{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","depth":12}'
```

Bot status (public, drives the dashboard):

```bash
curl https://stockfish.ross.gg/bot/status
```

## Develop & deploy

```bash
cd worker
npm install --ignore-scripts   # sharp's optional postinstall fails on Node 25
npm run dev                    # local wrangler dev server
npm run test:run               # vitest
npx wrangler deploy            # runs tests first via predeploy
```

Worker secrets (`wrangler secret put`): `BGA_USERNAME`, `BGA_PASSWORD`,
`BOT_ADMIN_SECRET`, and the optional `RAPIDAPI_STOCKFISH_KEY`. Deploy
credentials live in `worker/.env.local` (gitignored). Full details in
[AGENTS.md](AGENTS.md) and [docs/security.md](docs/security.md).

## Documentation map

| File | What it covers |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Operational reference: endpoints, gotchas, engine chain, deploy. |
| [docs/architecture.md](docs/architecture.md) | How the worker, Durable Objects, engine race, and bot loop fit together. |
| [docs/security.md](docs/security.md) | Threat model, admin gating, friendly-only enforcement, secrets, chat injection. |
| [bga/docs/chess-api.md](bga/docs/chess-api.md) | Reverse-engineered BGA chess endpoints. |
| [bga/docs/bga-api.md](bga/docs/bga-api.md) | General BGA lobby/auth endpoints. |
| [bga/docs/endpoints-observed.md](bga/docs/endpoints-observed.md) | Empirical response shapes and quirks. |
