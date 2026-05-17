/**
 * Probe in-table operations against an existing chess table.
 * Use after creating a table via probe-createnew-http.ts.
 *
 * Pass the table id via env: TABLE=852786524 npx tsx scripts/probe-table-ops.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { BGAClient } from "../src/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
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
  console.log("logged in OK; probing table", table);

  const c = client as unknown as {
    request: (
      method: "GET" | "POST",
      url: string,
      body?: string | URLSearchParams,
      extraHeaders?: Record<string, string>,
    ) => Promise<Response>;
  };

  async function probe(label: string, method: "GET" | "POST", url: string, body?: string) {
    try {
      const resp = await c.request(method, url, body);
      const text = await resp.text();
      const trimmed = text.slice(0, 400).replace(/\n/g, " ");
      const ok = /"status":\s*1/.test(text);
      console.log(`${ok ? "✓" : "✗"} [${label}] ${method} ${url} ${body ? `body=${body}` : ""} → ${resp.status} ${trimmed}`);
      return text;
    } catch (e) {
      console.log(`ERR [${label}] ${method} ${url} → ${e}`);
      return null;
    }
  }

  // 1. Get table info — should work and show state.
  await probe(
    "tableinfos",
    "GET",
    `https://en.boardgamearena.com/tablemanager/tablemanager/tableinfos.html?id=${table}`,
  );
  await probe(
    "tableinfos-post",
    "POST",
    `https://en.boardgamearena.com/tablemanager/tablemanager/tableinfos.html`,
    `id=${table}`,
  );

  // 2. Suspected lobby/table state endpoints for the seating page.
  const tableUrls = [
    [`https://en.boardgamearena.com/table/table/joingame.html`, `table=${table}`],
    [`https://en.boardgamearena.com/table/table/addhotseat.html`, `table=${table}&name=Hotseat`],
    [`https://en.boardgamearena.com/table/table/inviteHotseat.html`, `table=${table}&name=Hotseat`],
    [`https://en.boardgamearena.com/table/table/addHotseatPlayer.html`, `table=${table}&name=Hotseat`],
    [`https://en.boardgamearena.com/table/table/hotseatJoin.html`, `table=${table}&name=Hotseat`],
    [`https://en.boardgamearena.com/table/table/openTable.html`, `table=${table}`],
    [`https://en.boardgamearena.com/table/table/changeoption.html`, `table=${table}&id=200&value=1`],
    [`https://en.boardgamearena.com/table/table/acceptStart.html`, `table=${table}`],
    [`https://en.boardgamearena.com/table/table/startgame.html`, `table=${table}`],
    [`https://en.boardgamearena.com/table/table/quitgame.html`, `table=${table}`],
    [`https://en.boardgamearena.com/table/table/decline.html`, `table=${table}`],
    [`https://en.boardgamearena.com/table/table/say.html`, `table=${table}&msg=hello`],
  ];
  for (const [url, body] of tableUrls) {
    await probe("table-op", "POST", url, body);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
