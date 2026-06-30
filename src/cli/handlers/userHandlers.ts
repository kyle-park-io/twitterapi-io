import * as readline from "readline";
import { IHttpClient } from "../../client/IHttpClient";
import { UserService } from "../../services/UserService";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function handleUserMenu(
  rl: readline.Interface,
  client: IHttpClient
): Promise<void> {
  const svc = new UserService(client);

  console.log("\n--- User Menu ---");
  console.log("  1. Get user profile");
  console.log("  2. List followers");
  console.log("  3. List followings");
  console.log("  4. Search users");
  console.log("  0. Back");

  const choice = await ask(rl, "\nChoice: ");

  switch (choice.trim()) {
    case "1": {
      const userName = await ask(rl, "Username: ");
      const info = await svc.getUserInfo(userName.trim());
      console.log(`\n@${info.userName} (${info.name})`);
      console.log(`Followers: ${info.followers.toLocaleString()}`);
      console.log(`Following: ${info.following.toLocaleString()}`);
      console.log(`Verified: ${info.isBlueVerified}`);
      break;
    }
    case "2": {
      const userName = await ask(rl, "Username: ");
      const limitStr = await ask(rl, "How many followers to show? (default 20): ");
      const limit = parseInt(limitStr.trim()) || 20;
      let count = 0;
      console.log("");
      for await (const f of svc.getFollowers(userName.trim())) {
        console.log(`  @${f.userName} — ${f.name}`);
        if (++count >= limit) break;
      }
      console.log(`\nShowed ${count} followers.`);
      break;
    }
    case "3": {
      const userName = await ask(rl, "Username: ");
      const limitStr = await ask(rl, "How many followings to show? (default 20): ");
      const limit = parseInt(limitStr.trim()) || 20;
      let count = 0;
      console.log("");
      for await (const f of svc.getFollowings(userName.trim())) {
        console.log(`  @${f.userName} — ${f.name}`);
        if (++count >= limit) break;
      }
      console.log(`\nShowed ${count} followings.`);
      break;
    }
    case "4": {
      const query = await ask(rl, "Search query: ");
      const results = await svc.searchUsers(query.trim());
      console.log("");
      results.forEach((u) => console.log(`  @${u.userName} — ${u.name}`));
      console.log(`\n${results.length} result(s).`);
      break;
    }
    case "0":
      break;
    default:
      console.log("Invalid choice.");
  }
}
