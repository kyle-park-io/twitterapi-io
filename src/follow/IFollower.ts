/**
 * Follows a single X account by username. Implementations decide the mechanism
 * (browser automation, API, etc.). Idempotent: following an already-followed
 * account must not throw.
 */
export interface IFollower {
  follow(username: string): Promise<void>;
}
