import * as fs from "fs";
import * as path from "path";

export interface Candidate {
  userName: string;
  name?: string;
  keyword?: string;
  verified?: string[];
}

interface FollowStoreData {
  followed: string[];
  queue: Array<string | Candidate>;
  lastRun: string | null;
  lastSuccessAt?: string | null;
  consecutiveZeroCycles?: number;
  lastFollowingSyncAt?: string | null;
  lastActualFollowingCount?: number | null;
  capStallCycles?: number;
  capDetectedAt?: string | null;
  capActualCount?: number | null;
  unfollowed?: string[];
  unfollowRunAt?: string[];
}

/**
 * How much unfollow history is kept. Only the trailing 24 h is ever read (the
 * daily-rate gate), so 48 h is a generous margin that still bounds the list —
 * without pruning it would grow one entry per unfollow forever.
 */
const UNFOLLOW_HISTORY_MS = 48 * 60 * 60 * 1000;

function normalizeCandidate(item: string | Candidate): Candidate | null {
  if (typeof item === "string") return { userName: item };
  if (item && typeof item.userName === "string") return item;
  return null; // malformed entry — skip, don't crash
}

/**
 * Drop timestamps older than the retention window (and any unparseable entry),
 * returning the rest in ascending order. ISO-8601 UTC strings sort
 * chronologically as plain strings, so a lexical sort is the chronological one.
 */
function pruneTimestamps(raw: string[]): string[] {
  const cutoff = Date.now() - UNFOLLOW_HISTORY_MS;
  const kept = raw.filter((iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= cutoff;
  });
  return [...new Set(kept)].sort();
}

export class FollowStore {
  private followed = new Set<string>();
  /** Pending candidates to follow, in FIFO order. Deduped via queuedKeys. */
  private queue: Candidate[] = [];
  private queuedKeys = new Set<string>();
  private lastRun: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private consecutiveZeroCycles = 0;
  private lastFollowingSyncAt: Date | null = null;
  private lastActualFollowingCount: number | null = null;
  private capStallCycles = 0;
  private capDetectedAt: Date | null = null;
  private capActualCount: number | null = null;
  /**
   * Handles we have unfollowed. Append-only and never cleared — X prohibits
   * re-following an account you unfollowed, so this set permanently excludes
   * them from the candidate queue.
   */
  private unfollowed = new Set<string>();
  /**
   * ISO timestamps of unfollows performed, ascending, pruned to the trailing
   * UNFOLLOW_HISTORY_MS. Backs the per-day / per-hour unfollow rate ceiling.
   */
  private unfollowRunAt: string[] = [];

  constructor(private readonly filePath: string) {}

  load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch (err) {
      // A missing file is the first-run case: start empty. Anything else (a
      // permission error, a directory in the way) means a state file may well
      // exist and we simply cannot see it — resetting to empty here would let
      // the next save() overwrite thousands of real follow records with {}.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.reset();
        return;
      }
      throw err;
    }

    let data: FollowStoreData;
    try {
      data = JSON.parse(raw) as FollowStoreData;
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("not a JSON object");
      }
    } catch (err) {
      // The file exists but is unreadable as state. Failing loudly is the whole
      // point: the old behaviour reset to empty state, and the next save()
      // silently replaced the real followed-set and the permanent unfollow
      // blocklist with nothing.
      throw new Error(
        `${this.filePath} exists but could not be parsed as state ` +
          `(${err instanceof Error ? err.message : String(err)}). ` +
          `Refusing to start from empty state — inspect or move the file first.`
      );
    }

    this.followed = new Set((data.followed ?? []).map((u) => u.toLowerCase()));
    // The blocklist must be populated BEFORE the queue is filtered below.
    this.unfollowed = new Set((data.unfollowed ?? []).map((u) => u.toLowerCase()));
    this.queue = (data.queue ?? [])
      .map(normalizeCandidate)
      .filter((c): c is Candidate => c !== null);
    this.queuedKeys = new Set(this.queue.map((c) => c.userName.toLowerCase()));
    // A state file written by an older process can still hold handles that have
    // since been unfollowed; restoring them would re-follow them next cycle.
    this.purgeUnfollowedFromQueue();
    this.lastRun = data.lastRun ? new Date(data.lastRun) : null;
    this.lastSuccessAt = data.lastSuccessAt ? new Date(data.lastSuccessAt) : null;
    this.consecutiveZeroCycles = data.consecutiveZeroCycles ?? 0;
    this.lastFollowingSyncAt = data.lastFollowingSyncAt
      ? new Date(data.lastFollowingSyncAt)
      : null;
    this.lastActualFollowingCount = data.lastActualFollowingCount ?? null;
    this.capStallCycles = data.capStallCycles ?? 0;
    this.capDetectedAt = data.capDetectedAt ? new Date(data.capDetectedAt) : null;
    this.capActualCount = data.capActualCount ?? null;
    this.unfollowRunAt = pruneTimestamps(data.unfollowRunAt ?? []);
  }

  private reset(): void {
    this.followed = new Set();
    this.queue = [];
    this.queuedKeys = new Set();
    this.lastRun = null;
    this.lastSuccessAt = null;
    this.consecutiveZeroCycles = 0;
    this.lastFollowingSyncAt = null;
    this.lastActualFollowingCount = null;
    this.capStallCycles = 0;
    this.capDetectedAt = null;
    this.capActualCount = null;
    this.unfollowed = new Set();
    this.unfollowRunAt = [];
  }

  /** Drop every queued candidate that is on the unfollow blocklist. */
  private purgeUnfollowedFromQueue(): void {
    const kept = this.queue.filter((c) => !this.unfollowed.has(c.userName.toLowerCase()));
    if (kept.length === this.queue.length) return;
    this.queue = kept;
    this.queuedKeys = new Set(kept.map((c) => c.userName.toLowerCase()));
  }

  has(username: string): boolean {
    return this.followed.has(username.toLowerCase());
  }

  add(username: string): void {
    this.followed.add(username.toLowerCase());
  }

  /**
   * Remove a user from the followed-set — either because a follow X silently
   * dropped, or because we have just unfollowed them for real (the cleanup
   * runner calls this alongside markUnfollowed).
   */
  remove(username: string): void {
    this.followed.delete(username.toLowerCase());
  }

  followedCount(): number {
    return this.followed.size;
  }

  /**
   * Record a handle as unfollowed. Permanent — never removed — and it also
   * evicts the handle from the pending queue, because a handle queued before
   * the unfollow would otherwise be followed again on the very next cycle.
   */
  markUnfollowed(username: string): void {
    this.unfollowed.add(username.toLowerCase());
    this.purgeUnfollowedFromQueue();
  }

  wasUnfollowed(username: string): boolean {
    return this.unfollowed.has(username.toLowerCase());
  }

  unfollowedCount(): number {
    return this.unfollowed.size;
  }

  /**
   * Record that one unfollow happened. Separate from markUnfollowed so the
   * blocklist stays a pure set: this list is the rate accounting behind
   * `unfollowPerDay` and the one-run-per-hour spacing.
   */
  recordUnfollow(at: Date = new Date()): void {
    // Histories are merged across processes as a set of ISO strings, so two
    // unfollows sharing a millisecond would collapse into one and under-count
    // against the daily ceiling. Nudge a colliding stamp forward instead.
    let iso = at.toISOString();
    while (this.unfollowRunAt.includes(iso)) {
      iso = new Date(Date.parse(iso) + 1).toISOString();
    }
    this.unfollowRunAt = pruneTimestamps([...this.unfollowRunAt, iso]);
  }

  /** Unfollows recorded at or after `since`, ascending. */
  unfollowsSince(since: Date): Date[] {
    const from = since.getTime();
    return this.unfollowRunAt.map((iso) => new Date(iso)).filter((d) => d.getTime() >= from);
  }

  /** When the most recent recorded unfollow happened, or null if there is none. */
  lastUnfollowAt(): Date | null {
    const last = this.unfollowRunAt[this.unfollowRunAt.length - 1];
    return last ? new Date(last) : null;
  }

  /**
   * Re-read the append-only fields (blocklist + unfollow history) from disk and
   * fold them into memory, dropping any queued handle that has since been
   * unfollowed. Cheap, best-effort, and safe to call before a follow batch:
   * a separate cleanup process may have unfollowed accounts this process still
   * has queued from before it loaded.
   */
  refreshUnfollowed(): void {
    this.mergePersistedAppendOnly();
  }

  /** Queue a candidate to follow later. Skips users already followed, already queued, or unfollowed. */
  enqueue(
    username: string,
    meta?: { name?: string; keyword?: string; verified?: string[] }
  ): void {
    const key = username.toLowerCase();
    if (this.followed.has(key) || this.queuedKeys.has(key) || this.unfollowed.has(key)) return;
    this.queue.push({ userName: username, ...meta });
    this.queuedKeys.add(key);
  }

  isQueued(username: string): boolean {
    return this.queuedKeys.has(username.toLowerCase());
  }

  queueSize(): number {
    return this.queue.length;
  }

  /** Return up to `n` queued candidates in FIFO order WITHOUT removing them. */
  peek(n: number): Candidate[] {
    return this.queue.slice(0, n);
  }

  /** Remove and return up to `n` queued candidates in FIFO order. */
  dequeue(n: number): Candidate[] {
    const taken = this.queue.splice(0, n);
    for (const c of taken) this.queuedKeys.delete(c.userName.toLowerCase());
    return taken;
  }

  getLastRun(): Date | null {
    return this.lastRun;
  }

  setLastRun(date: Date): void {
    this.lastRun = date;
  }

  getLastSuccessAt(): Date | null {
    return this.lastSuccessAt;
  }

  setLastSuccessAt(date: Date): void {
    this.lastSuccessAt = date;
  }

  getConsecutiveZeroCycles(): number {
    return this.consecutiveZeroCycles;
  }

  setConsecutiveZeroCycles(n: number): void {
    this.consecutiveZeroCycles = n;
  }

  getLastFollowingSyncAt(): Date | null {
    return this.lastFollowingSyncAt;
  }

  setLastFollowingSyncAt(date: Date): void {
    this.lastFollowingSyncAt = date;
  }

  getLastActualFollowingCount(): number | null {
    return this.lastActualFollowingCount;
  }

  setLastActualFollowingCount(n: number | null): void {
    this.lastActualFollowingCount = n;
  }

  getCapStallCycles(): number {
    return this.capStallCycles;
  }

  setCapStallCycles(n: number): void {
    this.capStallCycles = n;
  }

  getCapDetectedAt(): Date | null {
    return this.capDetectedAt;
  }

  setCapDetectedAt(date: Date | null): void {
    this.capDetectedAt = date;
  }

  getCapActualCount(): number | null {
    return this.capActualCount;
  }

  setCapActualCount(n: number | null): void {
    this.capActualCount = n;
  }

  /**
   * Fold the on-disk append-only fields into memory. Best-effort by design:
   * this runs on the save path, where a missing or unreadable file must not
   * stop us persisting the state we do have.
   */
  private mergePersistedAppendOnly(): void {
    let data: FollowStoreData;
    try {
      data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as FollowStoreData;
      if (data === null || typeof data !== "object" || Array.isArray(data)) return;
    } catch {
      return;
    }
    for (const u of data.unfollowed ?? []) this.unfollowed.add(u.toLowerCase());
    this.purgeUnfollowedFromQueue();
    this.unfollowRunAt = pruneTimestamps([...this.unfollowRunAt, ...(data.unfollowRunAt ?? [])]);
  }

  save(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    // save() rewrites the whole file from an in-memory snapshot, so a process
    // that load()ed hours ago would erase anything written since. For the
    // append-only fields that is not survivable: the unfollow blocklist is the
    // only thing stopping an unfollowed account from being followed again, and
    // re-following is exactly the pattern X bans. Union them back in first so
    // "append-only" holds across processes, not just within one.
    this.mergePersistedAppendOnly();
    const data: FollowStoreData = {
      followed: [...this.followed],
      queue: [...this.queue],
      lastRun: this.lastRun ? this.lastRun.toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? this.lastSuccessAt.toISOString() : null,
      consecutiveZeroCycles: this.consecutiveZeroCycles,
      lastFollowingSyncAt: this.lastFollowingSyncAt
        ? this.lastFollowingSyncAt.toISOString()
        : null,
      lastActualFollowingCount: this.lastActualFollowingCount,
      capStallCycles: this.capStallCycles,
      capDetectedAt: this.capDetectedAt ? this.capDetectedAt.toISOString() : null,
      capActualCount: this.capActualCount,
      unfollowed: [...this.unfollowed],
      unfollowRunAt: [...this.unfollowRunAt],
    };
    // Write-then-rename: a crash or a full disk mid-write leaves the previous
    // state file intact rather than a truncated one, which load() now (rightly)
    // refuses to start from.
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup; the original error is what matters.
      }
      throw err;
    }
  }
}
