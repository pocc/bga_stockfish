/**
 * Shared Playwright login flow used by recon scripts that need to drive a
 * real browser as one (or more) bot accounts. Extracted out of
 * recon-login.ts so multi-account flows don't have to duplicate the
 * placeholder-targeted form selectors / two-step form quirks.
 */
import type { BrowserContext, Page } from "playwright";

export interface LoginResult {
  finalUrl: string;
  title: string;
}

export async function loginViaUI(
  context: BrowserContext,
  username: string,
  password: string,
): Promise<LoginResult> {
  const page = await context.newPage();
  await page.goto("https://en.boardgamearena.com/account?redirect=welcome", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1500);

  const userInput = page
    .locator('input[placeholder="Email or username"]:not([readonly])')
    .first();
  await userInput.waitFor({ state: "visible", timeout: 15_000 });
  await userInput.scrollIntoViewIfNeeded();
  await userInput.fill(username);

  const nextClickable = page
    .locator(
      'button:has-text("Next"), a:has-text("Next"), div[role="button"]:has-text("Next"), span:has-text("Next"), button:has-text("Continue"), a:has-text("Continue")',
    )
    .first();
  if (await nextClickable.count().catch(() => 0)) {
    await nextClickable.click({ timeout: 5_000 }).catch(async () => {
      await userInput.press("Enter");
    });
  } else {
    await userInput.press("Enter");
  }
  await page.waitForTimeout(2_000);

  const passInput = page
    .locator('input[type="password"]:not([readonly])')
    .first();
  await passInput.waitFor({ state: "visible", timeout: 15_000 });
  await passInput.fill(password);

  const submitClickable = page
    .locator(
      'button:has-text("Login"), button:has-text("Log in"), a:has-text("Login"), div[role="button"]:has-text("Login"), button[type="submit"]',
    )
    .first();
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
  await page.waitForTimeout(2_000);

  const result = { finalUrl: page.url(), title: await page.title() };
  await page.close();
  return result;
}

/**
 * Pull a config blob (e.g. centrifugeConfiguration / chess piece map / user
 * id) out of an inline <script> on a BGA HTML page. Returns the raw string
 * starting at `name` so the caller can parse it with their own slicing.
 */
export function findInlineJsValue(html: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*[:=]\\s*({[\\s\\S]*?})\\s*[,;\\n]`, "i");
  const m = re.exec(html);
  return m ? m[1] : null;
}
