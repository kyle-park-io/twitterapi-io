import { loadAutoFollowConfig } from "../config";
import { buildStorageState } from "../services/SessionState";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

/**
 * One-time helper: import an X session from your real Chrome into the Playwright
 * storageState file the auto-follow browser reuses. X blocks automated logins
 * ("This browser or app may not be secure"), so instead of logging in via
 * Playwright, copy the session cookies from a browser that's already logged in.
 *
 * Get the cookies (in your normal Chrome, logged in to X):
 *   1. Open x.com, press F12.
 *   2. Application -> Cookies -> https://x.com
 *   3. Copy the `auth_token` value and the `ct0` value.
 *
 * Provide them via env (X_AUTH_TOKEN, X_CT0) or CLI:
 *   pnpm import-session -- --auth-token <v> --ct0 <v>
 */
function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const authToken = argValue(argv, "--auth-token") ?? process.env["X_AUTH_TOKEN"];
  const ct0 = argValue(argv, "--ct0") ?? process.env["X_CT0"];

  if (!authToken || !ct0) {
    console.error(
      "Missing cookies. Provide X_AUTH_TOKEN and X_CT0 (env or --auth-token/--ct0).\n" +
        "Copy them from Chrome: F12 -> Application -> Cookies -> https://x.com " +
        "(auth_token, ct0)."
    );
    process.exit(1);
  }

  const config = loadAutoFollowConfig();
  const state = buildStorageState(authToken, ct0);

  fs.mkdirSync(path.dirname(config.storageStatePath), { recursive: true });
  fs.writeFileSync(config.storageStatePath, JSON.stringify(state, null, 2));
  console.log(`Session written to ${config.storageStatePath}`);

  // Self-verify: load the session headless and confirm we're logged in, using
  // the same signal BrowserFollowService uses.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: config.storageStatePath,
    });
    const page = await context.newPage();
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
    const loggedIn = await page
      .getByTestId("SideNav_AccountSwitcher_Button")
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (loggedIn) {
      console.log("✅ Session valid — you can now run: pnpm example:auto-follow");
    } else {
      console.error(
        "❌ Session not valid — the account switcher did not appear. " +
          "Re-copy auth_token and ct0 from a browser that's currently logged in to X."
      );
      await browser.close();
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
