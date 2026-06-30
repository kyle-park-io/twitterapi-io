import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { UserService } from "../services/UserService";

async function main() {
  const config = loadConfig();
  const client = new TwitterClient(config.apiKey);
  const users = new UserService(client);

  const TARGET = process.argv[2] ?? "elonmusk";

  const info = await users.getUserInfo(TARGET);
  console.log(`\n@${info.userName} (${info.name})`);
  console.log(`Followers : ${info.followers.toLocaleString()}`);
  console.log(`Following : ${info.following.toLocaleString()}`);
  console.log(`Verified  : ${info.isBlueVerified}`);
  console.log(`Joined    : ${info.createdAt}`);

  const FOLLOWER_LIMIT = 10;
  console.log(`\nFirst ${FOLLOWER_LIMIT} followers:`);
  let count = 0;
  for await (const f of users.getFollowers(TARGET)) {
    console.log(`  @${f.userName} — ${f.name}`);
    if (++count >= FOLLOWER_LIMIT) break;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
