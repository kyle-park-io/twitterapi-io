import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService, Tweet } from "../services/TweetService";

type SortBy = "likes" | "views" | "retweets" | "replies" | "bookmarks";

const SORT_KEY: Record<SortBy, keyof Tweet> = {
  likes: "likeCount",
  views: "viewCount",
  retweets: "retweetCount",
  replies: "replyCount",
  bookmarks: "bookmarkCount",
};

function parseArgs(argv: string[]): { query: string; outputPath?: string; sort: string; sortBy?: SortBy; max: number } {
  const args = argv.slice(2);
  let query = "from:0xMantleKR since:2025-01-01";
  let outputPath: string | undefined;
  let sort = "Latest";
  let sortBy: SortBy | undefined;
  let max = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    } else if (args[i] === "--sort" && args[i + 1]) {
      sort = args[++i];
    } else if (args[i] === "--sort-by" && args[i + 1]) {
      sortBy = args[++i] as SortBy;
    } else if (args[i] === "--max" && args[i + 1]) {
      max = parseInt(args[++i]) || 20;
    } else if (!args[i].startsWith("--")) {
      query = args[i];
    }
  }

  if (sortBy && !SORT_KEY[sortBy]) {
    console.error(`Invalid --sort-by value: "${sortBy}". Use: ${Object.keys(SORT_KEY).join(", ")}`);
    process.exit(1);
  }

  return { query, outputPath, sort, sortBy, max };
}

async function main() {
  const { query, outputPath, sort, sortBy, max } = parseArgs(process.argv);
  const client = new TwitterClient(loadConfig().apiKey);
  const tweets = new TweetService(client);

  console.log(`\nSearching: ${query} [${sort}${sortBy ? `, sorted by ${sortBy}` : ""}]`);
  console.log(`(showing up to ${max} results)\n`);

  const results: Tweet[] = [];
  for await (const t of tweets.advancedSearch(query, sort)) {
    results.push(t);
    if (results.length >= max) break;
  }

  if (sortBy) {
    const key = SORT_KEY[sortBy];
    results.sort((a, b) => ((b[key] as number) ?? 0) - ((a[key] as number) ?? 0));
  }

  for (const t of results) {
    const likes = t.likeCount !== undefined ? ` ❤ ${t.likeCount.toLocaleString()}` : "";
    const views = t.viewCount !== undefined ? ` 👁 ${t.viewCount.toLocaleString()}` : "";
    const rts = t.retweetCount !== undefined ? ` 🔁 ${t.retweetCount.toLocaleString()}` : "";
    console.log(`[${t.createdAt}]${likes}${views}${rts}`);
    console.log(`  ${t.text.slice(0, 120).replace(/\n/g, " ")}\n`);
  }

  console.log(`Total shown: ${results.length}`);

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ query, sort, sortBy, max, tweets: results }, null, 2),
      "utf8"
    );
    console.log(`Saved to ${outputPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
