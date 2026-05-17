/** Send a single chat line on a table. Usage: TABLE=<id> MSG="..." npx tsx scripts/chat-once.ts */
import { BGAClient } from "../src/client.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
async function main() {
  const TABLE = process.env.TABLE!;
  const MSG = process.env.MSG!;
  if (!TABLE || !MSG) throw new Error("required env: TABLE MSG");
  const c = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await c.login();
  const r = await c.chat(TABLE, MSG);
  console.log("→", JSON.stringify(r).slice(0, 200));
}
main().catch((e) => { console.error(e); process.exit(1); });
