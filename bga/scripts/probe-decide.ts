/** Probe likely "decide" / accept-abandon endpoints. */
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
  const TABLE = process.env.TABLE ?? "852792152";
  const c = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await c.login();
  const tryUrl = async (url: string, method: "GET" | "POST" = "GET", body?: string) => {
    const r = await (c as any).request(method, url, body, { referer: `https://boardgamearena.com/table?table=${TABLE}` });
    const t = await r.text();
    console.log(`${method} ${url}  → ${r.status} ${t.slice(0,200)}`);
  };
  // Most likely:
  await tryUrl(`https://boardgamearena.com/table/table/decide.html?id=${TABLE}&answer=1&dojo.preventCache=${Date.now()}`);
  await tryUrl(`https://en.boardgamearena.com/table/table/decide.html?id=${TABLE}&answer=1&dojo.preventCache=${Date.now()}`);
  await tryUrl(`https://boardgamearena.com/table/table/decide.html?table=${TABLE}&answer=1&dojo.preventCache=${Date.now()}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
