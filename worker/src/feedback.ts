/**
 * Pure feedback value-helpers, kept free of any Cloudflare/Durable-Object
 * imports so they can be unit-tested in plain Node (importing src/index.ts
 * pulls in `cloudflare:workers` via the DO modules, which vitest can't
 * resolve). The Env-dependent piece (notifyFeedbackWebhook) stays in index.ts.
 */

/** Shared shape used for the Discord notification. Both feedback paths
 *  (web POST and in-game chat) build one of these. */
export interface FeedbackEntry {
  ts: number;
  source: "web" | "chat";
  message: string;
  contact?: string;
  ip?: string;
  tableId?: string;
  oppId?: string;
  oppName?: string;
  oppLanguage?: string;
}

/** Per-entry KV key. ISO timestamp sorts lexically + a short random suffix
 *  guards against same-ms collisions. Shared by web + chat feedback paths. */
export function feedbackKey(ts: number): string {
  const iso = new Date(ts).toISOString();
  const rand = Math.random().toString(36).slice(2, 8);
  return `feedback:${iso}:${rand}`;
}

/** The only feedback fields safe to expose publicly (landing-page list).
 *  Deliberately projects to {ts, source, message} and drops contact, ip,
 *  and every opp* field — those are PII and stay behind the admin route.
 *  Keep this as the single source of truth for the public shape so the
 *  /feedback/list handler can never accidentally leak a new sensitive
 *  field added to FeedbackEntry later. */
export type PublicFeedbackEntry = Pick<FeedbackEntry, "ts" | "source" | "message">;
export function toPublicFeedback(e: FeedbackEntry): PublicFeedbackEntry {
  return { ts: e.ts, source: e.source, message: e.message };
}
