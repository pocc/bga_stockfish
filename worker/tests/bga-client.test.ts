import { afterEach, describe, expect, test, vi } from "vitest";
import { BGAClient } from "../src/bga-client";
import { parseOpponent } from "../src/bot-move";

const BOT = "99861258";
// A real game-page player block, as /<gs>/chess?table= serves it.
const GAME_PAGE_HTML =
  `{"user_id":"${BOT}","status":"online","device":"desktop","language":"en","player_name":"bot_stockfish"},` +
  `{"user_id":"99999001","status":"online","device":"desktop","language":"es","player_name":"Javividoor"}`;

function makeClient(): BGAClient {
  return new BGAClient({ username: "bot_stockfish", password: "x" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveGameserverWithPage", () => {
  // Regression: /table?table= 302-redirects an in-play game, and with
  // redirect:"manual" the redirect body is an empty stub. Resolving the
  // gameserver from the Location header must NOT return that stub — it must
  // fetch the real game page, or the opponent's language can't be parsed and
  // the bot greets only in English.
  test("follows the redirect and returns the real game-page html", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/table?table=")) {
        // 302 stub: gameserver only in the Location header, empty body.
        return new Response("", {
          status: 302,
          headers: { location: "https://boardgamearena.com/5/chess?table=123" },
        });
      }
      if (url.includes("/5/chess?table=123")) {
        return new Response(GAME_PAGE_HTML, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeClient().resolveGameserverWithPage("123");

    expect(result?.gs).toBe(5);
    // The returned html is the game page (with player blocks), not the stub,
    // so the opponent's language is recoverable.
    expect(parseOpponent(result!.html, BOT)?.language).toBe("es");
    // Two fetches: the /table redirect probe, then the real game page.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("returns the body directly when /table answers 200 (no redirect)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(`gameserver:5 ${GAME_PAGE_HTML}`, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeClient().resolveGameserverWithPage("123");

    expect(result?.gs).toBe(5);
    expect(parseOpponent(result!.html, BOT)?.language).toBe("es");
    // No redirect, so no follow-up game-page fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
