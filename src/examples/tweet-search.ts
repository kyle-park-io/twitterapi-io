import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService, Tweet } from "../services/TweetService";

async function main() {
  const config = loadConfig();
  const client = new TwitterClient(config.apiKey);
  const tweets = new TweetService(client);

  const args = process.argv.slice(2);
  const outputFlag = args.indexOf("--output");
  const outputPath = outputFlag !== -1 ? args[outputFlag + 1] : undefined;
  const query = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--output")
    ?? "from:0xMantleKR since:2025-01-01";
  const MAX = 20;

  console.log(`\nSearching: ${query}`);
  console.log(`(showing up to ${MAX} results)\n`);

  const results: Tweet[] = [];
  for await (const t of tweets.advancedSearch(query)) {
    console.log(`[${t.createdAt}] ${t.text.slice(0, 120).replace(/\n/g, " ")}`);
    results.push(t);
    if (results.length >= MAX) break;
  }

  console.log(`\nTotal shown: ${results.length}`);

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({ query, tweets: results }, null, 2), "utf8");
    console.log(`Saved to ${outputPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
