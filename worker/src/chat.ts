/**
 * Split a chat message into chunks that each fit BGA's say.html length cap,
 * breaking only at sentence/line boundaries so a chunk never cuts off
 * mid-sentence. BGA drops chats fired too fast (the caller staggers them by
 * ~2s), so keeping each chunk a coherent sentence/paragraph makes the
 * staggered delivery read naturally.
 *
 * Boundary strength, strongest first:
 *   1. Newlines — list items and paragraphs stay on their own lines.
 *   2. Whole lines are greedily packed into a chunk up to `limit`, rejoined
 *      with their original newline.
 *   3. A line longer than `limit` is split at sentence ends (. ! ? followed
 *      by whitespace, so URLs like "ross.gg/" never split).
 *   4. A sentence longer than `limit` is split on word boundaries.
 */
export function chunkChat(msg: string, limit = 220): string[] {
  const chunks: string[] = [];
  let cur = "";
  const flush = () => { const t = cur.trim(); if (t) chunks.push(t); cur = ""; };

  const addLine = (line: string) => {
    const candidate = cur === "" ? line : `${cur}\n${line}`;
    if (candidate.length <= limit) { cur = candidate; return; }
    flush();
    if (line.length <= limit) { cur = line; return; }
    // Line too long on its own: fall back to sentence- then word-splitting.
    for (const seg of splitLongLine(line, limit)) {
      if (cur && cur.length + 1 + seg.length > limit) flush();
      cur = cur ? `${cur} ${seg}` : seg;
    }
  };

  for (const line of msg.split("\n")) addLine(line);
  flush();
  return chunks;
}

/**
 * BGA's say.html enforces a minimum gap between two chats and silently rejects
 * the second with "There is a minimum of 1 second between messages". Separate
 * sendChat() calls fired close together (e.g. a greeting immediately followed
 * by a difficulty-keyword reply, or two reaction chats on the same tick)
 * tripped this and dropped the second message. We use 1.1s of headroom over
 * BGA's 1s so clock skew can't shave us under the limit. */
export const CHAT_MIN_SPACING_MS = 1_100;

/**
 * How long to wait before the next chat send so it clears BGA's anti-flood
 * window. `lastSentAt` is when we last handed a chat to BGA (0 if never).
 * Returns 0 once enough time has already elapsed. Pure so the pacing logic is
 * unit-testable without real timers.
 */
export function chatPaceDelayMs(
  now: number,
  lastSentAt: number,
  minSpacing: number = CHAT_MIN_SPACING_MS,
): number {
  if (!lastSentAt) return 0;
  // Clamp to [0, minSpacing]: never negative, and never more than one full
  // window even if the clock jumped backwards (lastSentAt > now), so a clock
  // skew can't wedge the bot into a multi-second/longer chat stall.
  return Math.min(minSpacing, Math.max(0, minSpacing - (now - lastSentAt)));
}

/** Split an over-long line into <=limit pieces at sentence then word breaks. */
function splitLongLine(line: string, limit: number): string[] {
  const out: string[] = [];
  for (const sentence of line.split(/(?<=[.!?])\s+/)) {
    if (sentence.length <= limit) { out.push(sentence); continue; }
    let cur = "";
    for (const word of sentence.split(" ")) {
      if (cur && cur.length + 1 + word.length > limit) { out.push(cur); cur = word; }
      else cur = cur ? `${cur} ${word}` : word;
    }
    if (cur) out.push(cur);
  }
  return out;
}
