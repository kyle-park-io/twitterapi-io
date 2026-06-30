import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService } from "../services/TweetService";

async function main() {
  const config = loadConfig();
  const client = new TwitterClient(config.apiKey);
  const tweets = new TweetService(client);

  const query =
    process.argv[2] ?? "from:0xMantleKR since:2025-01-01";
  const MAX = 20;

  console.log(`\nSearching: ${query}`);
  console.log(`(showing up to ${MAX} results)\n`);

  let count = 0;
  for await (const t of tweets.advancedSearch(query)) {
    console.log(`[${t.createdAt}] ${t.text.slice(0, 120).replace(/\n/g, " ")}`);
    if (++count >= MAX) break;
  }

  console.log(`\nTotal shown: ${count}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
