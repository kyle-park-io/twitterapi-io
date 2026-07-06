import { IFollower } from "../follow/IFollower";
import { FollowStore } from "./FollowStore";

export type VerifiedTier = "blue" | "legacy" | "business" | "government";

interface AuthorVerification {
  isVerified?: boolean;
  isBlueVerified?: boolean;
  verifiedType?: string | null;
}

/** The verification tiers an author holds (may be several, or none). */
export function authorTiers(author: AuthorVerification): VerifiedTier[] {
  const tiers: VerifiedTier[] = [];
  if (author.isBlueVerified === true) tiers.push("blue");
  if (author.isVerified === true) tiers.push("legacy");
  if (author.verifiedType === "Business") tiers.push("business");
  if (author.verifiedType === "Government") tiers.push("government");
  return tiers;
}

/**
 * True if the author may be followed under `allowed`. Empty `allowed` = filter
 * off (always true). Otherwise true iff the author holds a tier in `allowed`.
 */
export function passesVerifiedFilter(
  author: AuthorVerification,
  allowed: VerifiedTier[]
): boolean {
  if (allowed.length === 0) return true;
  const held = authorTiers(author);
  return held.some((t) => allowed.includes(t));
}

interface AuthoredTweet {
  author?: {
    userName: string;
    name: string;
    isVerified?: boolean;
    isBlueVerified?: boolean;
    verifiedType?: string | null;
  };
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
  /** Verification tiers allowed through the filter; empty = filter off. */
  allowedVerified: VerifiedTier[];
}

export interface FollowedCandidate {
  userName: string;
  name?: string;
  url: string;
  keyword?: string;
  verified?: VerifiedTier[];
}

export interface CycleSummary {
  /** ISO timestamp when the cycle started. */
  startedAt: string;
  /** ISO timestamp when the cycle finished. */
  finishedAt: string;
  /** Wall-clock cycle duration in ms. */
  durationMs: number;
  /** Tweets scanned across all searches this cycle. */
  scanned: number;
  /** Candidates queued this cycle (newly enqueued). */
  queued: number;
  /** followed-set size before draining. */
  followedCountBefore: number;
  /** followed-set size after draining. */
  followedCountAfter: number;
  /** Newly followed this cycle (real follows only; 0 in dry-run). */
  addedCount: number;
  /** Candidates this cycle tried to follow (0 in dry-run). */
  attempted: number;
  /** attempted - addedCount for a real run; 0 in dry-run. */
  followFailures: number;
  /** consecutiveZeroCycles value AFTER this cycle. */
  consecutiveZeroCycles: number;
  /** Candidates rejected by the verified filter this cycle. */
  skippedUnverified: number;
  /** Followed (or, in dry-run, would-follow) candidates with metadata. */
  followed: FollowedCandidate[];
  dryRun: boolean;
}

export function isUnhealthy(consecutiveZeroCycles: number, threshold: number): boolean {
  return consecutiveZeroCycles >= threshold;
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
    const started = this.now();
    const followedCountBefore = this.store.followedCount();
    const fill = await this.fillQueue();
    const { followed, attempted } = await this.drainQueue();
    const followedCountAfter = this.store.followedCount();
    const finished = this.now();

    // Health assessment (real runs only). "Attempted but followed 0" is a
    // symptom; a cycle with nothing to attempt is not a failure.
    if (!this.options.dryRun) {
      if (followed.length > 0) {
        this.store.setConsecutiveZeroCycles(0);
        this.store.setLastSuccessAt(finished);
      } else if (attempted > 0) {
        this.store.setConsecutiveZeroCycles(this.store.getConsecutiveZeroCycles() + 1);
      }
      // attempted === 0 → leave counters untouched.
    }

    this.store.setLastRun(finished);
    this.store.save();

    return {
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      scanned: fill.scanned,
      queued: fill.queued,
      skippedUnverified: fill.skippedUnverified,
      followedCountBefore,
      followedCountAfter,
      addedCount: this.options.dryRun ? 0 : followed.length,
      attempted,
      followFailures: this.options.dryRun ? 0 : attempted - followed.length,
      consecutiveZeroCycles: this.store.getConsecutiveZeroCycles(),
      followed,
      dryRun: this.options.dryRun,
    };
  }

  /**
   * Tops up the queue toward `maxPerRun` by sampling `keywordsPerCycle` keywords at a
   * time and searching them, until the queue is full enough or the keyword pool for this
   * cycle is exhausted (an empty sample). Returns how many tweets were scanned and how
   * many new candidates were queued.
   */
  private async fillQueue(): Promise<{ scanned: number; queued: number; skippedUnverified: number }> {
    let scanned = 0;
    let queued = 0;
    let skippedUnverified = 0;
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
            if (!passesVerifiedFilter(tweet.author ?? {}, this.options.allowedVerified)) {
              skippedUnverified++;
              continue;
            }
            const before = this.store.queueSize();
            this.store.enqueue(userName, {
              name: tweet.author?.name,
              keyword,
              verified: authorTiers(tweet.author ?? {}),
            });
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

    return { scanned, queued, skippedUnverified };
  }

  /**
   * Follows up to `maxPerRun` queued candidates. In dry-run, peeks (does not consume the
   * queue) so a later real run still has the candidates. In a real run, dequeues one at a
   * time, follows with a randomized delay between follows, and records each success in the
   * followed-set. A follow failure is logged and the candidate is dropped (not re-queued),
   * so a persistently unfollowable user cannot wedge the queue.
   */
  private async drainQueue(): Promise<{ followed: FollowedCandidate[]; attempted: number }> {
    const toCandidate = (c: {
      userName: string;
      name?: string;
      keyword?: string;
      verified?: string[];
    }): FollowedCandidate => ({
      userName: c.userName,
      name: c.name,
      url: `https://x.com/${c.userName}`,
      keyword: c.keyword,
      // The queue's Candidate keeps verified loosely typed as string[] to stay
      // decoupled from this module; the values are always authorTiers() output.
      verified: c.verified as VerifiedTier[] | undefined,
    });

    if (this.options.dryRun) {
      const targets = this.store.peek(this.options.maxPerRun);
      for (const c of targets) console.log(`[dry-run] would follow @${c.userName}`);
      return { followed: targets.map(toCandidate), attempted: 0 };
    }

    const targets = this.store.dequeue(this.options.maxPerRun);
    const followed: FollowedCandidate[] = [];
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      try {
        if (i > 0) await sleep(this.delayMs());
        await this.follower.follow(c.userName);
        this.store.add(c.userName);
        followed.push(toCandidate(c));
        console.log(`Followed @${c.userName}`);
      } catch (err) {
        console.error(
          `Follow failed for @${c.userName}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    return { followed, attempted: targets.length };
  }
}
