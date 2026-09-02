/**
 * Detection of X's account-based follow cap (help.x.com/en/using-x/x-follow-limit).
 *
 * Past ~5,000 total follows, X caps how many accounts you can follow at a
 * per-account number derived from your follower/following ratio. Beyond that
 * cap the browser Follow click still appears to succeed (the button flips),
 * but the follow is silently dropped server-side — so the only reliable signal
 * is the account's ACTUAL following count no longer rising while the tool keeps
 * recording successes.
 */

/** Cycles that followed fewer than this give too weak a signal to judge. */
export const CAP_MIN_ADDED = 5;
/** Under this fraction of a cycle's follows landing, the cycle counts as stalled. */
export const CAP_LAND_RATIO = 0.5;
/** Consecutive stalled cycles before declaring the cap reached. */
export const CAP_STALL_THRESHOLD = 2;

export interface CapCheckInput {
  /** Follows the tool recorded as successful this cycle. */
  addedThisCycle: number;
  /** Actual following count observed after the previous cycle (null = no baseline yet). */
  prevActual: number | null;
  /** Actual following count observed just now. */
  actual: number;
  /** Consecutive-stalled-cycles counter carried in from previous cycles. */
  stallCycles: number;
}

export interface CapCheckResult {
  /** Updated consecutive-stalled-cycles counter to persist. */
  stallCycles: number;
  /** True when this cycle stalled and the counter has reached CAP_STALL_THRESHOLD. */
  capReached: boolean;
}

export function checkCapStall(input: CapCheckInput): CapCheckResult {
  const { addedThisCycle, prevActual, actual, stallCycles } = input;
  // No baseline, or too few follows to judge — carry the counter unchanged.
  // (Manual follows/unfollows add noise; CAP_MIN_ADDED keeps tiny cycles out.)
  if (prevActual === null || addedThisCycle < CAP_MIN_ADDED) {
    return { stallCycles, capReached: false };
  }
  const landed = actual - prevActual; // may be negative (manual unfollows, churn)
  const stalled = landed < addedThisCycle * CAP_LAND_RATIO;
  const next = stalled ? stallCycles + 1 : 0;
  return { stallCycles: next, capReached: stalled && next >= CAP_STALL_THRESHOLD };
}
