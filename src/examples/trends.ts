import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TrendService } from "../services/TrendService";

async function main() {
  const config = loadConfig();
  const client = new TwitterClient(config.apiKey);
  const trender = new TrendService(client);

  console.log("\n=== Worldwide Trends ===");
  const worldwide = await trender.getTrends(1, 10);
  worldwide.forEach((t, i) => {
    const vol = t.tweetVolume ? ` (${t.tweetVolume.toLocaleString()} tweets)` : "";
    console.log(`  ${i + 1}. ${t.name}${vol}`);
  });

  console.log("\n=== US Trends ===");
  const us = await trender.getTrends(23424977, 10);
  us.forEach((t, i) => {
    const vol = t.tweetVolume ? ` (${t.tweetVolume.toLocaleString()} tweets)` : "";
    console.log(`  ${i + 1}. ${t.name}${vol}`);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
