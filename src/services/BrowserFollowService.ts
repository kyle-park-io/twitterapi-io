import * as fs from "fs";
import * as path from "path";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { IFollower, FollowResult, UnfollowResult } from "../follow/IFollower";

export interface BrowserFollowConfig {
  xUser: string;
  xEmail: string;
  xPassword: string;
  xTotp?: string;
  storageStatePath: string;
  headless?: boolean;
}

/**
 * Decide whether an unfollow attempt may be reported as "unfollowed" after the
 * confirm-dialog step.
 *
 * `sawDialog` true means the confirm button was found and clicked, so the
 * unfollow was submitted; a missing flip after that is just X being slow, and
 * reporting success is right — the caller blocklists the handle and we never
 * touch it again.
 *
 * `sawDialog` false with no flip either means nothing happened: most likely the
 * confirmationSheetConfirm test id drifted. Returning "unfollowed" there would
 * blocklist an account we are still following, and because the blocklist is
 * permanent and filters the cleanup target list, that account could never be
 * cleaned again — one selector change would burn the whole target list. So we
 * throw: the caller records a failure, leaves the handle un-blocklisted, and a
 * later cycle retries it. Retrying is safe precisely because unfollow()
 * re-navigates and returns "not-following" when the profile already shows
 * "Follow @user" — it never blind-clicks.
 */
export function assertUnfollowLanded(
  username: string,
  acted: boolean,
  gone: boolean
): void {
  if (gone) return;
  // The followed-state button surviving is treated as failure even when we did
  // click something. An earlier version assumed "clicked but slow to update"
  // and returned success; @BossMon_02 disproved it — the menu item was clicked,
  // the button stayed, and the account was still followed on X afterwards. A
  // false "unfollowed" is the expensive direction: the caller blocklists it
  // permanently, and the blocklist filters the cleanup list, so the account can
  // never be cleaned. Throwing costs one retry next cycle, and retrying is safe
  // because unfollow() re-navigates and re-reads the button state rather than
  // blind-clicking.
  throw new Error(
    acted
      ? `unfollow for @${username} was submitted (a confirmation dialog or ` +
          `"Unfollow @${username}" menu item was clicked) but the followed-state ` +
          `button never went away — treating as NOT unfollowed`
      : `unfollow for @${username} was not confirmed: neither a confirmation dialog ` +
          `(confirmationSheetConfirm) nor an "Unfollow @${username}" menu item appeared, ` +
          `and the followed-state button never went away — treating as NOT unfollowed`
  );
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
        // The click is what actually follows the account, so a successful click
        // means "followed". We still try to observe the button flip to the
        // followed state ("Following @" / "Unfollow @") as confirmation, but some
        // profiles take >10s to flip (slow headless render, X lag), and treating
        // that as a failure wrongly reported real follows as "Follow failed".
        // So confirmation is best-effort: if it doesn't appear, warn and still
        // return "followed" rather than throwing.
        const confirmed = await followedButton
          .waitFor({ state: "visible", timeout: 10000 })
          .then(() => true)
          .catch(() => false);
        if (!confirmed) {
          console.warn(
            `Clicked Follow for @${username} but couldn't confirm the flip ` +
              `within 10s — assuming followed.`
          );
        }
        return "followed";
      }
      // The followed-state button is already showing — we already follow them.
      return "already-following";
    } finally {
      await page.close();
    }
  }

  async unfollow(username: string): Promise<UnfollowResult> {
    if (!this.context) throw new Error("Not logged in — call login() first");
    const page = await this.context.newPage();
    try {
      await page.goto(`https://x.com/${username}`, { waitUntil: "domcontentloaded" });

      // The followed-state button renders as "Following @user" or "Unfollow @user"
      // depending on the UI variant and hover state — accept either, exactly as
      // the follow path does.
      const followedState = page.getByRole("button", {
        name: new RegExp(`^(Following|Unfollow) @${username}$`, "i"),
      });
      const followButton = page.getByRole("button", {
        name: new RegExp(`^Follow @${username}$`, "i"),
      });

      const isFollowed = await followedState
        .waitFor({ state: "visible", timeout: 15000 })
        .then(() => true)
        .catch(() => false);

      if (!isFollowed) {
        // Already not following is a valid outcome; nothing rendering at all is not.
        const canFollow = await followButton.isVisible({ timeout: 3000 }).catch(() => false);
        if (canFollow) return "not-following";
        throw new Error(
          `neither Follow nor Following/Unfollow button rendered for @${username} within 15s`
        );
      }

      await followedState.click();

      // X has two unfollow interactions, and which one you get depends on the
      // target's profile, not on us:
      //   - Normal profile: the button is a wide "Following @user" and clicking
      //     it opens a confirmation dialog.
      //   - Profile with creator Subscriptions enabled: the header has to fit a
      //     Subscribe button too, so Following collapses to a 36px icon labelled
      //     "Unfollow @user" that opens a dropdown MENU instead. No dialog ever
      //     appears, and the header afterwards reads "Subscribe to @user" —
      //     "Follow @user" never renders, so waiting for it hangs until timeout.
      // Race both; whichever resolves is the variant we are on.
      const confirm = page.getByTestId("confirmationSheetConfirm");
      const menuItem = page.getByRole("menuitem", {
        name: new RegExp(`^Unfollow @${username}$`, "i"),
      });
      const variant = await Promise.race([
        confirm.waitFor({ state: "visible", timeout: 6000 }).then(() => "dialog" as const),
        menuItem.waitFor({ state: "visible", timeout: 6000 }).then(() => "menu" as const),
      ]).catch(() => null);

      if (variant === "dialog") await confirm.click();
      else if (variant === "menu") await menuItem.click();

      // Success = the followed-state button is gone. That covers both variants:
      // a normal profile replaces it with "Follow @user", a subscription profile
      // with "Subscribe to @user". Waiting for "Follow @user" specifically would
      // never succeed on the latter and reported real unfollows as failures.
      // As with the follow path, a slow disappearance is treated as success
      // rather than retried — clicking again would re-follow, which is the one
      // thing we must never do.
      const gone = await followedState
        .waitFor({ state: "hidden", timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      assertUnfollowLanded(username, variant !== null, gone);
      return "unfollowed";
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
