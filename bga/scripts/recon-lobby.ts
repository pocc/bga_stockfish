/**
 * Reconnaissance pass #2: explore the lobby, invitations, and chess game
 * pages while logged in.
 *
 * - Reuses recon/auth-state.json from pass #1 (skip login)
 * - Tries a battery of BGA URLs to find the invitations list, game lobby,
 *   and realtime/notification feeds.
 * - Visits the chess game page and captures the table-creation/join flow.
 * - Dumps everything to recon/lobby-summary.md + captured-requests.json
 */
import { chromium, type Request, type Response } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reconDir = path.join(root, "recon");
const shotsDir = path.join(reconDir, "screenshots");

interface CapturedRequest {
  method: string;
  url: string;
  status?: number;
  contentType?: string;
  hasBody: boolean;
  bodyPreview?: string;
  responsePreview?: string;
  timing: number;
}

async function main() {
  fs.mkdirSync(shotsDir, { recursive: true });
  const authStatePath = path.join(reconDir, "auth-state.json");
  if (!fs.existsSync(authStatePath)) {
    throw new Error("auth-state.json missing — run recon-login.ts first");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authStatePath,
    recordHar: { path: path.join(reconDir, "lobby.har"), content: "embed" },
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const captured: CapturedRequest[] = [];
  const start = Date.now();
  page.on("request", (req: Request) => {
    captured.push({
      method: req.method(),
      url: req.url(),
      hasBody: !!req.postData(),
      bodyPreview: req.postData()?.slice(0, 400),
      timing: Date.now() - start,
    });
  });
  page.on("response", async (resp: Response) => {
    const url = resp.url();
    const rec = captured.find((r) => r.url === url && r.status === undefined);
    if (rec) {
      rec.status = resp.status();
      rec.contentType = resp.headers()["content-type"];
      try {
        if (rec.contentType?.includes("json") || rec.contentType?.includes("text") || rec.contentType?.includes("html")) {
          const body = await resp.text().catch(() => "");
          rec.responsePreview = body.slice(0, 800);
        }
      } catch {
        // ignore
      }
    }
  });

  // Verify we're still logged in
  console.log("verifying logged-in session...");
  await page.goto("https://boardgamearena.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shotsDir, "lobby-01-home.png"), fullPage: false });

  // Capture the in-page `globalUserInfos` / `dojo.byId` style data BGA exposes
  const homeProbe = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return {
      title: document.title,
      hasGameui: typeof w.gameui !== "undefined",
      bgaUser: w.bgaUser ?? null,
      globalUserInfos: w.globalUserInfos ?? null,
      url: location.href,
      // grep all <a href> linking to /player, /table, /gamepanel, /community
      links: Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => /\/(player|table|gamepanel|community|gamelist|tournament|tablemanager|account|lobbyinvitation|playerinvitation|notif|inscriptions|invitations?)/.test(h))
        .filter((h, i, arr) => arr.indexOf(h) === i)
        .slice(0, 80),
    };
  });
  fs.writeFileSync(path.join(reconDir, "home-probe.json"), JSON.stringify(homeProbe, null, 2));
  console.log("homeProbe.links count:", homeProbe.links.length);

  // Probe a battery of likely lobby/invitation URLs
  const probes = [
    "https://boardgamearena.com/gamelist?game=chess",
    "https://boardgamearena.com/gameinprogress",
    "https://boardgamearena.com/lobby",
    "https://boardgamearena.com/lobbyinvitation",
    "https://boardgamearena.com/playerinvitation",
    "https://boardgamearena.com/community",
    "https://boardgamearena.com/tournaments",
    "https://boardgamearena.com/player",
    "https://boardgamearena.com/account",
    "https://boardgamearena.com/welcome",
    "https://boardgamearena.com/gameranking?game=chess",
    "https://boardgamearena.com/gamepanel?game=chess",
  ];

  const probeResults: Array<{ url: string; status: number; title: string; finalUrl: string }> = [];
  for (const url of probes) {
    console.log(" probing:", url);
    const resp = await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
    await page.waitForTimeout(800);
    probeResults.push({
      url,
      status: resp?.status() ?? 0,
      title: (await page.title()) || "",
      finalUrl: page.url(),
    });
  }
  fs.writeFileSync(path.join(reconDir, "url-probes.json"), JSON.stringify(probeResults, null, 2));

  // Land on the chess game panel for a thorough look
  console.log("loading chess game panel...");
  await page.goto("https://boardgamearena.com/gamepanel?game=chess", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(shotsDir, "lobby-02-chess-panel.png"), fullPage: true });

  // Probe the chess panel for globals / game id
  const chessProbe = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return {
      title: document.title,
      url: location.href,
      gameui: typeof w.gameui !== "undefined",
      // chess panel often exposes these via inline scripts:
      gameName: (w as Record<string, unknown>).game_name ?? null,
      gameId: (w as Record<string, unknown>).game_id ?? null,
      gameInternalName: (w as Record<string, unknown>).game_internal_name ?? null,
      // Try to find any element with data-game-id
      dataGameIds: Array.from(document.querySelectorAll("[data-game-id]"))
        .map((el) => (el as HTMLElement).getAttribute("data-game-id"))
        .filter((v, i, arr) => v && arr.indexOf(v) === i),
      bodyTextSnippet: document.body.innerText.slice(0, 400),
    };
  });
  fs.writeFileSync(path.join(reconDir, "chess-panel-probe.json"), JSON.stringify(chessProbe, null, 2));

  // Try the chess realtime endpoint typically used by BGA
  console.log("loading realtime lobby for chess...");
  await page.goto("https://boardgamearena.com/gamelobby?game=chess", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shotsDir, "lobby-03-chess-lobby.png"), fullPage: true });

  // Dump
  fs.writeFileSync(
    path.join(reconDir, "captured-requests-lobby.json"),
    JSON.stringify(captured, null, 2),
  );

  // Summary
  const interesting = captured
    .filter((r) => /\.php|\.html|\/api\/|notif|invit|table|lobby|game|player|account|chat|message|community/.test(r.url))
    .filter((r) => !/\.(png|jpg|jpeg|svg|gif|webp|css|woff|ico|map|js)(\?|$)/.test(r.url))
    .filter((r) => !/analytics|sentry|googletagmanager|google\.com\/g\/collect|doubleclick|didomi/.test(r.url));

  const cookies = await context.cookies();
  const summary = `# BGA lobby recon

## Probed URLs
${probeResults.map((p) => `- \`${p.status}\` ${p.url} → ${p.finalUrl} — "${p.title}"`).join("\n")}

## Cookies
${cookies.map((c) => `- \`${c.name}\` (domain=${c.domain})`).join("\n")}

## Interesting requests (${interesting.length})

${interesting
  .map(
    (r) => `### ${r.method} ${r.url}
- status: ${r.status}
- content-type: ${r.contentType}
- request body: ${r.hasBody ? "`" + (r.bodyPreview ?? "").replace(/\n/g, " ") + "`" : "—"}
- response preview: \`${(r.responsePreview ?? "").replace(/\n/g, " ").slice(0, 300)}\``,
  )
  .join("\n\n")}
`;
  fs.writeFileSync(path.join(reconDir, "lobby-summary.md"), summary);

  await context.close();
  await browser.close();
  console.log("done. wrote recon/lobby.har, recon/captured-requests-lobby.json, recon/lobby-summary.md, recon/url-probes.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
