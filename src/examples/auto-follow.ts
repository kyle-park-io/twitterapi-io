import { loadAutoFollowConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService } from "../services/TweetService";
import { FollowStore } from "../services/FollowStore";
import { BrowserFollowService } from "../services/BrowserFollowService";
import { AutoFollowRunner, isUnhealthy } from "../services/AutoFollowRunner";
import * as fs from "fs";
import * as path from "path";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format a timestamp for human-readable logs in Korea time. */
function kst(date: Date | null): string {
  if (!date) return "never";
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }) + " KST";
}

const LOG_PATH = path.join(process.cwd(), "output", "auto-follow-log.jsonl");

function appendLog(record: unknown): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    // A lost log line must never stop the follow loop.
    console.error("Failed to write log:", err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  const config = loadAutoFollowConfig();
  const client = new TwitterClient(config.apiKey);
  const tweets = new TweetService(client);

  const store = new FollowStore(config.statePath);
  store.load();

  const follower = new BrowserFollowService({
    xUser: config.xUser,
    xEmail: config.xEmail,
    xPassword: config.xPassword,
    xTotp: config.xTotp,
    storageStatePath: config.storageStatePath,
    // Run headless by default so the loop works unattended (e.g. under systemd,
    // where there is no X server / DISPLAY). Set HEADLESS=false to watch the
    // browser during local debugging. The saved cookie session works headless.
    headless: process.env["HEADLESS"] !== "false",
  });

  const runner = new AutoFollowRunner(tweets, store, follower, {
    keywords: config.keywords,
    queryType: config.queryType,
    perKeyword: config.perKeyword,
    keywordsPerCycle: config.keywordsPerCycle,
    maxPerRun: config.maxPerRun,
    dryRun: config.dryRun,
  });

  let stopping = false;
  const shutdown = async () => {
    stopping = true;
    console.log("\nShutting down...");
    await follower.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);

  console.log(
    `Auto-follow started — ${config.keywords.length} keywords ` +
      `(${config.keywordsPerCycle} sampled/batch), maxPerRun=${config.maxPerRun}, ` +
      `interval=${config.intervalMinutes}m, dryRun=${config.dryRun}`
  );

  if (!config.dryRun) {
    console.log("Logging in to X via browser...");
    await follower.login();
    console.log("Logged in.");
  }

  while (!stopping) {
    const started = new Date();
    console.log(`\n[${kst(started)}] Running cycle...`);
    try {
      const summary = await runner.runCycle();
      console.log(
        `Cycle done — scanned ${summary.scanned}, ` +
          `queued ${summary.queued}, followed ${summary.followed.length}`
      );
      appendLog({ type: "cycle", ...summary });
      if (!summary.dryRun && isUnhealthy(summary.consecutiveZeroCycles, config.unhealthyAfterZeroCycles)) {
        console.error(
          `\n⚠️⚠️⚠️  UNHEALTHY: ${summary.consecutiveZeroCycles} consecutive cycles ` +
            `followed 0 of ${summary.attempted} attempted.\n` +
            `        Last success: ${kst(store.getLastSuccessAt())}.\n` +
            `        The account may be banned, the session may have expired, or X may\n` +
            `        be blocking follows. Check with: pnpm follow-status\n`
        );
      }
    } catch (err) {
      console.error("Cycle error:", err instanceof Error ? err.message : String(err));
    }
    if (stopping) break;
    console.log(`Sleeping ${config.intervalMinutes}m until next cycle...`);
    await sleep(config.intervalMinutes * 60_000);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
