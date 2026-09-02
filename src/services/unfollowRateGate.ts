/**
 * The unfollow rate ceiling from the cleanup design: at most `perDay` unfollows
 * in any trailing 24 h, and at most one `--run` invocation per hour.
 *
 * `unfollowPerRun` only caps a single invocation, so nothing stopped back-to-back
 * invocations from doing ~67 unfollows/hour against a design ceiling of 8–10.
 * The account has no measured-safe unfollow rate the way it has one for follows,
 * so the ceiling is enforced here rather than left to whoever types the command.
 */

/** One invocation per hour, with 5 minutes of slack so an hourly cron never trips it. */
export const MIN_RUN_SPACING_MS = 55 * 60 * 1000;

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface UnfollowRateGateInput {
  /** Unfollow timestamps, any order; only the trailing 24 h matter. */
  history: Date[];
  /** Ceiling on unfollows per trailing 24 h (`unfollowPerDay`). */
  perDay: number;
  now: Date;
}

export type UnfollowRateGate =
  | { allowed: true }
  | { allowed: false; reason: string; nextAllowedAt: Date };

/**
 * Decide whether a real (non-dry-run) cleanup invocation may proceed.
 * Dry runs must stay freely repeatable and never call this.
 */
export function checkUnfollowRate(input: UnfollowRateGateInput): UnfollowRateGate {
  const nowMs = input.now.getTime();
  const window = input.history
    .filter((d) => d.getTime() > nowMs - DAY_MS)
    .sort((a, b) => a.getTime() - b.getTime());

  if (window.length >= input.perDay) {
    // The window drops back below the ceiling once the oldest surplus entry
    // ages out of the trailing 24 h.
    const oldestSurplus = window[window.length - input.perDay];
    return {
      allowed: false,
      reason:
        `Daily unfollow ceiling reached: ${window.length} unfollows in the last 24h ` +
        `(limit ${input.perDay}).`,
      nextAllowedAt: new Date(oldestSurplus.getTime() + DAY_MS),
    };
  }

  const last = window[window.length - 1] ?? maxDate(input.history);
  if (last && nowMs - last.getTime() < MIN_RUN_SPACING_MS) {
    return {
      allowed: false,
      reason:
        `Last unfollow was ${Math.round((nowMs - last.getTime()) / 60000)} minutes ago; ` +
        `cleanup runs at most once an hour.`,
      nextAllowedAt: new Date(last.getTime() + MIN_RUN_SPACING_MS),
    };
  }

  return { allowed: true };
}

function maxDate(dates: Date[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) if (!best || d.getTime() > best.getTime()) best = d;
  return best;
}
