/**
 * Verify chatHistory.html response shape on a live table.
 *
 *   TABLE=<id> npx tsx scripts/probe-chat.ts
 */
import { BGAClient } from "../src/client.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const table = process.env.TABLE;
  if (!table) throw new Error("set TABLE=<id>");
  const env = loadEnv();
  const client = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await client.login();
  const msgs = await client.chatHistory(table);
  console.log(`got ${msgs.length} messages`);
  for (const m of msgs) console.log(JSON.stringify(m));
}

main().catch((e) => { console.error(e); process.exit(1); });
