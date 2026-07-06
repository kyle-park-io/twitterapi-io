import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { UserService } from "../services/UserService";
import { FollowStore } from "../services/FollowStore";
import * as fs from "fs";
import * as path from "path";

/**
 * Manual reference check: look up the account's ACTUAL following count via the
 * read API and append it, next to the tool's local followed-count, to the
 * auto-follow JSONL log. The two won't match exactly (you also follow/unfollow
 * by hand) — an approximate match confirms follows are landing.
 *
 * Run occasionally (e.g. once or twice a day):  pnpm follow-audit
 */
async function main() {
  const xUser = process.env["X_USER"];
  if (!xUser) {
    console.error("Missing X_USER — set it in .env to audit that account's following count.");
    process.exit(1);
  }

  const { apiKey } = loadConfig();
  const users = new UserService(new TwitterClient(apiKey));
  const info = await users.getUserInfo(xUser);

  const statePath = path.join(process.cwd(), ".auth", "auto-follow-state.json");
  const store = new FollowStore(statePath);
  store.load();

  const record = {
    type: "audit",
    at: new Date().toISOString(),
    account: xUser,
    localFollowedCount: store.followedCount(),
    actualFollowingCount: info.following,
    note: "reference only — includes manual follows/unfollows",
  };

  const logPath = path.join(process.cwd(), "output", "auto-follow-log.jsonl");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(record) + "\n", "utf8");

  console.log(
    `Audit for @${xUser}: local=${record.localFollowedCount} ` +
      `actual=${record.actualFollowingCount} (appended to ${logPath})`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
