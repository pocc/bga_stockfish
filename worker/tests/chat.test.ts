import { describe, expect, test } from "vitest";
import { chunkChat, chatPaceDelayMs, CHAT_MIN_SPACING_MS } from "../src/chat";

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

/**
 * Regression: 7 production "There is a minimum of 1 second between messages"
 * rejections. Two separate sendChat() calls (greeting then a reply, or two
 * reaction chats on one tick) fired <1s apart and BGA dropped the second.
 * chatPaceDelayMs computes the wait that keeps every send >=CHAT_MIN_SPACING_MS
 * apart.
 */
describe("chatPaceDelayMs", () => {
  test("no wait when we've never sent a chat", () => {
    expect(chatPaceDelayMs(1_000_000, 0)).toBe(0);
  });

  test("waits the remaining gap when the last send was too recent", () => {
    const now = 1_000_000;
    // last send 300ms ago → wait the rest of the 1100ms window.
    expect(chatPaceDelayMs(now, now - 300)).toBe(CHAT_MIN_SPACING_MS - 300);
  });

  test("no wait once the spacing has fully elapsed", () => {
    const now = 1_000_000;
    expect(chatPaceDelayMs(now, now - CHAT_MIN_SPACING_MS)).toBe(0);
    expect(chatPaceDelayMs(now, now - 5_000)).toBe(0);
  });

  test("a backwards clock (future lastSentAt) caps the wait at one window, not unbounded", () => {
    // lastSentAt > now → elapsed is negative; the wait must clamp to minSpacing
    // so a clock skew can't stall the bot's chat for a long time.
    expect(chatPaceDelayMs(1_000_000, 1_500_000)).toBe(CHAT_MIN_SPACING_MS);
  });

  test("the spacing exceeds BGA's 1s floor so clock skew can't undershoot", () => {
    expect(CHAT_MIN_SPACING_MS).toBeGreaterThan(1_000);
  });

  test("honors a custom spacing argument", () => {
    expect(chatPaceDelayMs(1_000, 600, 1_000)).toBe(600);
  });
});
