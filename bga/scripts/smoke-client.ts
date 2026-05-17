/**
 * Smoke-test the HTTP BGAClient (no Playwright).
 * Confirms we can log in via fetch() and hit a couple of authed endpoints.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BGAClient } from "../src/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const client = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });

  console.log("logging in...");
  const me = await client.login();
  console.log("logged in as:", me);

  console.log("\nchess panel data:");
  const panel = await client.gamePanel(81);
  console.log(JSON.stringify(panel, null, 2).slice(0, 800));

  console.log("\ntable counters:");
  const counters = await client.tableCounters();
  console.log(JSON.stringify(counters, null, 2).slice(0, 600));

  console.log("\nplayer feed:");
  const feed = await client.playerFeed();
  console.log(JSON.stringify(feed, null, 2).slice(0, 400));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
