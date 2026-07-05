import { loadAutoFollowConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService } from "../services/TweetService";
import { FollowStore } from "../services/FollowStore";
import { BrowserFollowService } from "../services/BrowserFollowService";
import { AutoFollowRunner } from "../services/AutoFollowRunner";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    console.log(`\n[${started.toISOString()}] Running cycle...`);
    try {
      const summary = await runner.runCycle();
      console.log(
        `Cycle done — scanned ${summary.scanned}, ` +
          `queued ${summary.queued}, followed ${summary.followed.length}`
      );
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
