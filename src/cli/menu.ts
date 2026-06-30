import * as readline from "readline";
import { loadConfig, loadWriteConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { WriteService } from "../services/WriteService";
import { handleUserMenu } from "./handlers/userHandlers";
import { handleTweetMenu } from "./handlers/tweetHandlers";
import { handleWriteMenu } from "./handlers/writeHandlers";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const config = loadConfig();
  const client = new TwitterClient(config.apiKey);

  let writer: WriteService | null = null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const cleanup = () => {
    rl.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);

  while (true) {
    console.log("\n=== twitterapi.io CLI ===");
    console.log("  1. User");
    console.log("  2. Tweet");
    console.log("  3. Write (requires login)");
    console.log("  0. Exit");

    const choice = await ask(rl, "\nChoice: ");

    try {
      switch (choice.trim()) {
        case "1":
          await handleUserMenu(rl, client);
          break;
        case "2":
          await handleTweetMenu(rl, client);
          break;
        case "3": {
          if (!writer) {
            const writeConfig = loadWriteConfig();
            writer = new WriteService(client, writeConfig);
            console.log("\nLogging in...");
            await writer.login();
            console.log("Logged in.");
          }
          await handleWriteMenu(rl, client, loadWriteConfig(), writer);
          break;
        }
        case "0":
          console.log("Goodbye!");
          cleanup();
          return;
        default:
          console.log("Invalid choice.");
      }
    } catch (err) {
      console.error(
        "\nError:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

main();
