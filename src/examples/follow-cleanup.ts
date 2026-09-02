import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { loadAutoFollowConfig } from "../config";
import { BrowserFollowService } from "../services/BrowserFollowService";
import { CleanupRunner, CleanupTarget } from "../services/CleanupRunner";
import { FollowStore } from "../services/FollowStore";
import {
  scoreAccount,
  fromFollowingsRecord,
  FollowingsRecord,
  UNFOLLOW_THRESHOLD,
} from "../follow/scoring";

const TARGETS_PATH = path.join(process.cwd(), "output", "cleanup-targets.json");
const LOG_PATH = path.join(process.cwd(), "output", "auto-follow-log.jsonl");

function appendLog(record: unknown): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    console.error("Failed to write log:", err instanceof Error ? err.message : String(err));
  }
}

/** Page the account's whole following list. ~38 requests for 7.5k accounts. */
async function fetchFollowings(apiKey: string, userName: string): Promise<FollowingsRecord[]> {
  const all: FollowingsRecord[] = [];
  let cursor = "";
  for (let page = 0; page < 100; page++) {
    const url =
      `https://api.twitterapi.io/twitter/user/followings?userName=${encodeURIComponent(userName)}&pageSize=200` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const res = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!res.ok) throw new Error(`followings HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      followings?: FollowingsRecord[];
      has_next_page?: boolean;
      next_cursor?: string;
    };
    const batch = body.followings ?? [];
    all.push(...batch);
    process.stderr.write(`  page ${page + 1}: +${batch.length} (total ${all.length})\n`);
    if (!body.has_next_page || !body.next_cursor || batch.length === 0) break;
    cursor = body.next_cursor;
    await new Promise((r) => setTimeout(r, 300));
  }
  return all;
}

async function scan(): Promise<void> {
  const config = loadAutoFollowConfig();
  console.log(`Scanning @${config.xUser}'s following list...`);
  const accounts = await fetchFollowings(config.apiKey, config.xUser);

  const targets: CleanupTarget[] = [];
  const review: CleanupTarget[] = [];
  for (const record of accounts) {
    const { score, reasons } = scoreAccount(fromFollowingsRecord(record));
    if (score >= UNFOLLOW_THRESHOLD) targets.push({ userName: record.userName, score, reasons });
    else if (score > 0) review.push({ userName: record.userName, score, reasons });
  }
  targets.sort((a, b) => b.score - a.score);

  fs.mkdirSync(path.dirname(TARGETS_PATH), { recursive: true });
  fs.writeFileSync(
    TARGETS_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        account: config.xUser,
        total: accounts.length,
        targets,
        review,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`\nScanned ${accounts.length} accounts`);
  console.log(`  unfollow targets (score >= ${UNFOLLOW_THRESHOLD}): ${targets.length}`);
  console.log(`  review only (score 1-2, NOT actioned):            ${review.length}`);
  console.log(
    `  clean (score 0):                                  ${accounts.length - targets.length - review.length}`
  );
  console.log(`\nWritten to ${TARGETS_PATH}`);
  console.log("\nTop 20 targets:");
  for (const t of targets.slice(0, 20)) {
    console.log(`  [${t.score}] @${t.userName} — ${t.reasons.join(", ")}`);
  }
}

async function run(): Promise<void> {
  const config = loadAutoFollowConfig();
  if (!fs.existsSync(TARGETS_PATH)) {
    throw new Error(`No ${TARGETS_PATH}. Run 'pnpm follow-cleanup --scan' first.`);
  }
  const file = JSON.parse(fs.readFileSync(TARGETS_PATH, "utf8")) as { targets: CleanupTarget[] };

  const store = new FollowStore(config.statePath);
  store.load();

  // Anything already cleaned in an earlier cycle is skipped, so --run is safe
  // to re-invoke across days.
  const pending = file.targets.filter((t) => !store.wasUnfollowed(t.userName));
  console.log(
    `${pending.length} targets pending (${file.targets.length - pending.length} already done)`
  );
  if (pending.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const follower = new BrowserFollowService({
    xUser: config.xUser,
    xEmail: config.xEmail,
    xPassword: config.xPassword,
    xTotp: config.xTotp,
    storageStatePath: config.storageStatePath,
    headless: process.env["HEADLESS"] !== "false",
  });

  try {
    // unfollow() requires an active session — it throws "Not logged in — call
    // login() first" rather than self-logging-in, matching follow()'s contract.
    // Only log in for a real run: dry-run never calls unfollow(), so launching
    // a browser session for it would be pointless (and defeats the point of a
    // dry run). This mirrors how the follow loop in auto-follow.ts gates login
    // on !config.dryRun.
    if (!config.dryRun) await follower.login();

    const summary = await new CleanupRunner(follower, store, {
      targets: pending,
      maxPerRun: config.unfollowPerRun,
      dryRun: config.dryRun,
    }).runCycle();

    console.log(
      `Cleanup done — attempted ${summary.attempted}, unfollowed ${summary.unfollowedCount}, ` +
        `not-following ${summary.notFollowing}, failures ${summary.failures}, remaining ${summary.remaining}`
    );
    appendLog({ type: "cleanup", ...summary });
  } finally {
    await follower.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--scan")) return scan();
  if (args.includes("--run")) return run();
  console.log("Usage: pnpm follow-cleanup --scan | --run");
  console.log("  --scan  read-only: score the following list, write output/cleanup-targets.json");
  console.log("  --run   execute unfollows against that file (honours dryRun in config)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
