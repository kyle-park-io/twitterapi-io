import * as readline from "readline";
import { IHttpClient } from "../../client/IHttpClient";
import { TweetService } from "../../services/TweetService";
import { TrendService } from "../../services/TrendService";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function handleTweetMenu(
  rl: readline.Interface,
  client: IHttpClient
): Promise<void> {
  const tweetSvc = new TweetService(client);
  const trendSvc = new TrendService(client);

  console.log("\n--- Tweet Menu ---");
  console.log("  1. Advanced tweet search");
  console.log("  2. User's recent tweets");
  console.log("  3. User tweets by sort (latest / top)");
  console.log("  4. Tweet replies");
  console.log("  5. Trends");
  console.log("  0. Back");

  const choice = await ask(rl, "\nChoice: ");

  switch (choice.trim()) {
    case "1": {
      const query = await ask(rl, "Search query: ");
      const limitStr = await ask(rl, "Max results (default 10): ");
      const limit = parseInt(limitStr.trim()) || 10;
      let count = 0;
      console.log("");
      for await (const t of tweetSvc.advancedSearch(query.trim())) {
        console.log(`[${t.createdAt}] ${t.text.slice(0, 120).replace(/\n/g, " ")}`);
        if (++count >= limit) break;
      }
      console.log(`\nShowed ${count} tweet(s).`);
      break;
    }
    case "2": {
      const userName = await ask(rl, "Username: ");
      const results = await tweetSvc.getLastTweets(userName.trim());
      console.log("");
      results.slice(0, 10).forEach((t) =>
        console.log(`[${t.createdAt}] ${t.text.slice(0, 120).replace(/\n/g, " ")}`)
      );
      break;
    }
    case "3": {
      const userName = await ask(rl, "Username: ");
      const sortStr = await ask(rl, "Sort by: 1=Latest (default), 2=Top: ");
      const queryType = sortStr.trim() === "2" ? "Top" : "Latest";
      const limitStr = await ask(rl, "Max results (default 10): ");
      const limit = parseInt(limitStr.trim()) || 10;
      const query = `from:${userName.trim()}`;
      let count = 0;
      console.log(`\n[${queryType}] tweets from @${userName.trim()}\n`);
      for await (const t of tweetSvc.advancedSearch(query, queryType)) {
        const likes = t.likeCount !== undefined ? ` ❤ ${t.likeCount.toLocaleString()}` : "";
        const rts = t.retweetCount !== undefined ? ` 🔁 ${t.retweetCount.toLocaleString()}` : "";
        console.log(`[${t.createdAt}]${likes}${rts}`);
        console.log(`  ${t.text.slice(0, 120).replace(/\n/g, " ")}\n`);
        if (++count >= limit) break;
      }
      console.log(`Showed ${count} tweet(s).`);
      break;
    }
    case "4": {
      const tweetId = await ask(rl, "Tweet ID: ");
      const replies = await tweetSvc.getReplies(tweetId.trim());
      console.log("");
      replies.slice(0, 10).forEach((t) =>
        console.log(`  @${t.author?.userName ?? "?"}: ${t.text.slice(0, 100).replace(/\n/g, " ")}`)
      );
      console.log(`\n${replies.length} reply(ies).`);
      break;
    }
    case "5": {
      const woeidStr = await ask(rl, "WOEID (1=worldwide, 23424977=US, default 1): ");
      const woeid = parseInt(woeidStr.trim()) || 1;
      const trends = await trendSvc.getTrends(woeid, 20);
      console.log("");
      trends.forEach((t, i) => {
        const vol = t.tweetVolume ? ` (${t.tweetVolume.toLocaleString()})` : "";
        console.log(`  ${i + 1}. ${t.name}${vol}`);
      });
      break;
    }
    case "0":
      break;
    default:
      console.log("Invalid choice.");
  }
}
