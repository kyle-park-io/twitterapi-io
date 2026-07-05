import * as fs from "fs";
import * as path from "path";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { IFollower } from "../follow/IFollower";

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
      // Verify the saved session is still valid.
      const page = await this.context.newPage();
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
      const loggedIn = await page
        .getByTestId("SideNav_AccountSwitcher_Button")
        .isVisible()
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

    // Step 1: username
    await page.getByLabel("Phone, email, or username").fill(this.config.xUser);
    await page.getByRole("button", { name: "Next" }).click();

    // X sometimes asks for the email/username to confirm an unusual login.
    const confirm = page.getByTestId("ocfEnterTextTextInput");
    if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirm.fill(this.config.xEmail);
      await page.getByTestId("ocfEnterTextNextButton").click();
    }

    // Step 2: password
    await page.getByLabel("Password", { exact: true }).fill(this.config.xPassword);
    await page.getByTestId("LoginForm_Login_Button").click();

    // Step 3: optional TOTP 2FA
    if (this.config.xTotp) {
      const totpInput = page.getByTestId("ocfEnterTextTextInput");
      if (await totpInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        const { authenticator } = await import("otplib");
        await totpInput.fill(authenticator.generate(this.config.xTotp));
        await page.getByTestId("ocfEnterTextNextButton").click();
      }
    }

    await page.waitForURL("https://x.com/home", { timeout: 30000 });
  }

  async follow(username: string): Promise<void> {
    if (!this.context) throw new Error("Not logged in — call login() first");
    const page = await this.context.newPage();
    try {
      await page.goto(`https://x.com/${username}`, { waitUntil: "domcontentloaded" });

      const followButton = page.getByTestId("placementTracking").getByRole("button", {
        name: /^Follow$/,
      });

      if (await followButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await followButton.click();
        await page.getByRole("button", { name: /^Following$/ }).waitFor({ timeout: 5000 });
      }
      // If the Follow button is not visible, we are already following — no-op.
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
