import { IFollower } from "../follow/IFollower";
import { FollowStore } from "./FollowStore";
import { scoreAccount, fromSearchAuthor } from "../follow/scoring";

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
    description?: string | null;
    followers?: number;
    following?: number;
    statusesCount?: number;
    profilePicture?: string | null;
    coverPicture?: string | null;
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
  /** Follower-count ceiling; candidates above this are rejected before enqueueing. */
  maxFollowers: number;
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
  /** Candidates already followed (no-op skip); 0 in dry-run. */
  alreadyFollowing: number;
  /** Follows that actually threw (attempted minus new follows minus already-following); 0 in dry-run. */
  followFailures: number;
  /** consecutiveZeroCycles value AFTER this cycle. */
  consecutiveZeroCycles: number;
  /** Candidates rejected by the verified filter this cycle. */
  skippedUnverified: number;
  /** Candidates rejected by the cleanup scoring function (score > 0) this cycle. */
  skippedScored: number;
  /** Candidates rejected for exceeding the follower ceiling this cycle. */
  skippedTooBig: number;
  /** Followed candidates with metadata (real runs only; empty in dry-run). */
  followed: FollowedCandidate[];
  /** Candidates a dry-run would have followed. Empty in a real run. */
  wouldFollow: FollowedCandidate[];
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
    const { followed, wouldFollow, attempted, alreadyFollowing } = await this.drainQueue();
    const followedCountAfter = this.store.followedCount();
    const finished = this.now();

    // Health assessment (real runs only). "Attempted but followed 0" is a
    // symptom; a cycle with nothing to attempt is not a failure.
    if (!this.options.dryRun) {
      if (followed.length > 0 || alreadyFollowing > 0) {
        // A real follow landed, or we confirmed existing follows — session works.
        this.store.setConsecutiveZeroCycles(0);
        this.store.setLastSuccessAt(finished);
      } else if (attempted > 0) {
        // Attempted follows and every one threw.
        this.store.setConsecutiveZeroCycles(this.store.getConsecutiveZeroCycles() + 1);
      }
      // attempted === 0 → nothing to do → leave counters untouched.
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
      skippedScored: fill.skippedScored,
      skippedTooBig: fill.skippedTooBig,
      followedCountBefore,
      followedCountAfter,
      addedCount: this.options.dryRun ? 0 : followed.length,
      attempted,
      alreadyFollowing: this.options.dryRun ? 0 : alreadyFollowing,
      followFailures: this.options.dryRun ? 0 : attempted - followed.length - alreadyFollowing,
      consecutiveZeroCycles: this.store.getConsecutiveZeroCycles(),
      followed,
      wouldFollow,
      dryRun: this.options.dryRun,
    };
  }

  /**
   * Tops up the queue toward `maxPerRun` by sampling `keywordsPerCycle` keywords at a
   * time and searching them, until the queue is full enough or the keyword pool for this
   * cycle is exhausted (an empty sample). Returns how many tweets were scanned and how
   * many new candidates were queued.
   */
  private async fillQueue(): Promise<{
    scanned: number;
    queued: number;
    skippedUnverified: number;
    skippedScored: number;
    skippedTooBig: number;
  }> {
    let scanned = 0;
    let queued = 0;
    let skippedUnverified = 0;
    let skippedScored = 0;
    let skippedTooBig = 0;
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
            // userName was read from tweet.author above, so it must be defined here.
            const author = tweet.author!;
            if (scoreAccount(fromSearchAuthor(author)).score > 0) {
              skippedScored++;
              continue;
            }
            if ((author.followers ?? 0) > this.options.maxFollowers) {
              skippedTooBig++;
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

    return { scanned, queued, skippedUnverified, skippedScored, skippedTooBig };
  }

  /**
   * Follows up to `maxPerRun` queued candidates. In dry-run, peeks (does not consume the
   * queue) so a later real run still has the candidates. In a real run, dequeues one at a
   * time, follows with a randomized delay between follows, and records each success in the
   * followed-set. A follow failure is logged and the candidate is dropped (not re-queued),
   * so a persistently unfollowable user cannot wedge the queue.
   */
  private async drainQueue(): Promise<{
    followed: FollowedCandidate[];
    wouldFollow: FollowedCandidate[];
    attempted: number;
    alreadyFollowing: number;
  }> {
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
      const targets = this.withoutUnfollowed(this.store.peek(this.options.maxPerRun));
      for (const c of targets) console.log(`[dry-run] would follow @${c.userName}`);
      return {
        followed: [],
        wouldFollow: targets.map(toCandidate),
        attempted: 0,
        alreadyFollowing: 0,
      };
    }

    // A separate cleanup process may have unfollowed accounts that were queued
    // before it ran, so re-read the blocklist from disk before touching the
    // queue rather than trusting a snapshot taken when this process started.
    this.store.refreshUnfollowed();
    const targets = this.withoutUnfollowed(this.store.dequeue(this.options.maxPerRun));
    const followed: FollowedCandidate[] = [];
    let alreadyFollowing = 0;
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      try {
        if (i > 0) await sleep(this.delayMs());
        const result = await this.follower.follow(c.userName);
        this.store.add(c.userName);
        if (result === "followed") {
          followed.push(toCandidate(c));
          console.log(`Followed @${c.userName}`);
        } else {
          alreadyFollowing++;
          console.log(`Already following @${c.userName}`);
        }
      } catch (err) {
        console.error(
          `Follow failed for @${c.userName}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    return { followed, wouldFollow: [], attempted: targets.length, alreadyFollowing };
  }

  /**
   * Last line of defence before a follow: drop anything on the unfollow
   * blocklist. The store already refuses to enqueue or restore such handles,
   * but re-following an account we unfollowed is the one mistake that cannot be
   * undone — X treats follow/unfollow churn as spam — so the drain point checks
   * again on candidates that are already in hand.
   */
  private withoutUnfollowed<T extends { userName: string }>(candidates: T[]): T[] {
    return candidates.filter((c) => {
      if (!this.store.wasUnfollowed(c.userName)) return true;
      console.warn(`Skipping @${c.userName} — previously unfollowed, must never be re-followed`);
      return false;
    });
  }
}
