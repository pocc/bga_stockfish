/** Cancel all setup tables the bot is currently sitting at. Useful before testing. */
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
const c = new BGAClient({
  username: env.BGA_USERNAME,
  password: env.BGA_PASSWORD,
  cookieJarPath: path.join(root, "recon", "client-cookies.json"),
});
await c.login();
const ts = await c.myTables(81);
console.log(`bot is at ${ts.length} table(s)`);
for (const t of ts) {
  console.log(`  quitting ${t.id} (status=${t.status})`);
  const r = await c.quitTable(t.id);
  console.log(`    → ${JSON.stringify(r).slice(0, 200)}`);
}
