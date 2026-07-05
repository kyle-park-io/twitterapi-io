import { loadAutoFollowConfig } from "../config";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

/**
 * One-time helper: opens a real browser window, lets you log in to X by hand
 * (username, password, 2FA — whatever X asks), and saves the session to
 * `.auth/x-session.json`. After this, `example:auto-follow` reuses that session
 * and never needs to automate the login flow.
 *
 * Run: pnpm ts-node src/examples/save-session.ts
 * Then log in in the window, and once you're on the home timeline, come back to
 * the terminal and press Enter.
 */
async function main() {
  const config = loadAutoFollowConfig();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://x.com/i/flow/login", { waitUntil: "domcontentloaded" });

  console.log("\n=== Log in to X in the browser window that just opened. ===");
  console.log("Enter your username, password, and 2FA code by hand.");
  console.log("When you can see your home timeline, come back here and press Enter.\n");

  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  fs.mkdirSync(path.dirname(config.storageStatePath), { recursive: true });
  await context.storageState({ path: config.storageStatePath });
  console.log(`\nSession saved to ${config.storageStatePath}`);
  console.log("You can now run: pnpm example:auto-follow");

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
