import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService, Tweet } from "../services/TweetService";

function parseArgs(argv: string[]): { query: string; outputPath?: string; sort: string } {
  const args = argv.slice(2);
  let query = "from:0xMantleKR since:2025-01-01";
  let outputPath: string | undefined;
  let sort = "Latest";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    } else if (args[i] === "--sort" && args[i + 1]) {
      sort = args[++i];
    } else if (!args[i].startsWith("--")) {
      query = args[i];
    }
  }

  return { query, outputPath, sort };
}

async function main() {
  const { query, outputPath, sort } = parseArgs(process.argv);
  const client = new TwitterClient(loadConfig().apiKey);
  const tweets = new TweetService(client);
  const MAX = 20;

  console.log(`\nSearching: ${query} [${sort}]`);
  console.log(`(showing up to ${MAX} results)\n`);

  const results: Tweet[] = [];
  for await (const t of tweets.advancedSearch(query, sort)) {
    const likes = t.likeCount !== undefined ? ` ❤ ${t.likeCount.toLocaleString()}` : "";
    const rts = t.retweetCount !== undefined ? ` 🔁 ${t.retweetCount.toLocaleString()}` : "";
    console.log(`[${t.createdAt}]${likes}${rts}`);
    console.log(`  ${t.text.slice(0, 120).replace(/\n/g, " ")}\n`);
    results.push(t);
    if (results.length >= MAX) break;
  }

  console.log(`Total shown: ${results.length}`);

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ query, sort, tweets: results }, null, 2),
      "utf8"
    );
    console.log(`Saved to ${outputPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
