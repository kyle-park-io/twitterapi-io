import { loadWriteConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { WriteService } from "../services/WriteService";

async function main() {
  const config = loadWriteConfig();
  const client = new TwitterClient(config.apiKey);
  const writer = new WriteService(client, config);

  console.log("Logging in...");
  await writer.login();
  console.log("Logged in successfully.");

  const text = `Hello from twitterapi.io example! [${new Date().toISOString()}]`;
  console.log(`\nCreating tweet: "${text}"`);
  const result = await writer.createTweet(text);
  console.log(`Tweet created — id: ${result.tweetId}`);

  console.log("\nDeleting tweet...");
  await writer.deleteTweet(result.tweetId);
  console.log("Tweet deleted.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
