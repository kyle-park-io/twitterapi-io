import { loadAutoFollowConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService } from "../services/TweetService";
import { UserService } from "../services/UserService";
import { FollowStore } from "../services/FollowStore";
import { BrowserFollowService } from "../services/BrowserFollowService";
import { AutoFollowRunner, isUnhealthy } from "../services/AutoFollowRunner";
import { checkCapStall } from "../services/capDetection";
import { IFollower } from "../follow/IFollower";
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

// The following-list sync is a read-API call that paginates the account's whole
// following list (~1 request per 200 follows), so it is throttled to run at most
// once per this window across restarts. It only exists to catch follows/unfollows
// made by hand outside the tool — the tool's own follows are already in the
// persisted followed-set, and a missed manual follow is harmless because the
// browser detects the existing follow and reports "already-following".
const FOLLOWING_SYNC_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

// While the follow cap is active, real cycles are pointless (X silently drops
// the follows), so each interval only "probes" this many queued candidates and
// checks whether the actual following count moved. Small on purpose: enough to
// notice the cap lifting, not enough to look like aggressive following.
const CAP_PROBE_COUNT = 2;

async function syncFollowing(
  users: UserService,
  store: FollowStore,
  xUser: string
): Promise<number> {
  let n = 0;
  for await (const f of users.getFollowings(xUser)) {
    store.add(f.userName);
    n++;
  }
  store.setLastFollowingSyncAt(new Date());
  store.save();
  return n;
}

/**
 * After a real cycle, compare the account's actual following count (1 read-API
 * call) with the last observation. When two consecutive cycles land under half
 * of their recorded follows, X's ratio-based follow cap is active: alert once
 * and switch the loop into probe mode until the count moves again.
 */
async function watchCapAfterCycle(
  users: UserService,
  store: FollowStore,
  xUser: string,
  addedThisCycle: number
): Promise<void> {
  let actual: number;
  try {
    actual = (await users.getUserInfo(xUser)).following;
  } catch (err) {
    console.error(
      `Cap check skipped — couldn't read actual following count: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }
  const result = checkCapStall({
    addedThisCycle,
    prevActual: store.getLastActualFollowingCount(),
    actual,
    stallCycles: store.getCapStallCycles(),
  });
  store.setLastActualFollowingCount(actual);
  store.setCapStallCycles(result.stallCycles);
  if (result.capReached && !store.getCapDetectedAt()) {
    const now = new Date();
    store.setCapDetectedAt(now);
    store.setCapActualCount(actual);
    appendLog({
      type: "cap-alert",
      at: now.toISOString(),
      account: xUser,
      localFollowedCount: store.followedCount(),
      actualFollowingCount: actual,
      note: "actual following count stopped rising — X ratio-based follow cap reached (help.x.com/en/using-x/x-follow-limit)",
    });
    console.error(
      `\n⚠️⚠️⚠️  FOLLOW CAP REACHED: actual following is pinned at ~${actual} while the\n` +
        `        tool keeps recording successes (local ${store.followedCount()}). X silently drops\n` +
        `        follows past the account's ratio-based cap. Pausing real cycles; probing\n` +
        `        ${CAP_PROBE_COUNT}/cycle until the count moves. Raise your follower count to lift the cap.\n`
    );
  }
  store.save();
}

/**
 * One interval's work while the cap is active: click Follow on a couple of
 * queued candidates, then re-read the actual count. If it rose, the cap has
 * lifted — clear the cap state and let the next interval run a normal cycle.
 * If not, keep the probed users OUT of the followed-set and rotate them to the
 * back of the queue so the state never records follows that didn't land.
 */
async function runCapProbe(
  follower: IFollower,
  users: UserService,
  store: FollowStore,
  xUser: string
): Promise<void> {
  const targets = store.dequeue(CAP_PROBE_COUNT);
  const alreadyFollowing = new Set<string>();
  for (const c of targets) {
    try {
      const result = await follower.follow(c.userName);
      if (result === "already-following") alreadyFollowing.add(c.userName);
      console.log(`[cap-probe] ${result} @${c.userName}`);
    } catch (err) {
      console.error(
        `[cap-probe] follow failed for @${c.userName}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  let actual: number | null = null;
  try {
    actual = (await users.getUserInfo(xUser)).following;
  } catch (err) {
    console.error(
      `Cap probe check skipped — couldn't read actual following count: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const prev = store.getLastActualFollowingCount();
  const lifted = actual !== null && prev !== null && actual > prev;
  if (lifted) {
    for (const c of targets) store.add(c.userName);
    store.setCapDetectedAt(null);
    store.setCapActualCount(null);
    store.setCapStallCycles(0);
    appendLog({
      type: "cap-cleared",
      at: new Date().toISOString(),
      account: xUser,
      localFollowedCount: store.followedCount(),
      actualFollowingCount: actual,
    });
    console.log(
      `✅ Follow cap lifted — actual following rose to ${actual}. Resuming normal cycles next interval.`
    );
  } else {
    // Genuinely-already-followed users are recorded; ghosted probes go back in
    // the queue (dequeue removed their dedupe keys, so enqueue re-adds them).
    for (const c of targets) {
      if (alreadyFollowing.has(c.userName)) store.add(c.userName);
      else store.enqueue(c.userName, { name: c.name, keyword: c.keyword, verified: c.verified });
    }
    appendLog({
      type: "cap-probe",
      at: new Date().toISOString(),
      account: xUser,
      probed: targets.map((c) => c.userName),
      actualFollowingCount: actual,
      lifted: false,
    });
    console.warn(
      `Follow cap still active — actual ${actual ?? "unknown"} (pinned at ~${store.getCapActualCount()} ` +
        `since ${kst(store.getCapDetectedAt())}); probed ${targets.length}, queue ${store.queueSize()}.`
    );
  }
  if (actual !== null) store.setLastActualFollowingCount(actual);
  store.setLastRun(new Date());
  store.save();
}

async function main() {
  const config = loadAutoFollowConfig();
  const client = new TwitterClient(config.apiKey);
  const tweets = new TweetService(client);
  const users = new UserService(client);

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
    allowedVerified: config.allowedVerified,
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

    // Best-effort: merge the account's real following list into the followed-set
    // so already-followed accounts stop being queued. Throttled to once every
    // FOLLOWING_SYNC_INTERVAL_MS so frequent restarts don't each re-page the whole
    // list. If it fails, warn and keep going — a redundant follow attempt later is
    // a harmless no-op.
    const lastSync = store.getLastFollowingSyncAt();
    const sinceSyncMs = lastSync ? Date.now() - lastSync.getTime() : Infinity;
    if (sinceSyncMs >= FOLLOWING_SYNC_INTERVAL_MS) {
      try {
        const n = await syncFollowing(users, store, config.xUser);
        console.log(`Synced ${n} existing follows from X.`);
      } catch (err) {
        console.error(
          `Following sync failed (continuing anyway): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } else {
      const hrs = Math.round(sinceSyncMs / 3_600_000);
      const everyH = FOLLOWING_SYNC_INTERVAL_MS / 3_600_000;
      console.log(
        `Following sync skipped — last synced ~${hrs}h ago (throttled to every ${everyH}h).`
      );
    }
  }

  // Respect the interval across restarts. If we were restarted (e.g. WSL was
  // shut down and came back) less than one interval after the last cycle, wait
  // out the remainder instead of firing a cycle immediately — otherwise a flappy
  // WSL VM could follow far faster than intervalMinutes and trip rate limits.
  const lastRun = store.getLastRun();
  if (lastRun) {
    const intervalMs = config.intervalMinutes * 60_000;
    // Cap the wait at one interval so a bad clock can't wedge us forever.
    const waitMs = Math.min(intervalMs, lastRun.getTime() + intervalMs - Date.now());
    if (waitMs > 0) {
      const mins = Math.ceil(waitMs / 60_000);
      console.log(
        `Last cycle was ${kst(lastRun)}; waiting ~${mins}m to respect the ` +
          `${config.intervalMinutes}m interval before the next cycle...`
      );
      await sleep(waitMs);
    }
  }

  if (!config.dryRun && store.getCapDetectedAt()) {
    console.warn(
      `⚠️ Follow cap active since ${kst(store.getCapDetectedAt())} (actual pinned at ` +
        `~${store.getCapActualCount()}) — probe mode (${CAP_PROBE_COUNT}/cycle) until the count rises.`
    );
  }

  while (!stopping) {
    const started = new Date();
    if (!config.dryRun && store.getCapDetectedAt()) {
      console.log(`\n[${kst(started)}] Follow cap active — probing instead of a full cycle...`);
      try {
        await runCapProbe(follower, users, store, config.xUser);
      } catch (err) {
        console.error("Cap probe error:", err instanceof Error ? err.message : String(err));
      }
      if (stopping) break;
      console.log(`Sleeping ${config.intervalMinutes}m until next cycle...`);
      await sleep(config.intervalMinutes * 60_000);
      continue;
    }
    console.log(`\n[${kst(started)}] Running cycle...`);
    try {
      const summary = await runner.runCycle();
      console.log(
        `Cycle done — scanned ${summary.scanned}, ` +
          `queued ${summary.queued}, followed ${summary.followed.length}, ` +
          `already-following ${summary.alreadyFollowing}`
      );
      appendLog({ type: "cycle", ...summary });
      if (!summary.dryRun && summary.addedCount > 0) {
        await watchCapAfterCycle(users, store, config.xUser, summary.addedCount);
      }
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
