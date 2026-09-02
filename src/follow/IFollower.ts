/** Outcome of a follow attempt that did not throw. */
export type FollowResult = "followed" | "already-following";

/** Outcome of an unfollow attempt that did not throw. */
export type UnfollowResult = "unfollowed" | "not-following";

/**
 * Follows a single X account by username. Implementations decide the mechanism
 * (browser automation, API, etc.). Idempotent: following an already-followed
 * account must not throw — it returns "already-following". A genuine failure
 * (e.g. the profile never rendered) throws.
 */
export interface IFollower {
  follow(username: string): Promise<FollowResult>;

  /**
   * Unfollows a single X account by username. Idempotent in the same way
   * `follow` is: unfollowing someone not currently followed returns
   * "not-following" rather than throwing. A genuine failure (the profile never
   * rendered) throws.
   */
  unfollow(username: string): Promise<UnfollowResult>;
}
