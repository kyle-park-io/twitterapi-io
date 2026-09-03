import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService, Tweet } from "../services/TweetService";
import { UserService } from "../services/UserService";

// Raw-data collection for the Mantle KR DevRel timeline (2026-04-07 → today).
// Pulls every tweet from the Korean account and the two global accounts so the
// KR output can be read against what global shipped on the same days.
// Weekly windows keep each advanced_search query under the pagination cutoff.
const PERIOD_START = "2026-04-07";
const PERIOD_END = process.env.PERIOD_END ?? "2026-09-04"; // exclusive: covers through the previous day

const ACCOUNTS = [
  { userName: "0xMantleKR", scope: "kr", label: "Mantle Korea (official KR account)" },
  { userName: "Mantle_Official", scope: "global", label: "Mantle global flagship" },
  { userName: "0xMantle", scope: "global", label: "Mantle Network (dormant since 2025-02)" },
  { userName: "bcd_kyle", scope: "personal", label: "Kyle — Mantle KR DevRel (personal)" },
] as const;

// Mentions show what partners/community said about the KR operation — the
// offline events and workshops that never make it into the KR account's feed.
const MENTION_TARGETS = ["0xMantleKR", "bcd_kyle"];

const DATA_DIR = path.join("devrel", "data");

interface SlimTweet {
  id: string;
  account: string;
  scope: string;
  date: string; // YYYY-MM-DD (UTC)
  createdAt: string; // ISO
  text: string;
  url?: string;
  lang?: string;
  isReply: boolean;
  conversationId?: string;
  isSelfThread: boolean;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views: number;
  bookmarks: number;
  mentions: string[];
  hashtags: string[];
  links: string[];
  hasMedia: boolean;
  quotedUrl?: string;
}

// Tweet fields the API returns that TweetService's interface doesn't declare.
interface RawTweet extends Tweet {
  isReply?: boolean;
  inReplyToUsername?: string;
  conversationId?: string;
  lang?: string;
  entities?: {
    user_mentions?: { screen_name: string }[];
    hashtags?: { text: string }[];
    urls?: { expanded_url?: string }[];
  };
  extendedEntities?: { media?: unknown[] };
}

function num(value?: number): number {
  return typeof value === "number" ? value : 0;
}

function weeklyWindows(start: string, end: string): { since: string; until: string }[] {
  const windows: { since: string; until: string }[] = [];
  const endMs = Date.parse(`${end}T00:00:00Z`);
  let cursor = Date.parse(`${start}T00:00:00Z`);
  while (cursor < endMs) {
    const next = Math.min(cursor + 7 * 24 * 60 * 60 * 1000, endMs);
    windows.push({
      since: new Date(cursor).toISOString().slice(0, 10),
      until: new Date(next).toISOString().slice(0, 10),
    });
    cursor = next;
  }
  return windows;
}

async function collect(
  svc: TweetService,
  userName: string,
  buildQuery: (since: string, until: string) => string,
): Promise<{ tweets: RawTweet[]; windows: { since: string; until: string; count: number }[] }> {
  const seen = new Set<string>();
  const tweets: RawTweet[] = [];
  const windows: { since: string; until: string; count: number }[] = [];

  for (const { since, until } of weeklyWindows(PERIOD_START, PERIOD_END)) {
    const query = buildQuery(since, until);
    let fetched = 0;
    let added = 0;
    for await (const t of svc.advancedSearch(query, "Latest")) {
      fetched++;
      const raw = t as RawTweet;
      if (!raw.id || seen.has(raw.id)) continue;
      seen.add(raw.id);
      tweets.push(raw);
      added++;
      process.stdout.write(`  ${userName} ${since}: ${added} new / ${fetched} fetched\r`);
    }
    windows.push({ since, until, count: added });
    process.stdout.write(`  ${userName} ${since} → ${until}: ${added} tweets\n`);
  }

  tweets.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return { tweets, windows };
}

function slim(t: RawTweet, account: string, scope: string): SlimTweet {
  const iso = new Date(t.createdAt).toISOString();
  const mentions = (t.entities?.user_mentions ?? []).map((m) => m.screen_name);
  return {
    id: t.id,
    account,
    scope,
    date: iso.slice(0, 10),
    createdAt: iso,
    text: t.text,
    url: t.url,
    lang: t.lang,
    isReply: Boolean(t.isReply),
    conversationId: t.conversationId,
    // A reply to your own thread is a thread continuation, not a conversation.
    isSelfThread: Boolean(t.isReply) && t.inReplyToUsername === account,
    likes: num(t.likeCount),
    retweets: num(t.retweetCount),
    replies: num(t.replyCount),
    quotes: num(t.quoteCount),
    views: num(t.viewCount),
    bookmarks: num(t.bookmarkCount),
    mentions,
    hashtags: (t.entities?.hashtags ?? []).map((h) => h.text),
    links: (t.entities?.urls ?? []).map((u) => u.expanded_url ?? "").filter(Boolean),
    hasMedia: Boolean(t.extendedEntities?.media?.length),
    quotedUrl: t.quoted_tweet?.url,
  };
}

function readStored(fileName: string): { fetchedAt: string; tweets: RawTweet[] } | null {
  const file = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as { fetchedAt: string; tweets: RawTweet[] };
}

function windowCounts(tweets: RawTweet[]): { since: string; until: string; count: number }[] {
  return weeklyWindows(PERIOD_START, PERIOD_END).map(({ since, until }) => ({
    since,
    until,
    count: tweets.filter((t) => {
      const day = new Date(t.createdAt).toISOString().slice(0, 10);
      return day >= since && day < until;
    }).length,
  }));
}

async function main() {
  const client = new TwitterClient(loadConfig().apiKey);
  const tweetSvc = new TweetService(client);
  const userSvc = new UserService(client);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const all: SlimTweet[] = [];

  // `--only a,b` re-fetches just those accounts and leaves the rest on disk.
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg > -1 ? (process.argv[onlyArg + 1] ?? "").split(",") : null;
  const skipMentions = process.argv.includes("--no-mentions");

  for (const { userName, scope, label } of ACCOUNTS) {
    if (only && !only.includes(userName)) continue;
    console.log(`\n=== ${userName} (${scope}) ===`);

    const profile = await userSvc.getUserInfo(userName);
    fs.writeFileSync(
      path.join(DATA_DIR, `${userName}-profile.json`),
      JSON.stringify({ fetchedAt, profile }, null, 2),
      "utf8",
    );

    const { tweets } = await collect(
      tweetSvc,
      userName,
      (since, until) => `from:${userName} since:${since} until:${until}`,
    );
    fs.writeFileSync(
      path.join(DATA_DIR, `${userName}-tweets.json`),
      JSON.stringify(
        { account: userName, scope, label, periodStart: PERIOD_START, periodEnd: PERIOD_END, fetchedAt, total: tweets.length, tweets },
        null,
        2,
      ),
      "utf8",
    );

    console.log(`  saved ${tweets.length} tweets -> ${DATA_DIR}/${userName}-tweets.json`);
  }

  for (const target of skipMentions ? [] : MENTION_TARGETS) {
    console.log(`\n=== mentions of @${target} ===`);
    const { tweets } = await collect(
      tweetSvc,
      `mentions-${target}`,
      (since, until) => `@${target} -from:${target} since:${since} until:${until}`,
    );
    fs.writeFileSync(
      path.join(DATA_DIR, `mentions-${target}.json`),
      JSON.stringify({ target, periodStart: PERIOD_START, periodEnd: PERIOD_END, fetchedAt, total: tweets.length, tweets }, null, 2),
      "utf8",
    );
    console.log(`  saved ${tweets.length} mentions -> ${DATA_DIR}/mentions-${target}.json`);
  }

  // Timeline and manifest are both rebuilt from what's on disk, not from what
  // this run happened to fetch, so an `--only` run never drops the rest.
  const manifest: Record<string, unknown>[] = [];
  for (const { userName, scope, label } of ACCOUNTS) {
    const stored = readStored(`${userName}-tweets.json`);
    if (!stored) continue;
    for (const t of stored.tweets) all.push(slim(t, userName, scope));
    manifest.push({
      account: userName,
      scope,
      label,
      total: stored.tweets.length,
      fetchedAt: stored.fetchedAt,
      windows: windowCounts(stored.tweets),
    });
  }
  for (const target of MENTION_TARGETS) {
    const stored = readStored(`mentions-${target}.json`);
    if (!stored) continue;
    manifest.push({
      mentionsOf: target,
      total: stored.tweets.length,
      fetchedAt: stored.fetchedAt,
      windows: windowCounts(stored.tweets),
    });
  }

  all.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  fs.writeFileSync(
    path.join(DATA_DIR, "timeline.json"),
    JSON.stringify({ periodStart: PERIOD_START, periodEnd: PERIOD_END, fetchedAt, total: all.length, tweets: all }, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "collection-manifest.json"),
    JSON.stringify({ periodStart: PERIOD_START, periodEnd: PERIOD_END, fetchedAt, accounts: manifest }, null, 2),
    "utf8",
  );

  console.log(`\nTotal ${all.length} tweets across ${ACCOUNTS.length} accounts -> ${DATA_DIR}/timeline.json`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
