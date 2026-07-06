import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService, Tweet } from "../services/TweetService";

// Full census of @0xMantleKR tweets across Q2 2026 (2026-04-01 → 06-30).
// Collected via monthly-window queries to avoid the pagination cutoff that a
// single wide window hits, then deduped and aggregated into a report.
const ACCOUNT = "0xMantleKR";
const MONTH_WINDOWS = [
  { since: "2026-04-01", until: "2026-05-01" },
  { since: "2026-05-01", until: "2026-06-01" },
  { since: "2026-06-01", until: "2026-07-01" },
];

const OUTPUT_TWEETS = path.join("output", "mantle-kr-q2-audit-tweets.json");
const OUTPUT_REPORT = path.join("output", "mantle-kr-q2-audit-report.json");

function num(value?: number): number {
  return typeof value === "number" ? value : 0;
}

async function collectWindow(svc: TweetService, query: string, label: string): Promise<Tweet[]> {
  const results: Tweet[] = [];
  for await (const t of svc.advancedSearch(query, "Latest")) {
    results.push(t);
    process.stdout.write(`  [${label}] ${results.length} tweets...\r`);
  }
  return results;
}

function total(tweets: Tweet[], key: keyof Tweet): number {
  return tweets.reduce((sum, t) => sum + num(t[key] as number), 0);
}

function median(tweets: Tweet[], key: keyof Tweet): number {
  const sorted = tweets.map((t) => num(t[key] as number)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function buildReport(tweets: Tweet[]) {
  const byDate = [...tweets].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const withViews = tweets.filter((t) => num(t.viewCount) > 0);
  const engagementRates = withViews.map(
    (t) => (num(t.likeCount) + num(t.retweetCount) + num(t.replyCount)) / num(t.viewCount),
  );
  const avgEngagementRate = engagementRates.length
    ? engagementRates.reduce((sum, r) => sum + r, 0) / engagementRates.length
    : 0;

  const topByViews = [...tweets]
    .sort((a, b) => num(b.viewCount) - num(a.viewCount))
    .slice(0, 15)
    .map((t) => ({
      views: num(t.viewCount),
      likes: num(t.likeCount),
      createdAt: t.createdAt,
      url: t.url,
      text: t.text.replace(/\n/g, " ").slice(0, 100),
    }));

  return {
    account: ACCOUNT,
    fetchedAt: new Date().toISOString(),
    totalTweets: tweets.length,
    earliest: byDate[0]?.createdAt,
    latest: byDate[byDate.length - 1]?.createdAt,
    views: {
      total: total(tweets, "viewCount"),
      avg: +(total(tweets, "viewCount") / tweets.length).toFixed(1),
      median: median(tweets, "viewCount"),
      max: Math.max(...tweets.map((t) => num(t.viewCount))),
    },
    likes: {
      total: total(tweets, "likeCount"),
      avg: +(total(tweets, "likeCount") / tweets.length).toFixed(2),
      median: median(tweets, "likeCount"),
    },
    avgEngagementRatePct: +(avgEngagementRate * 100).toFixed(2),
    topByViews,
  };
}

async function main() {
  const client = new TwitterClient(loadConfig().apiKey);
  const svc = new TweetService(client);

  const seen = new Set<string>();
  const tweets: Tweet[] = [];
  for (const { since, until } of MONTH_WINDOWS) {
    const query = `from:${ACCOUNT} since:${since} until:${until}`;
    console.log(`\nFetching ${query}...`);
    const batch = await collectWindow(svc, query, since.slice(0, 7));
    let added = 0;
    for (const t of batch) {
      if (t.id && seen.has(t.id)) continue;
      if (t.id) seen.add(t.id);
      tweets.push(t);
      added++;
    }
    console.log(`\n  -> ${added} new tweets (${batch.length} fetched)`);
  }

  const report = buildReport(tweets);
  const fetchedAt = report.fetchedAt;

  fs.mkdirSync("output", { recursive: true });

  fs.writeFileSync(
    OUTPUT_TWEETS,
    JSON.stringify({ account: ACCOUNT, fetchedAt, total: tweets.length, tweets }, null, 2),
    "utf8",
  );
  console.log(`\nSaved -> ${OUTPUT_TWEETS} (${tweets.length} tweets)`);

  fs.writeFileSync(OUTPUT_REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log(`Saved -> ${OUTPUT_REPORT}`);

  console.log(
    `\n${report.totalTweets} tweets | ${report.views.total.toLocaleString()} views ` +
      `| avg ${report.views.avg} / median ${report.views.median} ` +
      `| engagement ${report.avgEngagementRatePct}%`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
