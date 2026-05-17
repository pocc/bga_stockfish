/**
 * Reconnaissance pass #1: log in to BGA and capture the login flow.
 *
 * - Loads credentials from ../.env.local
 * - Records the full network trace as recon/login.har
 * - Persists auth state to recon/auth-state.json so subsequent passes can
 *   skip the login
 * - Saves screenshots into recon/screenshots/
 * - Writes a markdown summary to recon/login-summary.md noting the relevant
 *   endpoints, cookies, CSRF tokens, etc.
 */
import { chromium, type Page, type Request, type Response } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reconDir = path.join(root, "recon");
const shotsDir = path.join(reconDir, "screenshots");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) throw new Error(".env.local not found");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

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
  const env = loadEnv();
  if (!env.BGA_USERNAME || !env.BGA_PASSWORD) {
    throw new Error("BGA_USERNAME and BGA_PASSWORD must be set in .env.local");
  }

  console.log("launching chromium...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    recordHar: { path: path.join(reconDir, "login.har"), content: "embed" },
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
      bodyPreview: req.postData()?.slice(0, 300),
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
          rec.responsePreview = body.slice(0, 500);
        }
      } catch {
        // ignore
      }
    }
  });

  // 1. Land on home (this opens a signup modal — skip and go straight to /account)
  console.log("navigating to BGA homepage...");
  await page.goto("https://boardgamearena.com", { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(shotsDir, "01-home.png"), fullPage: false });

  // 2. Go straight to login page
  console.log("navigating to /account login page...");
  await page.goto("https://en.boardgamearena.com/account?redirect=welcome", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shotsDir, "02-login-page.png"), fullPage: false });

  // 3. Inspect login form structure first
  console.log("inspecting login form...");
  const formStructure = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
      type: i.type,
      name: i.name,
      id: i.id,
      readonly: i.readOnly,
      placeholder: i.placeholder,
      ariaLabel: i.getAttribute("aria-label"),
      visible: !!(i.offsetWidth || i.offsetHeight),
    }));
    const buttons = Array.from(document.querySelectorAll("button, a[role='button'], div[role='button']")).map((b) => ({
      tag: b.tagName,
      text: (b.textContent || "").trim().slice(0, 50),
      type: b.getAttribute("type"),
      id: b.id,
      visible: !!((b as HTMLElement).offsetWidth || (b as HTMLElement).offsetHeight),
    }));
    return { inputs, buttons: buttons.filter((b) => b.text && b.visible).slice(0, 30) };
  });
  fs.writeFileSync(path.join(reconDir, "login-form-structure.json"), JSON.stringify(formStructure, null, 2));
  console.log("form inputs:", JSON.stringify(formStructure.inputs.filter((i) => i.visible && !i.readonly), null, 2));
  console.log("form buttons:", JSON.stringify(formStructure.buttons, null, 2));

  // 4. Fill username — target by placeholder to skip top-bar search input
  console.log("filling username...");
  const userInput = page
    .locator('input[placeholder="Email or username"]:not([readonly])')
    .first();
  await userInput.waitFor({ state: "visible", timeout: 15_000 });
  await userInput.scrollIntoViewIfNeeded();
  await userInput.fill(env.BGA_USERNAME);
  await page.screenshot({ path: path.join(shotsDir, "03a-username-filled.png"), fullPage: false });

  // The "Next" button is likely a styled <a>/<div>/<span> rather than <button>.
  // Try clicking any clickable element with text Next/Continue, then fall back to Enter.
  console.log("submitting username (clicking Next or pressing Enter)...");
  const nextClickable = page.locator(
    'button:has-text("Next"), a:has-text("Next"), div[role="button"]:has-text("Next"), span:has-text("Next"), button:has-text("Continue"), a:has-text("Continue")',
  ).first();
  if (await nextClickable.count().catch(() => 0)) {
    await nextClickable.click({ timeout: 5_000 }).catch(async () => {
      await userInput.press("Enter");
    });
  } else {
    await userInput.press("Enter");
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shotsDir, "03b-after-next.png"), fullPage: false });

  console.log("filling password...");
  const passInput = page
    .locator('input[type="password"]:not([readonly])')
    .first();
  await passInput.waitFor({ state: "visible", timeout: 15_000 });
  await passInput.fill(env.BGA_PASSWORD);
  await page.screenshot({ path: path.join(shotsDir, "03c-password-filled.png"), fullPage: false });

  // 4. Submit — also non-<button>; press Enter on password as a reliable fallback
  console.log("submitting login...");
  const submitClickable = page.locator(
    'button:has-text("Login"), button:has-text("Log in"), a:has-text("Login"), div[role="button"]:has-text("Login"), button[type="submit"]',
  ).first();
  const submitPromise = (async () => {
    if (await submitClickable.count().catch(() => 0)) {
      await submitClickable.click({ timeout: 5_000 }).catch(async () => {
        await passInput.press("Enter");
      });
    } else {
      await passInput.press("Enter");
    }
  })();
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {}),
    submitPromise,
  ]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shotsDir, "04-after-login.png"), fullPage: false });

  // 5. Determine if login succeeded
  const url = page.url();
  const html = await page.content();
  const loggedIn = !html.includes("password") || url.includes("welcome") || url.includes("lobby");
  console.log("post-login url:", url);
  console.log("looks logged in?", loggedIn);

  // 6. Persist auth state for follow-up passes
  await context.storageState({ path: path.join(reconDir, "auth-state.json") });

  // 7. Visit the chess lobby for a peek
  console.log("navigating to chess lobby...");
  await page.goto("https://en.boardgamearena.com/gamelist?game=chess", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(shotsDir, "05-chess-lobby.png"), fullPage: false });

  // 8. Visit the player page / invitations
  await page.goto("https://en.boardgamearena.com/playerinvitations", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shotsDir, "06-invitations.png"), fullPage: false });

  // 9. Dump captured requests
  fs.writeFileSync(
    path.join(reconDir, "captured-requests.json"),
    JSON.stringify(captured, null, 2),
  );

  // 10. Summary markdown
  const interesting = captured
    .filter((r) => /\.php|\/api\/|\/account\/|notif|invitation|player/.test(r.url))
    .filter((r) => !/\.(png|jpg|jpeg|svg|gif|webp|css|woff|ico|map)/.test(r.url));
  const cookies = await context.cookies();
  const summary = `# BGA login recon

## Final URL
${page.url()}

## Page title
${await page.title()}

## Cookies after login
${cookies.map((c) => `- \`${c.name}\` (domain=${c.domain}, expires=${c.expires}, httpOnly=${c.httpOnly}, secure=${c.secure}, sameSite=${c.sameSite}) — ${c.value.length} chars`).join("\n")}

## Interesting requests (${interesting.length})

${interesting
  .map(
    (r) => `### ${r.method} ${r.url}
- status: ${r.status}
- content-type: ${r.contentType}
- request body: ${r.hasBody ? "`" + (r.bodyPreview ?? "").replace(/\n/g, " ") + "`" : "—"}
- response preview: \`${(r.responsePreview ?? "").replace(/\n/g, " ").slice(0, 200)}\``,
  )
  .join("\n\n")}
`;
  fs.writeFileSync(path.join(reconDir, "login-summary.md"), summary);

  await context.close();
  await browser.close();
  console.log("done. wrote recon/login.har, recon/captured-requests.json, recon/login-summary.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
