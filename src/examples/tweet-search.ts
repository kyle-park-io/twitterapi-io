import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService, Tweet } from "../services/TweetService";

function parseArgs(argv: string[]): { query: string; outputPath?: string; sort: string; sortByLikes: boolean } {
  const args = argv.slice(2);
  let query = "from:0xMantleKR since:2025-01-01";
  let outputPath: string | undefined;
  let sort = "Latest";
  let sortByLikes = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    } else if (args[i] === "--sort" && args[i + 1]) {
      sort = args[++i];
    } else if (args[i] === "--sort-by-likes") {
      sortByLikes = true;
    } else if (!args[i].startsWith("--")) {
      query = args[i];
    }
  }

  return { query, outputPath, sort, sortByLikes };
}

async function main() {
  const { query, outputPath, sort, sortByLikes } = parseArgs(process.argv);
  const client = new TwitterClient(loadConfig().apiKey);
  const tweets = new TweetService(client);
  const MAX = 20;

  console.log(`\nSearching: ${query} [${sort}${sortByLikes ? ", sorted by likes" : ""}]`);
  console.log(`(showing up to ${MAX} results)\n`);

  const results: Tweet[] = [];
  for await (const t of tweets.advancedSearch(query, sort)) {
    results.push(t);
    if (results.length >= MAX) break;
  }

  if (sortByLikes) {
    results.sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0));
  }

  for (const t of results) {
    const likes = t.likeCount !== undefined ? ` ❤ ${t.likeCount.toLocaleString()}` : "";
    const rts = t.retweetCount !== undefined ? ` 🔁 ${t.retweetCount.toLocaleString()}` : "";
    console.log(`[${t.createdAt}]${likes}${rts}`);
    console.log(`  ${t.text.slice(0, 120).replace(/\n/g, " ")}\n`);
  }

  console.log(`Total shown: ${results.length}`);

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ query, sort, sortByLikes, tweets: results }, null, 2),
      "utf8"
    );
    console.log(`Saved to ${outputPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
