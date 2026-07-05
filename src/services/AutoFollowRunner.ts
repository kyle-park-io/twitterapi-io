import { IFollower } from "../follow/IFollower";
import { FollowStore } from "./FollowStore";

interface AuthoredTweet {
  author?: { userName: string; name: string };
}

interface TweetSource {
  advancedSearch(query: string, queryType?: string): AsyncGenerator<AuthoredTweet>;
}

export interface AutoFollowRunnerOptions {
  keywords: string[];
  queryType: string;
  perKeyword: number;
  maxPerRun: number;
  dryRun: boolean;
  /** Milliseconds to wait between real follows. Defaults to a random 30–90s. */
  delayMs?: () => number;
  /** Clock, injectable for tests. Defaults to `new Date()`. */
  now?: () => Date;
}

export interface CycleSummary {
  scanned: number;
  candidates: number;
  followed: string[];
}

function randomDelayMs(): number {
  return 30000 + Math.floor(Math.random() * 60001); // 30000–90000
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AutoFollowRunner {
  private readonly delayMs: () => number;
  private readonly now: () => Date;

  constructor(
    private readonly source: TweetSource,
    private readonly store: FollowStore,
    private readonly follower: IFollower,
    private readonly options: AutoFollowRunnerOptions
  ) {
    this.delayMs = options.delayMs ?? randomDelayMs;
    this.now = options.now ?? (() => new Date());
  }

  async runCycle(): Promise<CycleSummary> {
    const lastRun = this.store.getLastRun();
    const sinceSuffix = lastRun
      ? ` since:${lastRun.toISOString().slice(0, 19).replace("T", "_")}_UTC`
      : "";

    let scanned = 0;
    const seen = new Set<string>();
    const candidates: string[] = [];

    for (const keyword of this.options.keywords) {
      const query = `${keyword}${sinceSuffix}`;
      let perKeywordCount = 0;
      try {
        for await (const tweet of this.source.advancedSearch(query, this.options.queryType)) {
          if (perKeywordCount >= this.options.perKeyword) break;
          perKeywordCount++;
          scanned++;
          const userName = tweet.author?.userName;
          if (!userName) continue;
          const key = userName.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          if (this.store.has(userName)) continue;
          candidates.push(userName);
        }
      } catch (err) {
        console.error(
          `Search failed for "${query}":`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    const targets = candidates.slice(0, this.options.maxPerRun);
    const followed: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      const userName = targets[i];
      if (this.options.dryRun) {
        console.log(`[dry-run] would follow @${userName}`);
        followed.push(userName);
        continue;
      }
      try {
        if (i > 0) await sleep(this.delayMs());
        await this.follower.follow(userName);
        this.store.add(userName);
        followed.push(userName);
        console.log(`Followed @${userName}`);
      } catch (err) {
        console.error(
          `Follow failed for @${userName}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    this.store.setLastRun(this.now());
    this.store.save();

    return { scanned, candidates: candidates.length, followed };
  }
}
