import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService, Tweet } from "../services/TweetService";

// Global anchor: https://x.com/Mantle_Official/status/2066880937271722093
const GLOBAL_ANCHOR_ID = "2066880937271722093";

// Korean anchors: https://x.com/0xMantleKR/status/2067154624088580308
//                 https://x.com/0xMantleKR/status/2067154687628132475
const KOREAN_ANCHOR_IDS = ["2067154624088580308", "2067154687628132475"];

const OUTPUT_KOREAN = path.join("output", "mantle-research-challenge-korean.json");
const OUTPUT_GLOBAL = path.join("output", "mantle-research-challenge-global.json");

function sortByEngagement(tweets: Tweet[]): Tweet[] {
  return [...tweets].sort((a, b) => {
    const likesDiff = (b.likeCount ?? 0) - (a.likeCount ?? 0);
    if (likesDiff !== 0) return likesDiff;
    return (b.viewCount ?? 0) - (a.viewCount ?? 0);
  });
}

async function fetchAllQuotes(svc: TweetService, tweetId: string, label: string): Promise<Tweet[]> {
  const results: Tweet[] = [];
  for await (const t of svc.getQuotes(tweetId)) {
    results.push(t);
    process.stdout.write(`  [${label}] ${results.length} quotes...\r`);
  }
  return results;
}

async function main() {
  const client = new TwitterClient(loadConfig().apiKey);
  const svc = new TweetService(client);

  console.log(`\nFetching Global quotes (anchor: ${GLOBAL_ANCHOR_ID})...`);
  const globalRaw = await fetchAllQuotes(svc, GLOBAL_ANCHOR_ID, "Global");
  console.log(`\n  -> ${globalRaw.length} quotes\n`);

  const koreanAll: Tweet[] = [];
  for (const anchorId of KOREAN_ANCHOR_IDS) {
    console.log(`Fetching Korean quotes (anchor: ${anchorId})...`);
    const quotes = await fetchAllQuotes(svc, anchorId, "Korean");
    console.log(`\n  -> ${quotes.length} quotes\n`);
    koreanAll.push(...quotes);
  }

  // Deduplicate Korean by id
  const seenKorean = new Set<string>();
  const korean = sortByEngagement(
    koreanAll.filter((t) => {
      if (seenKorean.has(t.id)) return false;
      seenKorean.add(t.id);
      return true;
    })
  );

  // Exclude from global any tweet that also appears in Korean
  const koreanIds = new Set(korean.map((t) => t.id));
  const global = sortByEngagement(globalRaw.filter((t) => !koreanIds.has(t.id)));

  const fetchedAt = new Date().toISOString();
  fs.mkdirSync("output", { recursive: true });

  fs.writeFileSync(
    OUTPUT_KOREAN,
    JSON.stringify(
      { anchorIds: KOREAN_ANCHOR_IDS, fetchedAt, total: korean.length, tweets: korean },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`Saved -> ${OUTPUT_KOREAN} (${korean.length} tweets)`);

  fs.writeFileSync(
    OUTPUT_GLOBAL,
    JSON.stringify(
      { anchorId: GLOBAL_ANCHOR_ID, fetchedAt, total: global.length, tweets: global },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`Saved -> ${OUTPUT_GLOBAL} (${global.length} tweets)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
