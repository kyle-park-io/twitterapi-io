import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { UserService, Follower } from "../services/UserService";

async function main() {
  const config = loadConfig();
  const client = new TwitterClient(config.apiKey);
  const users = new UserService(client);

  const args = process.argv.slice(2);
  const outputFlag = args.indexOf("--output");
  const outputPath = outputFlag !== -1 ? args[outputFlag + 1] : undefined;
  const target = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--output")
    ?? "0xMantleKR";

  const info = await users.getUserInfo(target);
  console.log(`\n@${info.userName} (${info.name})`);
  console.log(`Followers : ${info.followers.toLocaleString()}`);
  console.log(`Following : ${info.following.toLocaleString()}`);
  console.log(`Verified  : ${info.isBlueVerified}`);
  console.log(`Joined    : ${info.createdAt}`);

  const FOLLOWER_LIMIT = 10;
  console.log(`\nFirst ${FOLLOWER_LIMIT} followers:`);
  const followers: Follower[] = [];
  for await (const f of users.getFollowers(target)) {
    console.log(`  @${f.userName} — ${f.name}`);
    followers.push(f);
    if (followers.length >= FOLLOWER_LIMIT) break;
  }

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({ profile: info, followers }, null, 2), "utf8");
    console.log(`Saved to ${outputPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
