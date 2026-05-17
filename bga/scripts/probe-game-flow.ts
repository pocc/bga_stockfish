/**
 * Create a fresh chess table, then aggressively probe in-table endpoints
 * (hotseat add, chess-specific play actions, game state, notifications).
 * Doesn't quit at the end so the user can spectate.
 *
 * Output: prints table id + spectator URL; writes recon/probes/results.json.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { BGAClient } from "../src/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "recon", "probes");

function loadEnv() {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const env = loadEnv();
  const client = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await client.login();

  const c = client as unknown as {
    request: (
      method: "GET" | "POST",
      url: string,
      body?: string | URLSearchParams,
      extraHeaders?: Record<string, string>,
    ) => Promise<Response>;
  };

  type Probe = { label: string; method: "GET" | "POST"; url: string; body?: string; status: number | string; preview: string };
  const probes: Probe[] = [];

  async function probe(label: string, method: "GET" | "POST", url: string, body?: string) {
    try {
      const resp = await c.request(method, url, body);
      const text = await resp.text();
      const trimmed = text.slice(0, 800).replace(/\n/g, " ");
      const ok = /"status":\s*1/.test(text);
      console.log(`${ok ? "✓" : "✗"} [${label}] ${resp.status} ${trimmed.slice(0, 200)}`);
      probes.push({ label, method, url, body, status: resp.status, preview: trimmed });
      return { ok, text, status: resp.status };
    } catch (e) {
      console.log(`ERR [${label}] ${e}`);
      probes.push({ label, method, url, body, status: "ERR", preview: String(e) });
      return { ok: false, text: "", status: 0 };
    }
  }

  // 1. Create a fresh table
  console.log("\n=== creating table ===");
  const createResp = await probe(
    "createnew",
    "POST",
    "https://en.boardgamearena.com/table/table/createnew.html",
    "game=81",
  );
  const tableMatch = /"table":\s*(\d+)/.exec(createResp.text);
  const table = tableMatch?.[1];
  if (!table) {
    fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(probes, null, 2));
    throw new Error("could not create table");
  }
  console.log(`\nTABLE: ${table}`);
  console.log(`SPECTATE: https://boardgamearena.com/table?table=${table}`);
  console.log(`     OR:  https://boardgamearena.com/4/chess?table=${table}\n`);

  // 2. Get table info (game in setup phase)
  console.log("=== table info / state ===");
  await probe(
    "tableinfos-GET",
    "GET",
    `https://en.boardgamearena.com/tablemanager/tablemanager/tableinfos.html?id=${table}&dojo.preventCache=${Date.now()}`,
  );
  await probe(
    "tableinfos-POST",
    "POST",
    `https://en.boardgamearena.com/tablemanager/tablemanager/tableinfos.html`,
    `id=${table}`,
  );
  await probe(
    "table-status",
    "GET",
    `https://en.boardgamearena.com/table/table/tableinfos.html?id=${table}`,
  );

  // 3. Suspected lobby endpoints that list MY tables / pending invites
  console.log("\n=== player-state / lobby-listing endpoints ===");
  const listingProbes: Array<[string, string, string?]> = [
    ["lobby-myTables", "POST", "https://en.boardgamearena.com/lobby/lobby/myTables.html"],
    ["lobby-getMyTables", "POST", "https://en.boardgamearena.com/lobby/lobby/getMyTables.html"],
    ["player-getCurrentGames", "POST", "https://en.boardgamearena.com/player/player/getCurrentGames.html"],
    ["player-getMyTables", "POST", "https://en.boardgamearena.com/player/player/getMyTables.html"],
    ["tablemanager-tableinfos-listMy", "GET", `https://en.boardgamearena.com/tablemanager/tablemanager/tableinfos.html?playerid=${"99861258"}&dojo.preventCache=${Date.now()}`],
    ["tablemanager-getMyTables", "POST", "https://en.boardgamearena.com/tablemanager/tablemanager/getMyTables.html"],
    ["tablemanager-myTables", "POST", "https://en.boardgamearena.com/tablemanager/tablemanager/myTables.html"],
    ["lobby-state", "POST", "https://en.boardgamearena.com/lobby/lobby/getState.html"],
    ["lobby-loadlobby", "POST", "https://en.boardgamearena.com/lobby/lobby/loadlobby.html"],
    // gameinprogress is the page; its XHR endpoint likely mirrors:
    ["gameinprogress-getTables", "POST", "https://en.boardgamearena.com/gameinprogress/gameinprogress/getTables.html"],
    ["gameinprogress-getMyGames", "POST", "https://en.boardgamearena.com/gameinprogress/gameinprogress/getMyGames.html"],
    ["gameinprogress-loadGames", "POST", "https://en.boardgamearena.com/gameinprogress/gameinprogress/loadGames.html"],
    ["notif-getNotifs", "POST", "https://en.boardgamearena.com/notif/notif/getNotifications.html"],
    ["notif-getPendingNotifs", "POST", "https://en.boardgamearena.com/notif/notif/getPendingNotifs.html"],
  ];
  for (const [label, method, url, body] of listingProbes) {
    await probe(label, method as "GET" | "POST", url, body);
  }

  // 4. Hotseat-specific guesses
  console.log("\n=== hotseat-add endpoint guesses ===");
  const hotseatProbes: Array<[string, string]> = [
    ["addHotseat", `https://en.boardgamearena.com/table/table/addHotseat.html`],
    ["addhotseat", `https://en.boardgamearena.com/table/table/addhotseat.html`],
    ["inviteHotseat", `https://en.boardgamearena.com/table/table/inviteHotseat.html`],
    ["hotseatAdd", `https://en.boardgamearena.com/table/table/hotseatAdd.html`],
    ["hotseatPlayer", `https://en.boardgamearena.com/table/table/hotseatPlayer.html`],
    ["addBot", `https://en.boardgamearena.com/table/table/addBot.html`],
    ["addLocalPlayer", `https://en.boardgamearena.com/table/table/addLocalPlayer.html`],
    ["createHotseat", `https://en.boardgamearena.com/table/table/createHotseat.html`],
    ["joinAsHotseat", `https://en.boardgamearena.com/table/table/joinAsHotseat.html`],
    ["addAi", `https://en.boardgamearena.com/table/table/addAi.html`],
  ];
  for (const [label, url] of hotseatProbes) {
    await probe(label, "POST", url, `table=${table}&name=Hotseat&player=Hotseat`);
  }

  // 5. Chess-specific play actions (BGA convention: /<game>/<game>/<action>.html?table=)
  console.log("\n=== chess play actions ===");
  const chessProbes: Array<[string, string, string?]> = [
    ["chess-playMove-e2e4", `https://en.boardgamearena.com/chess/chess/playMove.html?table=${table}`, "from=e2&to=e4"],
    ["chess-move-e2e4", `https://en.boardgamearena.com/chess/chess/move.html?table=${table}`, "from=e2&to=e4"],
    ["chess-makeMove-e2e4", `https://en.boardgamearena.com/chess/chess/makeMove.html?table=${table}`, "from=e2&to=e4"],
    ["chess-play-e2e4", `https://en.boardgamearena.com/chess/chess/play.html?table=${table}`, "from=e2&to=e4"],
    ["chess-resign", `https://en.boardgamearena.com/chess/chess/resign.html?table=${table}`],
    ["chess-giveUp", `https://en.boardgamearena.com/chess/chess/giveUp.html?table=${table}`],
    ["chess-offerDraw", `https://en.boardgamearena.com/chess/chess/offerDraw.html?table=${table}`],
    ["chess-acceptDraw", `https://en.boardgamearena.com/chess/chess/acceptDraw.html?table=${table}`],
    ["chess-notificationHistory", `https://en.boardgamearena.com/chess/chess/notificationHistory.html`, `table=${table}&from=0`],
    ["table-notificationHistory", `https://en.boardgamearena.com/table/table/notificationHistory.html`, `table=${table}&from=0`],
    ["chess-getGameState", `https://en.boardgamearena.com/chess/chess/getGameState.html?table=${table}`],
  ];
  for (const [label, url, body] of chessProbes) {
    await probe(label, "POST", url, body);
  }

  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(probes, null, 2));
  console.log(`\n✅ table ${table} still alive — do NOT quit until done spectating`);
  console.log(`Wrote ${probes.length} probe results to recon/probes/results.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
