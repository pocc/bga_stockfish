import { describe, expect, test } from "vitest";
import { parseOpponent, buildFen, parseGameHtml, type Piece, type Destination } from "../src/bot-move";

// Player blocks in BGA's game-page HTML look like:
//   "user_id":"<id>","status":"online","device":"desktop","language":"xx","player_name":"Name"
const block = (id: string, lang: string, name: string) =>
  `{"user_id":"${id}","status":"online","device":"desktop","language":"${lang}","player_name":"${name}"}`;

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
