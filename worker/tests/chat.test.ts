import { describe, expect, test } from "vitest";
import { chunkChat } from "../src/chat";

const GREETING =
  "Hi! I'm bot_stockfish, a chess bot on Board Game Arena https://stockfish.ross.gg/ \n" +
  "My default is Stockfish (~2800), a grandmaster-strength chess bot based on work done by https://stockfishchess.org/ \n\n" +
  "Want to change the difficulty? At any time, type one of these five words to set my level:\n\n" +
  "beginner (~700)\neasy (~1000)\nintermediate (~1300)\nadvanced (~1600)\nexpert (~1800)\n\nGood luck!";

describe("chunkChat", () => {
  test("keeps every chunk under the limit", () => {
    for (const c of chunkChat(GREETING, 220)) expect(c.length).toBeLessThanOrEqual(220);
  });

  test("never splits a sentence across chunks", () => {
    const chunks = chunkChat(GREETING, 220);
    // The prompt's two sentences must stay together, not split as before.
    const promptChunk = chunks.find((c) => c.includes("Want to change the difficulty?"));
    expect(promptChunk).toBeDefined();
    expect(promptChunk).toContain("At any time");
  });

  test("keeps the whole difficulty list in one chunk", () => {
    const chunks = chunkChat(GREETING, 220);
    const listChunk = chunks.find((c) => c.includes("beginner (~700)"));
    expect(listChunk).toContain("easy (~1000)");
    expect(listChunk).toContain("expert (~1800)");
  });

  test("does not split inside a URL", () => {
    for (const c of chunkChat(GREETING, 220)) {
      if (c.includes("stockfish.ross")) expect(c).toContain("stockfish.ross.gg/");
    }
  });

  test("a short single-sentence message stays one chunk", () => {
    expect(chunkChat("Good game!", 220)).toEqual(["Good game!"]);
  });

  test("a single line longer than the limit falls back to sentence splitting", () => {
    const long = "First sentence is here. " + "x".repeat(10) + ". Second sentence follows here too.";
    const chunks = chunkChat(long, 30);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(30);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
