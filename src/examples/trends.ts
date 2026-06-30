import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TrendService, Trend } from "../services/TrendService";

async function main() {
  const args = process.argv.slice(2);
  const outputFlag = args.indexOf("--output");
  const outputPath = outputFlag !== -1 ? args[outputFlag + 1] : undefined;

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

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ worldwide, us } satisfies { worldwide: Trend[]; us: Trend[] }, null, 2),
      "utf8"
    );
    console.log(`\nSaved to ${outputPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
