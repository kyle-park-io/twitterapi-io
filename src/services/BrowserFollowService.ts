import * as fs from "fs";
import * as path from "path";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { IFollower, FollowResult } from "../follow/IFollower";

export interface BrowserFollowConfig {
  xUser: string;
  xEmail: string;
  xPassword: string;
  xTotp?: string;
  storageStatePath: string;
  headless?: boolean;
}

export class BrowserFollowService implements IFollower {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(private readonly config: BrowserFollowConfig) {}

  async login(): Promise<void> {
    if (this.context) return;

    this.browser = await chromium.launch({
      headless: this.config.headless ?? false,
    });

    const hasSession = fs.existsSync(this.config.storageStatePath);
    this.context = await this.browser.newContext(
      hasSession ? { storageState: this.config.storageStatePath } : {}
    );

    if (hasSession) {
      // Verify the saved session is still valid. The timeline is a SPA, so wait
      // for the account switcher to render rather than snapshotting visibility
      // right after domcontentloaded — isVisible() would return false before the
      // sidebar is drawn and wrongly send us into the (X-blocked) login flow.
      const page = await this.context.newPage();
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
      const loggedIn = await page
        .getByTestId("SideNav_AccountSwitcher_Button")
        .waitFor({ state: "visible", timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      await page.close();
      if (loggedIn) return;
    }

    // No valid session — perform an automated login.
    const page = await this.context.newPage();
    await this.performLogin(page);
    await page.close();

    fs.mkdirSync(path.dirname(this.config.storageStatePath), { recursive: true });
    await this.context.storageState({ path: this.config.storageStatePath });
  }

  private async performLogin(page: Page): Promise<void> {
    await page.goto("https://x.com/i/flow/login", { waitUntil: "domcontentloaded" });

    // X's login inputs carry stable `name`/`type` attributes in both headless and
    // headful Chromium, whereas their accessible names ("Email or username", "Password")
    // are only present when headful — so target the attributes, not the a11y name.
    // Each step is submitted with Enter, which is more reliable than locating the
    // step button (its label and DOM nesting change across A/B variants of the flow).

    // Step 1: username
    const userField = page.locator('input[name="username_or_email"]').first();
    await userField.waitFor({ timeout: 30000 });
    await userField.fill(this.config.xUser);
    await userField.press("Enter");

    // X sometimes inserts an unusual-login check asking for the email/phone before the
    // password. It reuses the same username input `name`, so if a username field is
    // still showing (and no password field yet), fill the email and continue.
    const passwordField = page.locator('input[name="password"], input[type="password"]').first();
    if (!(await passwordField.isVisible({ timeout: 8000 }).catch(() => false))) {
      const confirm = page.locator('input[name="username_or_email"]').first();
      if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirm.fill(this.config.xEmail);
        await confirm.press("Enter");
      }
    }

    // Step 2: password
    const pw = page.locator('input[name="password"], input[type="password"]').first();
    await pw.waitFor({ timeout: 15000 });
    await pw.fill(this.config.xPassword);
    await pw.press("Enter");

    // Step 3: optional TOTP 2FA. X's one-time-code input uses name="text"; fall back to
    // the numeric-inputmode / one-time-code inputs used by some variants.
    if (this.config.xTotp) {
      const totpInput = page
        .locator(
          'input[name="text"], input[autocomplete="one-time-code"], input[inputmode="numeric"]'
        )
        .first();
      if (await totpInput.isVisible({ timeout: 8000 }).catch(() => false)) {
        const { authenticator } = await import("otplib");
        await totpInput.fill(authenticator.generate(this.config.xTotp.replace(/\s/g, "")));
        await totpInput.press("Enter");
      }
    }

    // Success = landing on the home timeline. URL doesn't always update in headless, so
    // also accept the primary-nav "Home" link appearing.
    await Promise.race([
      page.waitForURL("https://x.com/home", { timeout: 30000 }),
      page.getByTestId("AppTabBar_Home_Link").waitFor({ timeout: 30000 }),
      page.getByTestId("primaryColumn").waitFor({ timeout: 30000 }),
    ]);
  }

  async follow(username: string): Promise<FollowResult> {
    if (!this.context) throw new Error("Not logged in — call login() first");
    const page = await this.context.newPage();
    try {
      await page.goto(`https://x.com/${username}`, { waitUntil: "domcontentloaded" });

      // The profile-header button's accessible name is "Follow @<username>" (and flips
      // to "Following @<username>" once followed). Matching by the "Follow @" prefix
      // targets the header action specifically and won't match "Followers"/"Following"
      // count links. The follow-back "Follow" button in the sidebar is avoided by the
      // @-prefix requirement.
      const followButton = page.getByRole("button", {
        name: new RegExp(`^Follow @${username}$`, "i"),
      });
      // Once following, X labels the header action "Following @<user>" OR
      // "Unfollow @<user>" depending on the UI variant/hover state — accept either
      // as proof the follow registered.
      const followedButton = page.getByRole("button", {
        name: new RegExp(`^(Following|Unfollow) @${username}$`, "i"),
      });

      // The profile is a SPA, so wait for the header action to render rather than
      // snapshotting visibility right after domcontentloaded — isVisible() does NOT
      // wait for the element, so an unrendered Follow button read as "not present"
      // and the follow was silently skipped while still being reported as done.
      // Wait for EITHER the Follow button (not yet following) or the followed-state
      // button (already following) to appear.
      await Promise.race([
        followButton.waitFor({ state: "visible", timeout: 15000 }),
        followedButton.waitFor({ state: "visible", timeout: 15000 }),
      ]).catch(() => {
        throw new Error(
          `neither Follow nor Following/Unfollow button rendered for @${username} within 15s`
        );
      });

      if (await followButton.isVisible().catch(() => false)) {
        await followButton.click();
        // Confirm the click registered: the button must flip to the followed state
        // ("Following @" or "Unfollow @").
        await followedButton.waitFor({ state: "visible", timeout: 10000 });
        return "followed";
      }
      // The followed-state button is already showing — we already follow them.
      return "already-following";
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = null;
    this.browser = null;
  }
}
