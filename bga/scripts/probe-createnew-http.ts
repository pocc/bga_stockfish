/**
 * Probe table-creation directly via BGAClient (Node fetch + cookie jar).
 * The Playwright in-page probe failed with 806 likely because the older
 * auth-state.json has stale session bits — the HTTP client refreshes via
 * login() if needed.
 *
 * Tries several body shapes against POST /table/table/createnew.html.
 * Prints status + first 600 chars of every response.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

// Re-import the client but call its private `request` via a small subclass
// hack — simplest to just inline a tiny request fn here.
import { BGAClient } from "../src/client.js";

async function main() {
  const env = loadEnv();
  const client = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await client.login();
  console.log("logged in OK");

  // Reach into the client's internals: use a small post helper that mirrors
  // its CSRF + cookie behavior. Easiest: just bolt a public method on via
  // (client as any) and hit the URL.
  const c = client as unknown as {
    request: (
      method: "GET" | "POST",
      url: string,
      body?: string | URLSearchParams,
      extraHeaders?: Record<string, string>,
    ) => Promise<Response>;
  };

  const bodies = [
    "game=81",
    "game=81&gamemode=realtime",
    "game=81&gamemode=realtime&forceManual=true",
    "game=81&gamemode=realtime&access=friend",
    "game=81&gamemode=realtime&access=invitation",
    "game=81&gamemode=realtime&numplayers=2&access=friend",
    "game=81&gamemode=realtime&minplayers=2&maxplayers=2&access=friend",
    "game=81&gamemode=async&access=friend",
    "game=81&gamemode=realtime&hotseat=true",
  ];

  for (const body of bodies) {
    const resp = await c.request(
      "POST",
      "https://en.boardgamearena.com/table/table/createnew.html",
      body,
    );
    const text = await resp.text();
    const ok = /"status":\s*1/.test(text);
    console.log(`${ok ? "✓" : "✗"} ${body} → ${resp.status} ${text.slice(0, 220).replace(/\n/g, " ")}`);
    if (ok) {
      console.log("HIT — full response:", text);
      const m = /"table_id":\s*"?(\d+)/.exec(text);
      if (m) {
        console.log("");
        console.log("============================================================");
        console.log(`Spectator URL: https://boardgamearena.com/table?table=${m[1]}`);
        console.log(`         also: https://boardgamearena.com/4/chess?table=${m[1]}`);
        console.log("============================================================");
      }
      break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
