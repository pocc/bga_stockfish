/**
 * Non-disruptive live createnew health check.
 *
 * Logs in as the SECONDARY account (so the production bot's primary-account
 * session is untouched), calls createnew.html for realtime + async, and
 * reports whether BGA returns valid JSON (healthy) or an HTML error page
 * (the 2026-05-29 outage signature: createTable non-json: <html>...).
 *
 * Crucially it does NOT call openTableNow, so the created table is never
 * published to the lobby and no real human can join it. Each created table
 * is quit immediately.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { BGAClient } from "../src/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  const env = loadEnv();
  // Secondary account keeps the production bot's primary session intact.
  const username = env.BGA_USERNAME2 || env.BGA_USERNAME;
  const password = env.BGA_PASSWORD2 || env.BGA_PASSWORD;
  const jar = env.BGA_USERNAME2 ? "client2-cookies.json" : "client-cookies.json";
  const client = new BGAClient({
    username,
    password,
    cookieJarPath: path.join(root, "recon", jar),
  });
  await client.login();
  console.log(`logged in OK as ${username}\n`);

  const c = client as unknown as {
    request: (
      method: "GET" | "POST",
      url: string,
      body?: string | URLSearchParams,
    ) => Promise<Response>;
  };

  async function quit(id: string) {
    await c.request(
      "POST",
      "https://boardgamearena.com/table/table/quitgame.html",
      new URLSearchParams({ table: id, neutralized: "true" }),
    ).catch(() => {});
  }

  async function probe(mode: "realtime" | "async") {
    const qs = new URLSearchParams({
      game: "81",
      gamemode: mode,
      ...(mode === "realtime" ? { forceManual: "true" } : {}),
      is_meeting: "false",
      "dojo.preventCache": String(Date.now()),
    });
    const url = `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`;
    const resp = await c.request("GET", url);
    const text = await resp.text();
    const looksHtml = /^\s*<(?:!doctype|html)/i.test(text);
    let id: string | null = null;
    let parsed: unknown = null;
    try {
      const j = JSON.parse(text);
      parsed = j;
      if (j?.status === 1 && j?.data?.table) id = String(j.data.table);
    } catch {}
    const verdict = id
      ? `JSON OK (table=${id}) — createnew HEALTHY`
      : looksHtml
        ? "HTML PAGE — createnew BLOCKED/DOWN (2026-05-29 signature)"
        : "non-json, no table";
    console.log(`[${mode}] HTTP ${resp.status}  ${verdict}`);
    if (!id) console.log(`  body: ${text.slice(0, 200).replace(/\s+/g, " ")}`);
    else console.log(`  envelope: ${JSON.stringify(parsed).slice(0, 160)}`);
    // Clean up immediately; never published, so this just frees the slot.
    if (id) await quit(id);
  }

  console.log("=== createnew live health check (no publish) ===");
  await probe("realtime");
  await new Promise((r) => setTimeout(r, 800));
  await probe("async");
  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
