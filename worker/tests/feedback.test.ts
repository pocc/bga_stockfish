import { describe, expect, test } from "vitest";
import { toPublicFeedback, type FeedbackEntry } from "../src/feedback";

/**
 * The landing page lists past feedback publicly (the "Past feedback"
 * collapsible under the form). toPublicFeedback is the single projection the
 * /feedback/list handler runs before serving an entry, so it MUST drop every
 * sensitive field. A regression here would leak submitter contacts and IPs.
 */
describe("toPublicFeedback", () => {
  const full: FeedbackEntry = {
    ts: 1_700_000_000_000,
    source: "chat",
    message: "the bot played a great move",
    contact: "someone@example.com",
    ip: "203.0.113.7",
    tableId: "12345",
    oppId: "67890",
    oppName: "SomePlayer",
    oppLanguage: "fr",
  };

  test("keeps only ts, source, and message", () => {
    expect(toPublicFeedback(full)).toEqual({
      ts: 1_700_000_000_000,
      source: "chat",
      message: "the bot played a great move",
    });
  });

  test("never exposes contact, ip, or any opponent field", () => {
    const pub = toPublicFeedback(full) as Record<string, unknown>;
    for (const leaky of ["contact", "ip", "tableId", "oppId", "oppName", "oppLanguage"]) {
      expect(pub).not.toHaveProperty(leaky);
    }
  });

  test("round-trips a minimal web entry", () => {
    const min: FeedbackEntry = { ts: 1, source: "web", message: "hi" };
    expect(toPublicFeedback(min)).toEqual({ ts: 1, source: "web", message: "hi" });
  });
});
