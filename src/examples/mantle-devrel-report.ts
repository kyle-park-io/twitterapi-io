import * as fs from "fs";
import * as path from "path";

// Turns devrel/data/timeline.json into the two machine-generated parts of the
// DevRel write-up: a stats block and the full day-by-day raw log (Appendix D).
// The analytical documents in devrel/ are written by hand on top of these.
const DATA_DIR = path.join("devrel", "data");
const OUT_LOG = path.join("devrel", "93-appendix-D-daily-log.md");
const OUT_STATS = path.join(DATA_DIR, "stats.json");

interface SlimTweet {
  id: string;
  account: string;
  scope: string;
  date: string;
  createdAt: string;
  text: string;
  url?: string;
  isReply: boolean;
  isSelfThread: boolean;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views: number;
  bookmarks: number;
  mentions: string[];
}

interface Bucket {
  tweets: number;
  originals: number;
  threadParts: number;
  conversationReplies: number;
  views: number;
  originalViews: number;
  likes: number;
  retweets: number;
  activeDays: Set<string>;
}

function emptyBucket(): Bucket {
  return {
    tweets: 0,
    originals: 0,
    threadParts: 0,
    conversationReplies: 0,
    views: 0,
    originalViews: 0,
    likes: 0,
    retweets: 0,
    activeDays: new Set(),
  };
}

function add(b: Bucket, t: SlimTweet): void {
  b.tweets++;
  if (!t.isReply) {
    b.originals++;
    b.originalViews += t.views;
  } else if (t.isSelfThread) b.threadParts++;
  else b.conversationReplies++;
  b.views += t.views;
  b.likes += t.likes;
  b.retweets += t.retweets;
  b.activeDays.add(t.date);
}

function serialize(b: Bucket) {
  return {
    tweets: b.tweets,
    originals: b.originals,
    threadParts: b.threadParts,
    conversationReplies: b.conversationReplies,
    activeDays: b.activeDays.size,
    views: b.views,
    likes: b.likes,
    retweets: b.retweets,
    avgViews: b.tweets ? +(b.views / b.tweets).toFixed(1) : 0,
    // Thread parts and replies inherit a parent's reach, so the honest
    // per-post reach number is the one measured on originals alone.
    avgViewsOriginals: b.originals ? +(b.originalViews / b.originals).toFixed(1) : 0,
  };
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function main() {
  const timeline = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "timeline.json"), "utf8"),
  ) as { periodStart: string; periodEnd: string; fetchedAt: string; tweets: SlimTweet[] };

  const byScope: Record<string, Bucket> = {};
  const byMonth: Record<string, Record<string, Bucket>> = {};

  for (const t of timeline.tweets) {
    add((byScope[t.scope] ??= emptyBucket()), t);
    const m = t.date.slice(0, 7);
    byMonth[m] ??= {};
    add((byMonth[m][t.scope] ??= emptyBucket()), t);
  }

  const stats = {
    periodStart: timeline.periodStart,
    periodEnd: timeline.periodEnd,
    fetchedAt: timeline.fetchedAt,
    totals: Object.fromEntries(Object.entries(byScope).map(([k, v]) => [k, serialize(v)])),
    byMonth: Object.fromEntries(
      Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([m, scopes]) => [
          m,
          Object.fromEntries(Object.entries(scopes).map(([s, v]) => [s, serialize(v)])),
        ]),
    ),
  };
  fs.writeFileSync(OUT_STATS, JSON.stringify(stats, null, 2), "utf8");

  // Appendix D — every tweet, grouped by day, KR first then global.
  const days = new Map<string, SlimTweet[]>();
  for (const t of timeline.tweets) {
    if (!days.has(t.date)) days.set(t.date, []);
    days.get(t.date)!.push(t);
  }

  const scopeTag: Record<string, string> = { kr: "🇰🇷", global: "🌐", personal: "⭐" };
  const lines: string[] = [
    "# 별첨 D — 전체 원문 로그 (날짜별)",
    "",
    `기간: ${timeline.periodStart} ~ ${timeline.periodEnd} (UTC 기준) · 수집 시각: ${timeline.fetchedAt}`,
    "",
    "`pnpm example:mantle-devrel-report`로 `devrel/data/timeline.json`에서 자동 생성됩니다. 직접 수정하지 마세요.",
    "",
    "범례: 🇰🇷 `@0xMantleKR` · 🌐 `@Mantle_Official` · ⭐ `@bcd_kyle`(본인) · `↳` 같은 스레드의 이어지는 글 · `↰` 남에게 단 답글",
    "",
  ];

  for (const date of [...days.keys()].sort()) {
    const items = days
      .get(date)!
      .sort((a, b) => {
        const order = (s: string) => (s === "kr" ? 0 : s === "personal" ? 1 : 2);
        return order(a.scope) - order(b.scope) || a.createdAt.localeCompare(b.createdAt);
      });
    lines.push(`## ${date}`, "");
    for (const t of items) {
      const kind = !t.isReply ? "" : t.isSelfThread ? "↳ " : "↰ ";
      const metrics = `조회 ${t.views.toLocaleString()} · 좋아요 ${t.likes} · RT ${t.retweets}`;
      const link = t.url ? ` · [원문](${t.url})` : "";
      lines.push(
        `- ${scopeTag[t.scope] ?? "•"} \`${t.createdAt.slice(11, 16)}\` ${kind}${oneLine(t.text, 300)}`,
        `  <br/><sub>${metrics}${link}</sub>`,
      );
    }
    lines.push("");
  }

  fs.writeFileSync(OUT_LOG, lines.join("\n"), "utf8");

  console.log(`Saved -> ${OUT_STATS}`);
  console.log(`Saved -> ${OUT_LOG} (${days.size} days, ${timeline.tweets.length} tweets)`);
  for (const [scope, v] of Object.entries(stats.totals)) {
    console.log(`  ${scope.padEnd(9)} ${v.tweets} tweets | ${v.views.toLocaleString()} views | ${v.activeDays} active days`);
  }
}

main();
