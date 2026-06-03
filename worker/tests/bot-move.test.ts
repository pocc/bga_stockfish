import { describe, expect, test } from "vitest";
import {
  parseOpponent, parseGameNeutralized, buildFen, parseGameHtml,
  placementAfterMove, chooseRepetitionAwareMove, shouldSkipMoveForNeutralized,
  type Piece, type Destination, type MoveCandidate,
} from "../src/bot-move";
import {
  isCacheableEngine, CACHEABLE_ENGINES, isUciLegal, type VerboseMove,
} from "../src/engine-precedence";

// Player blocks in BGA's game-page HTML look like:
//   "user_id":"<id>","status":"online","device":"desktop","language":"xx","player_name":"Name"
const block = (id: string, lang: string, name: string) =>
  `{"user_id":"${id}","status":"online","device":"desktop","language":"${lang}","player_name":"${name}"}`;
// Richer block, as the live game page actually serves it: flat metadata
// (grade/rank/country/is_premium) trails player_name before any nested object.
const richBlock = (id: string, lang: string, name: string, premium: boolean) =>
  `{"user_id":"${id}","status":"online","device":"desktop","language":"${lang}",` +
  `"player_name":"${name}","grade":"3","rank":1400,"karma":"100","country":"US",` +
  `"is_premium":${premium},"is_beginner":false,"languages":{"en":{"id":"en","level":"0"}}}`;

const BOT = "99861258";
const HTML = block(BOT, "en", "bot_stockfish") + "," + block("99999001", "es", "Javividoor");

describe("parseOpponent", () => {
  test("returns the non-bot player's id, name, and language", () => {
    expect(parseOpponent(HTML, BOT)).toEqual({
      id: "99999001", name: "Javividoor", language: "es",
    });
  });

  test("skips the bot block regardless of order", () => {
    const reversed = block("99999001", "es", "Javividoor") + "," + block(BOT, "en", "bot_stockfish");
    expect(parseOpponent(reversed, BOT)?.name).toBe("Javividoor");
  });

  test("returns null when only the bot is present", () => {
    expect(parseOpponent(block(BOT, "en", "bot_stockfish"), BOT)).toBeNull();
  });

  test("without a bot id, returns the first player block", () => {
    expect(parseOpponent(HTML, undefined)?.name).toBe("bot_stockfish");
  });

  test("decodes \\u-escaped non-ASCII names from the page HTML", () => {
    const html = block(BOT, "en", "bot_stockfish") + "," +
      block("85863988", "fr", "laglo\\u00efre");
    expect(parseOpponent(html, BOT)).toEqual({
      id: "85863988", name: "lagloïre", language: "fr",
    });
    // sanity: the decoded form is the real accented string, not the escape.
    expect(parseOpponent(html, BOT)?.name).toBe("lagloïre");
  });

  test("captures opponent premium membership from the rich block", () => {
    const html = richBlock(BOT, "en", "bot_stockfish", false) + "," +
      richBlock("99999001", "es", "Javividoor", true);
    expect(parseOpponent(html, BOT)).toEqual({
      id: "99999001", name: "Javividoor", language: "es", premium: true,
    });
  });

  test("reads premium=false and never picks up a neighbour's flag", () => {
    // Opponent is free; the bot block (premium) follows. The opponent's own
    // is_premium must win, not the next block's.
    const html = richBlock("99999001", "es", "Javividoor", false) + "," +
      richBlock(BOT, "en", "bot_stockfish", true);
    expect(parseOpponent(html, BOT)?.premium).toBe(false);
  });

  test("leaves premium undefined when the block lacks is_premium", () => {
    expect(parseOpponent(HTML, BOT)?.premium).toBeUndefined();
  });
});

describe("parseGameNeutralized", () => {
  test("false for a normal in-progress / finished game", () => {
    expect(parseGameNeutralized('"game_result_neutralized":"0","neutralized_player_id":"0"')).toBe(false);
    expect(parseGameNeutralized('"neutralized_player_id":null')).toBe(false);
    expect(parseGameNeutralized('"neutralized_player_id":""')).toBe(false);
    expect(parseGameNeutralized("no flags here")).toBe(false);
  });

  test("true when BGA flags the game as neutralized", () => {
    expect(parseGameNeutralized('"game_result_neutralized":"1","neutralized_player_id":"0"')).toBe(true);
  });

  test("true when a specific player was neutralized", () => {
    expect(parseGameNeutralized('"game_result_neutralized":"0","neutralized_player_id":"22430351"')).toBe(true);
  });
});

describe("shouldSkipMoveForNeutralized", () => {
  const clean = '"game_result_neutralized":"0","neutralized_player_id":"0"';

  test("plays normally when nothing is flagged", () => {
    // Not flagged and clean HTML → move (skip == false).
    expect(shouldSkipMoveForNeutralized(null, clean)).toBe(false);
    expect(shouldSkipMoveForNeutralized(undefined, clean)).toBe(false);
    expect(shouldSkipMoveForNeutralized(0, clean)).toBe(false);
  });

  test("skips the move while the opponent is flagged in the concede grace", () => {
    // oppQuitSince stamped by the live neutralized detector → no move, even
    // if the HTML hasn't surfaced game_result_neutralized yet.
    expect(shouldSkipMoveForNeutralized(Date.now(), clean)).toBe(true);
  });

  test("skips the move when the page HTML itself shows neutralized", () => {
    // Defense-in-depth: never stamped oppQuitSince, but the page says the
    // game is void → still no move (this is the "3 random moves" regression).
    expect(
      shouldSkipMoveForNeutralized(null, '"game_result_neutralized":"1","neutralized_player_id":"0"'),
    ).toBe(true);
    expect(
      shouldSkipMoveForNeutralized(null, '"neutralized_player_id":"22430351"'),
    ).toBe(true);
  });
});

describe("buildFen en passant target", () => {
  // BGA coords: x = file (0..7 = a..h), y = 0..7 from black's side, so a
  // square's rank = 8 - y. White pawn e5 = (4,3); black pawn d5 = (3,3).
  const epField = (fen: string) => fen.split(" ")[3];

  test("sets the ep target from an en-passant capture in the legal table", () => {
    // White pawn on e5 can capture en passant onto d6 (3,2); the captured
    // black pawn sits behind the target on d5 (3,3) — a DIFFERENT square.
    const pieces: Record<string, Piece> = {
      wp: { piece_id: "wp", piece_color: "white", piece_type: "pawn", piece_x: 4, piece_y: 3 },
      bp: { piece_id: "bp", piece_color: "black", piece_type: "pawn", piece_x: 3, piece_y: 3 },
    };
    const dests: Record<string, Destination[]> = {
      wp: [{ dest_x: 3, dest_y: 2, captured: [{ piece_x: 3, piece_y: 3 }] }],
    };
    expect(epField(buildFen(pieces, "white", dests))).toBe("d6");
  });

  test("leaves ep as '-' for an ordinary diagonal capture", () => {
    // White pawn e4 (4,4) capturing a black pawn that IS on the destination
    // square d5 (3,3) is a normal capture, not en passant.
    const pieces: Record<string, Piece> = {
      wp: { piece_id: "wp", piece_color: "white", piece_type: "pawn", piece_x: 4, piece_y: 4 },
      bp: { piece_id: "bp", piece_color: "black", piece_type: "pawn", piece_x: 3, piece_y: 3 },
    };
    const dests: Record<string, Destination[]> = {
      wp: [{ dest_x: 3, dest_y: 3, captured: [{ piece_x: 3, piece_y: 3 }] }],
    };
    expect(epField(buildFen(pieces, "white", dests))).toBe("-");
  });

  test("leaves ep as '-' when there are no captures available", () => {
    const pieces: Record<string, Piece> = {
      wp: { piece_id: "wp", piece_color: "white", piece_type: "pawn", piece_x: 4, piece_y: 4 },
    };
    const dests: Record<string, Destination[]> = {
      wp: [{ dest_x: 4, dest_y: 3 }],
    };
    expect(epField(buildFen(pieces, "white", dests))).toBe("-");
  });
});

describe("placementAfterMove", () => {
  const placementOf = (pieces: Record<string, Piece>) =>
    buildFen(pieces, "white").split(" ")[0];
  // Clone the pieces table with one piece relocated, so we can compare
  // placementAfterMove against the buildFen of the resulting position.
  const moved = (
    pieces: Record<string, Piece>, id: string, x: number, y: number,
  ): Record<string, Piece> => ({
    ...pieces, [id]: { ...pieces[id], piece_x: x, piece_y: y },
  });

  test("quiet move matches buildFen of the resulting position", () => {
    const pieces: Record<string, Piece> = {
      WK: { piece_id: "WK", piece_color: "white", piece_type: "king", piece_x: 4, piece_y: 7 },
      WN: { piece_id: "WN", piece_color: "white", piece_type: "knight", piece_x: 6, piece_y: 7 },
      BK: { piece_id: "BK", piece_color: "black", piece_type: "king", piece_x: 4, piece_y: 0 },
    };
    // Ng1 -> f3 (x6,y7 -> x5,y5)
    const after = placementAfterMove(pieces, "WN", { dest_x: 5, dest_y: 5 });
    expect(after).toBe(placementOf(moved(pieces, "WN", 5, 5)));
  });

  test("normal capture removes the piece on the destination square", () => {
    const pieces: Record<string, Piece> = {
      WR: { piece_id: "WR", piece_color: "white", piece_type: "rook", piece_x: 0, piece_y: 7 },
      BR: { piece_id: "BR", piece_color: "black", piece_type: "rook", piece_x: 0, piece_y: 0 },
      WK: { piece_id: "WK", piece_color: "white", piece_type: "king", piece_x: 4, piece_y: 7 },
      BK: { piece_id: "BK", piece_color: "black", piece_type: "king", piece_x: 4, piece_y: 0 },
    };
    // Ra1 x a8 (capture). Resulting board: white rook on a8, black rook gone.
    const after = placementAfterMove(pieces, "WR", {
      dest_x: 0, dest_y: 0, captured: [{ piece_x: 0, piece_y: 0 }],
    });
    expect(after).toBe("R3k3/8/8/8/8/8/8/4K3");
  });

  test("en passant removes the pawn behind the destination square", () => {
    // White pawn e5 (4,3) captures en passant to d6 (3,2); the black pawn
    // sits on d5 (3,3), a DIFFERENT square than the destination.
    const pieces: Record<string, Piece> = {
      WP: { piece_id: "WP", piece_color: "white", piece_type: "pawn", piece_x: 4, piece_y: 3 },
      BP: { piece_id: "BP", piece_color: "black", piece_type: "pawn", piece_x: 3, piece_y: 3 },
    };
    const after = placementAfterMove(pieces, "WP", {
      dest_x: 3, dest_y: 2, captured: [{ piece_x: 3, piece_y: 3 }],
    });
    // White pawn now on d6 (rank 6 = row 2), both d5 and e5 empty.
    expect(after).toBe("8/8/3P4/8/8/8/8/8");
  });

  test("kingside castling hops the rook to f1", () => {
    const pieces: Record<string, Piece> = {
      WK: { piece_id: "WK", piece_color: "white", piece_type: "king", piece_x: 4, piece_y: 7 },
      WR: { piece_id: "WR", piece_color: "white", piece_type: "rook", piece_x: 7, piece_y: 7 },
      BK: { piece_id: "BK", piece_color: "black", piece_type: "king", piece_x: 4, piece_y: 0 },
    };
    // O-O: king e1 -> g1 (x6,y7), rook h1 -> f1 (x5,y7).
    const after = placementAfterMove(pieces, "WK", {
      dest_x: 6, dest_y: 7, kingsideCastling: true,
    });
    expect(after).toBe("4k3/8/8/8/8/8/8/5RK1");
  });

  test("queenside castling hops the rook to d1", () => {
    const pieces: Record<string, Piece> = {
      WK: { piece_id: "WK", piece_color: "white", piece_type: "king", piece_x: 4, piece_y: 7 },
      WR: { piece_id: "WR", piece_color: "white", piece_type: "rook", piece_x: 0, piece_y: 7 },
      BK: { piece_id: "BK", piece_color: "black", piece_type: "king", piece_x: 4, piece_y: 0 },
    };
    // O-O-O: king e1 -> c1 (x2,y7), rook a1 -> d1 (x3,y7).
    const after = placementAfterMove(pieces, "WK", {
      dest_x: 2, dest_y: 7, queensideCastling: true,
    });
    expect(after).toBe("4k3/8/8/8/8/8/8/2KR4");
  });

  test("promotion turns the pawn into a queen", () => {
    const pieces: Record<string, Piece> = {
      WP: { piece_id: "WP", piece_color: "white", piece_type: "pawn", piece_x: 0, piece_y: 1 },
      BK: { piece_id: "BK", piece_color: "black", piece_type: "king", piece_x: 4, piece_y: 0 },
    };
    // a7 -> a8 promotion (x0,y1 -> x0,y0).
    const after = placementAfterMove(pieces, "WP", { dest_x: 0, dest_y: 0, promotion: true });
    expect(after).toBe("Q3k3/8/8/8/8/8/8/8");
  });

  test("returns null for an unknown piece id", () => {
    expect(placementAfterMove({}, "nope", { dest_x: 0, dest_y: 0 })).toBeNull();
  });
});

describe("chooseRepetitionAwareMove", () => {
  // White: king e1, knight g1, rook a1. Black: king e8. The knight's only
  // move (g1->f3) returns to a placement we'll seed into history twice; the
  // rook's move (a1->b1) reaches a fresh placement.
  const pieces: Record<string, Piece> = {
    WK: { piece_id: "WK", piece_color: "white", piece_type: "king", piece_x: 4, piece_y: 7 },
    WN: { piece_id: "WN", piece_color: "white", piece_type: "knight", piece_x: 6, piece_y: 7 },
    WR: { piece_id: "WR", piece_color: "white", piece_type: "rook", piece_x: 0, piece_y: 7 },
    BK: { piece_id: "BK", piece_color: "black", piece_type: "king", piece_x: 4, piece_y: 0 },
  };
  const dests: Record<string, Destination[]> = {
    WN: [{ dest_x: 5, dest_y: 5 }],
    WR: [{ dest_x: 1, dest_y: 7 }],
  };
  const knightPlacement = placementAfterMove(pieces, "WN", { dest_x: 5, dest_y: 5 })!;
  // Top candidate is the knight move; the rook move is the alternative.
  const candidates: MoveCandidate[] = [
    { uci: "g1f3", engine: "lichess-cloud-eval" },
    { uci: "a1b1", engine: "stockfish.online" },
  ];
  // Two prior occurrences → playing the knight move would be the 3rd.
  const repeatHistory = [knightPlacement, knightPlacement];

  test("dodges a threefold and swaps to the alternative when winning", () => {
    const pick = chooseRepetitionAwareMove(candidates, pieces, dests, repeatHistory, true);
    expect(pick).not.toBeNull();
    expect(pick!.engine).toBe("stockfish.online");
    expect(pick!.pieceId).toBe("WR");
    expect(pick!.avoidedRepetition).toBe(true);
  });

  test("keeps the engine's top move when not winning (a draw is fine)", () => {
    const pick = chooseRepetitionAwareMove(candidates, pieces, dests, repeatHistory, false);
    expect(pick!.engine).toBe("lichess-cloud-eval");
    expect(pick!.pieceId).toBe("WN");
    expect(pick!.avoidedRepetition).toBe(false);
  });

  test("keeps the top move when the repetition is forced (no alternative)", () => {
    const onlyKnight: MoveCandidate[] = [{ uci: "g1f3", engine: "lichess-cloud-eval" }];
    const pick = chooseRepetitionAwareMove(onlyKnight, pieces, dests, repeatHistory, true);
    expect(pick!.pieceId).toBe("WN");
    expect(pick!.avoidedRepetition).toBe(false);
  });

  test("keeps the top move when history shows no repetition", () => {
    const pick = chooseRepetitionAwareMove(candidates, pieces, dests, [], true);
    expect(pick!.pieceId).toBe("WN");
    expect(pick!.avoidedRepetition).toBe(false);
  });

  test("returns null when no candidate resolves to a legal move", () => {
    const bogus: MoveCandidate[] = [{ uci: "h2h4", engine: "lichess-cloud-eval" }];
    expect(chooseRepetitionAwareMove(bogus, pieces, dests, [], true)).toBeNull();
  });
});

describe("isCacheableEngine", () => {
  test("remote Stockfish/lichess engines are cacheable", () => {
    for (const e of [
      "lichess-cloud-eval", "stockfish.online", "chess-api.com",
      "rapidapi-stockfish-16", "stockfish-container",
    ]) {
      expect(isCacheableEngine(e)).toBe(true);
    }
  });

  test("local engine, random fallback, cache re-hits and unknowns are NOT cacheable", () => {
    expect(isCacheableEngine("js-chess-engine (local DO)")).toBe(false);
    expect(isCacheableEngine("random-fallback")).toBe(false);
    expect(isCacheableEngine("cache:lichess-cloud-eval")).toBe(false);
    expect(isCacheableEngine("cache:chess-api.com")).toBe(false);
    expect(isCacheableEngine("unknown")).toBe(false);
    expect(isCacheableEngine("")).toBe(false);
  });

  test("CACHEABLE_ENGINES is exactly the Stockfish/lichess source set", () => {
    expect([...CACHEABLE_ENGINES].sort()).toEqual([
      "chess-api.com",
      "lichess-cloud-eval",
      "rapidapi-stockfish-16",
      "stockfish-container",
      "stockfish.online",
    ]);
  });
});

describe("parseGameHtml neutralized_player_id", () => {
  // Minimal valid game page: parseGameHtml needs a "pieces" and "gamestate" blob.
  const base = '"pieces":{},"gamestate":{"id":3,"active_player":"99861258"}';

  test('"0" is the "nobody neutralized" sentinel → null (regression: must not look like a quit)', () => {
    expect(parseGameHtml(`${base},"neutralized_player_id":"0"`)?.neutralizedPlayerId).toBeNull();
  });

  test("a real neutralized player id is captured", () => {
    expect(parseGameHtml(`${base},"neutralized_player_id":"99999001"`)?.neutralizedPlayerId).toBe("99999001");
  });

  test("null / empty-string parse as null", () => {
    expect(parseGameHtml(`${base},"neutralized_player_id":null`)?.neutralizedPlayerId).toBeNull();
    expect(parseGameHtml(`${base},"neutralized_player_id":""`)?.neutralizedPlayerId).toBeNull();
  });
});

/**
 * Regression: an engine OOM/stale answer shipped an illegal move (king left in
 * check) that BGA refused, burning the table's error budget into a needless
 * concede. The engine DO now gates every winning move on chess.js's legal list
 * via isUciLegal; these cover the from/to and promotion matching it relies on.
 */
describe("isUciLegal", () => {
  const legal: VerboseMove[] = [
    { from: "e2", to: "e4" },
    { from: "g1", to: "f3" },
    { from: "e7", to: "e8", promotion: "q" },
    { from: "e7", to: "e8", promotion: "n" },
  ];

  test("accepts a plain legal move", () => {
    expect(isUciLegal(legal, "e2e4")).toBe(true);
    expect(isUciLegal(legal, "g1f3")).toBe(true);
  });

  test("rejects a move that isn't in the legal list (the illegal-move bug)", () => {
    expect(isUciLegal(legal, "e2e5")).toBe(false); // wrong destination
    expect(isUciLegal(legal, "d2d4")).toBe(false); // piece can't move
  });

  test("matches the exact promotion piece", () => {
    expect(isUciLegal(legal, "e7e8q")).toBe(true);
    expect(isUciLegal(legal, "e7e8n")).toBe(true);
    expect(isUciLegal(legal, "e7e8r")).toBe(false); // underpromotion not offered
  });

  test("a promotion UCI missing its suffix is tolerated as a queen promo", () => {
    expect(isUciLegal(legal, "e7e8")).toBe(true);
  });

  test("rejects malformed / too-short UCI", () => {
    expect(isUciLegal(legal, "")).toBe(false);
    expect(isUciLegal(legal, "e2")).toBe(false);
  });

  test("an empty legal list rejects everything (game over)", () => {
    expect(isUciLegal([], "e2e4")).toBe(false);
  });
});
