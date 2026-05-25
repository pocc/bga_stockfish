import { describe, expect, test } from "vitest";
import { parseGameLog, reconstructMoves, type RawMoveEntry } from "../src/game-log";

const W = "100"; // white player id (first mover)
const B = "200";

// BGA's notation uses unicode glyphs + long algebraic, wrapped in a span.
const mv = (player: string, notation: string): RawMoveEntry => ({ player_id: player, notation });

describe("parseGameLog", () => {
  test("pulls pieceMoved notations in order, stripping HTML", () => {
    const log = {
      logs: [
        { data: [
          { type: "gameStateChange", args: { id: 2 } },
          { type: "pieceMoved", args: { player_id: W, notation: "<span class='chess_notation'>♙e2-e4</span>" } },
        ] },
        { data: [
          { type: "pieceMoved", args: { player_id: B, notation: "♟e7-e5" } },
        ] },
      ],
    };
    expect(parseGameLog(log)).toEqual([
      { player_id: W, notation: "♙e2-e4" },
      { player_id: B, notation: "♟e7-e5" },
    ]);
  });

  test("ignores non-pieceMoved notifications", () => {
    const log = { logs: [{ data: [{ type: "updateReflexionTime", args: { delta: "1" } }] }] };
    expect(parseGameLog(log)).toEqual([]);
  });
});

describe("reconstructMoves", () => {
  test("normal moves → UCI list + final FEN", () => {
    const { uci, finalFen } = reconstructMoves([
      mv(W, "♙e2-e4"), mv(B, "♟e7-e5"), mv(W, "♘g1-f3"),
    ]);
    expect(uci).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(finalFen).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2");
  });

  test("captures parse from-to off the × notation", () => {
    // 1.e4 d5 2.exd5 Qxd5 — capture glyphs trail the destination square.
    const { uci } = reconstructMoves([
      mv(W, "♙e2-e4"), mv(B, "♟d7-d5"), mv(W, "♙e4×d5♟"), mv(B, "♛d8×d5♙"),
    ]);
    expect(uci).toEqual(["e2e4", "d7d5", "e4d5", "d8d5"]);
  });

  test("collapses the duplicate castling log into one king move", () => {
    const { uci, finalFen } = reconstructMoves([
      mv(W, "♙e2-e4"), mv(B, "♟e7-e5"),
      mv(W, "♗f1-c4"), mv(B, "♝f8-c5"),
      mv(W, "♘g1-f3"), mv(B, "♞g8-f6"),
      mv(W, "0-0"), mv(W, "0-0"), // king half + rook half, same notation
    ]);
    expect(uci).toEqual(["e2e4", "e7e5", "f1c4", "f8c5", "g1f3", "g8f6", "e1g1"]);
    expect(finalFen).toBe("rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4");
  });

  test("black queenside castle uses rank 8", () => {
    const { uci } = reconstructMoves([mv(W, "♙e2-e4"), mv(B, "0-0-0"), mv(B, "0-0-0")]);
    expect(uci).toEqual(["e2e4", "e8c8"]);
  });

  test("appends queen promotion when a pawn reaches the back rank", () => {
    // BGA logs the push without "=Q"; we assume a queen (its own behavior).
    const { uci } = reconstructMoves([mv(W, "♙g7-g8")]);
    expect(uci).toEqual(["g7g8q"]);
  });

  test("empty log yields no moves", () => {
    expect(reconstructMoves([])).toEqual({ uci: [], finalFen: null });
  });
});
