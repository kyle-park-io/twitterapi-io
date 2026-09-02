import { IFollower } from "../follow/IFollower";
import { FollowStore } from "./FollowStore";

export interface CleanupTarget {
  userName: string;
  score: number;
  reasons: string[];
}

export interface CleanupRunnerOptions {
  /** Targets to unfollow, highest score first. Consumed from the front. */
  targets: CleanupTarget[];
  /** Max unfollows this cycle. */
  maxPerRun: number;
  dryRun: boolean;
  /** Injectable for tests; production uses the randomised 30–90 s delay. */
  delayMs?: () => number;
}

export interface CleanupSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  attempted: number;
  unfollowedCount: number;
  notFollowing: number;
  failures: number;
  /** Targets left over after this cycle. */
  remaining: number;
  unfollowed: CleanupTarget[];
  wouldUnfollow: CleanupTarget[];
  dryRun: boolean;
}

function randomDelayMs(): number {
  return 30000 + Math.floor(Math.random() * 60001); // 30000–90000
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CleanupRunner {
  constructor(
    private readonly follower: IFollower,
    private readonly store: FollowStore,
    private readonly options: CleanupRunnerOptions
  ) {}

  private delay(): number {
    return this.options.delayMs ? this.options.delayMs() : randomDelayMs();
  }

  async runCycle(): Promise<CleanupSummary> {
    const startedAt = new Date();
    const batch = this.options.targets.slice(0, this.options.maxPerRun);
    const remaining = Math.max(0, this.options.targets.length - batch.length);

    if (this.options.dryRun) {
      for (const t of batch) {
        console.log(
          `[dry-run] would unfollow @${t.userName} (score ${t.score}: ${t.reasons.join(", ")})`
        );
      }
      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        attempted: 0,
        unfollowedCount: 0,
        notFollowing: 0,
        failures: 0,
        remaining,
        unfollowed: [],
        wouldUnfollow: batch,
        dryRun: true,
      };
    }

    const unfollowed: CleanupTarget[] = [];
    let notFollowing = 0;
    let failures = 0;

    for (let i = 0; i < batch.length; i++) {
      const t = batch[i];
      try {
        if (i > 0) await sleep(this.delay());
        const result = await this.follower.unfollow(t.userName);
        // Recorded on both outcomes: "not-following" still means this account
        // must never be re-followed.
        this.store.markUnfollowed(t.userName);
        this.store.remove(t.userName);
        if (result === "unfollowed") {
          unfollowed.push(t);
          console.log(`Unfollowed @${t.userName} (score ${t.score}: ${t.reasons.join(", ")})`);
        } else {
          notFollowing++;
          console.log(`Not following @${t.userName} — recorded anyway`);
        }
      } catch (err) {
        // A failed unfollow is NOT blocklisted: we may still be following them,
        // and the target stays eligible for a later cycle.
        failures++;
        console.error(
          `Unfollow failed for @${t.userName}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    this.store.save();
    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      attempted: batch.length,
      unfollowedCount: unfollowed.length,
      notFollowing,
      failures,
      remaining,
      unfollowed,
      wouldUnfollow: [],
      dryRun: false,
    };
  }
}
