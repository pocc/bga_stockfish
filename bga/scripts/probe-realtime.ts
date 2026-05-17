/**
 * Interactive probe: try createnew with various params for gamemode=realtime,
 * call openTableNow to publish, query tableinfos to read the actual status,
 * then leave the table — all sequentially since BGA enforces one
 * unpublished table per user per game.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { BGAClient } from "../src/client.js";

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

async function main() {
  const env = loadEnv();
  const client = new BGAClient({
    username: env.BGA_USERNAME,
    password: env.BGA_PASSWORD,
    cookieJarPath: path.join(root, "recon", "client-cookies.json"),
  });
  await client.login();
  console.log("logged in OK as", env.BGA_USERNAME);

  const c = client as unknown as {
    request: (
      method: "GET" | "POST",
      url: string,
      body?: string | URLSearchParams,
      extraHeaders?: Record<string, string>,
    ) => Promise<Response>;
  };

  async function tableStatus(id: string): Promise<string> {
    // Try multiple status filters to find the table regardless of state.
    for (const status of ["open", "init", "asyncopen", "setup"]) {
      const qs = new URLSearchParams({ status, games: "81", turninfo: "false" });
      const r = await c.request(
        "POST",
        "https://boardgamearena.com/tablemanager/tablemanager/tableinfos.html",
        qs,
      );
      const j = (await r.json()) as { data?: { tables?: Record<string, { status?: string }> } };
      const t = j?.data?.tables?.[id];
      if (t?.status) return t.status;
    }
    return "?(not-found)";
  }

  async function quit(id: string) {
    const body = new URLSearchParams({ table: id, neutralized: "true" });
    await c.request("POST", "https://boardgamearena.com/table/table/quitgame.html", body);
  }

  async function tryVariant(label: string, builder: () => Promise<Response>): Promise<void> {
    const resp = await builder();
    const text = await resp.text();
    let id: string | null = null;
    try {
      const j = JSON.parse(text);
      if (j?.status === 1 && j?.data?.table) id = String(j.data.table);
    } catch {}
    if (!id) {
      console.log(`  ✗ ${label} → ${resp.status}: ${text.slice(0, 180)}`);
      return;
    }
    // Publish to lobby (this is what BGA's UI does after createnew).
    const pubResp = await c.request(
      "POST",
      "https://en.boardgamearena.com/table/table/openTableNow.html",
      new URLSearchParams({ table: id }),
    );
    const pubText = await pubResp.text();
    const pubOk = /"status":\s*1/.test(pubText);
    // Poll status — give BGA a moment to index.
    let status = "?";
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 400));
      status = await tableStatus(id);
      if (status !== "?(not-found)") break;
    }
    const verdict =
      status === "open" ? "REALTIME ✓" :
      status === "asyncopen" ? "ASYNC ✗" :
      `?(${status})`;
    console.log(`  ${verdict.padEnd(12)} ${label}  table=${id}  openTableNow=${pubOk ? "ok" : "FAIL"}`);
    await quit(id);
  }

  console.log("");
  console.log("=== Probing createnew variants ===");

  await tryVariant("GET realtime (no forceManual)", () => {
    const qs = new URLSearchParams({
      game: "81", gamemode: "realtime", is_meeting: "false",
      "dojo.preventCache": String(Date.now()),
    });
    return c.request("GET", `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`);
  });

  await tryVariant("GET realtime + forceManual=true (bot's current code)", () => {
    const qs = new URLSearchParams({
      game: "81", gamemode: "realtime", forceManual: "true", is_meeting: "false",
      "dojo.preventCache": String(Date.now()),
    });
    return c.request("GET", `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`);
  });

  await tryVariant("GET realtime + realtimemode=normal", () => {
    const qs = new URLSearchParams({
      game: "81", gamemode: "realtime", realtimemode: "normal", is_meeting: "false",
      "dojo.preventCache": String(Date.now()),
    });
    return c.request("GET", `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`);
  });

  await tryVariant("GET async (control)", () => {
    const qs = new URLSearchParams({
      game: "81", gamemode: "async", is_meeting: "false",
      "dojo.preventCache": String(Date.now()),
    });
    return c.request("GET", `https://boardgamearena.com/table/table/createnew.html?${qs.toString()}`);
  });

  await tryVariant("POST realtime (legacy bot code)", () => {
    return c.request(
      "POST",
      "https://en.boardgamearena.com/table/table/createnew.html",
      new URLSearchParams({ game: "81", gamemode: "realtime", is_meeting: "false" }),
    );
  });

  console.log("");
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
