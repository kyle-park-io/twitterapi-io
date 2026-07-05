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
  /** Max tweets scanned per sampled keyword. */
  perKeyword: number;
  /** How many keywords to sample per search batch. */
  keywordsPerCycle: number;
  /** Max follows performed per cycle (also the queue top-up target). */
  maxPerRun: number;
  dryRun: boolean;
  /** Milliseconds to wait between real follows. Defaults to a random 30–90s. */
  delayMs?: () => number;
  /** Clock, injectable for tests. Defaults to `new Date()`. */
  now?: () => Date;
  /** Samples `n` keywords from `all`. Defaults to a random pick; injectable for tests. */
  pickKeywords?: (all: string[], n: number) => string[];
}

export interface CycleSummary {
  /** Tweets scanned across all searches this cycle. */
  scanned: number;
  /** Candidates queued this cycle (newly enqueued). */
  queued: number;
  /** Usernames followed (or, in dry-run, that would be followed). */
  followed: string[];
}

function randomDelayMs(): number {
  return 30000 + Math.floor(Math.random() * 60001); // 30000–90000
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fisher–Yates sample of `n` distinct elements from `all`. */
function randomSample(all: string[], n: number): string[] {
  const pool = [...all];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

export class AutoFollowRunner {
  private readonly delayMs: () => number;
  private readonly now: () => Date;
  private readonly pickKeywords: (all: string[], n: number) => string[];

  constructor(
    private readonly source: TweetSource,
    private readonly store: FollowStore,
    private readonly follower: IFollower,
    private readonly options: AutoFollowRunnerOptions
  ) {
    this.delayMs = options.delayMs ?? randomDelayMs;
    this.now = options.now ?? (() => new Date());
    this.pickKeywords = options.pickKeywords ?? randomSample;
  }

  async runCycle(): Promise<CycleSummary> {
    const scanned = await this.fillQueue();
    const queued = scanned.queued;
    const followed = await this.drainQueue();
    this.store.setLastRun(this.now());
    this.store.save();
    return { scanned: scanned.scanned, queued, followed };
  }

  /**
   * Tops up the queue toward `maxPerRun` by sampling `keywordsPerCycle` keywords at a
   * time and searching them, until the queue is full enough or the keyword pool for this
   * cycle is exhausted (an empty sample). Returns how many tweets were scanned and how
   * many new candidates were queued.
   */
  private async fillQueue(): Promise<{ scanned: number; queued: number }> {
    let scanned = 0;
    let queued = 0;
    const usedThisCycle = new Set<string>();

    while (this.store.queueSize() < this.options.maxPerRun) {
      const remaining = this.options.keywords.filter((k) => !usedThisCycle.has(k));
      if (remaining.length === 0) break;

      const batch = this.pickKeywords(remaining, this.options.keywordsPerCycle);
      if (batch.length === 0) break;
      for (const k of batch) usedThisCycle.add(k);

      for (const keyword of batch) {
        let perKeywordCount = 0;
        try {
          for await (const tweet of this.source.advancedSearch(keyword, this.options.queryType)) {
            if (perKeywordCount >= this.options.perKeyword) break;
            perKeywordCount++;
            scanned++;
            const userName = tweet.author?.userName;
            if (!userName) continue;
            const before = this.store.queueSize();
            this.store.enqueue(userName); // skips already-followed / already-queued
            if (this.store.queueSize() > before) queued++;
          }
        } catch (err) {
          console.error(
            `Search failed for "${keyword}":`,
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    }

    return { scanned, queued };
  }

  /**
   * Follows up to `maxPerRun` queued candidates. In dry-run, peeks (does not consume the
   * queue) so a later real run still has the candidates. In a real run, dequeues one at a
   * time, follows with a randomized delay between follows, and records each success in the
   * followed-set. A follow failure is logged and the candidate is dropped (not re-queued),
   * so a persistently unfollowable user cannot wedge the queue.
   */
  private async drainQueue(): Promise<string[]> {
    if (this.options.dryRun) {
      const targets = this.store.peek(this.options.maxPerRun);
      for (const userName of targets) console.log(`[dry-run] would follow @${userName}`);
      return targets;
    }

    const targets = this.store.dequeue(this.options.maxPerRun);
    const followed: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const userName = targets[i];
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
    return followed;
  }
}
