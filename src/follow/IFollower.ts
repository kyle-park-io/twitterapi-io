/** Outcome of a follow attempt that did not throw. */
export type FollowResult = "followed" | "already-following";

/**
 * Follows a single X account by username. Implementations decide the mechanism
 * (browser automation, API, etc.). Idempotent: following an already-followed
 * account must not throw — it returns "already-following". A genuine failure
 * (e.g. the profile never rendered) throws.
 */
export interface IFollower {
  follow(username: string): Promise<FollowResult>;
}
