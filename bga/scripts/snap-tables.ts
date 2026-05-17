/** One-shot dump of bot's current tables. */
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
const uid = await c.resolveUserId();
console.log("me uid:", uid);
const ts = await c.myTables(81);
console.log(JSON.stringify(ts, null, 2));
