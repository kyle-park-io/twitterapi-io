import * as readline from "readline";
import { IHttpClient } from "../../client/IHttpClient";
import { WriteConfig } from "../../config";
import { WriteService } from "../../services/WriteService";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function handleWriteMenu(
  rl: readline.Interface,
  client: IHttpClient,
  config: WriteConfig,
  writer: WriteService
): Promise<void> {
  console.log("\n--- Write Menu (requires login) ---");
  console.log("  1. Create tweet");
  console.log("  2. Delete tweet");
  console.log("  3. Like tweet");
  console.log("  4. Follow user");
  console.log("  5. Unfollow user");
  console.log("  6. Send DM");
  console.log("  0. Back");

  const choice = await ask(rl, "\nChoice: ");

  switch (choice.trim()) {
    case "1": {
      const text = await ask(rl, "Tweet text: ");
      const result = await writer.createTweet(text.trim());
      console.log(`\nTweet created — id: ${result.tweetId}`);
      break;
    }
    case "2": {
      const tweetId = await ask(rl, "Tweet ID to delete: ");
      await writer.deleteTweet(tweetId.trim());
      console.log("\nTweet deleted.");
      break;
    }
    case "3": {
      const tweetId = await ask(rl, "Tweet ID to like: ");
      await writer.likeTweet(tweetId.trim());
      console.log("\nLiked.");
      break;
    }
    case "4": {
      const userId = await ask(rl, "User ID to follow: ");
      await writer.followUser(userId.trim());
      console.log("\nFollowed.");
      break;
    }
    case "5": {
      const userId = await ask(rl, "User ID to unfollow: ");
      await writer.unfollowUser(userId.trim());
      console.log("\nUnfollowed.");
      break;
    }
    case "6": {
      const userId = await ask(rl, "User ID: ");
      const text = await ask(rl, "Message: ");
      await writer.sendDm(userId.trim(), text.trim());
      console.log("\nDM sent.");
      break;
    }
    case "0":
      break;
    default:
      console.log("Invalid choice.");
  }
}
