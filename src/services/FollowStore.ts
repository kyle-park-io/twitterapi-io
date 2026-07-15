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
}

function normalizeCandidate(item: string | Candidate): Candidate | null {
  if (typeof item === "string") return { userName: item };
  if (item && typeof item.userName === "string") return item;
  return null; // malformed entry — skip, don't crash
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

  constructor(private readonly filePath: string) {}

  load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as FollowStoreData;
      this.followed = new Set((data.followed ?? []).map((u) => u.toLowerCase()));
      this.queue = (data.queue ?? [])
        .map(normalizeCandidate)
        .filter((c): c is Candidate => c !== null);
      this.queuedKeys = new Set(this.queue.map((c) => c.userName.toLowerCase()));
      this.lastRun = data.lastRun ? new Date(data.lastRun) : null;
      this.lastSuccessAt = data.lastSuccessAt ? new Date(data.lastSuccessAt) : null;
      this.consecutiveZeroCycles = data.consecutiveZeroCycles ?? 0;
      this.lastFollowingSyncAt = data.lastFollowingSyncAt
        ? new Date(data.lastFollowingSyncAt)
        : null;
    } catch {
      this.followed = new Set();
      this.queue = [];
      this.queuedKeys = new Set();
      this.lastRun = null;
      this.lastSuccessAt = null;
      this.consecutiveZeroCycles = 0;
      this.lastFollowingSyncAt = null;
    }
  }

  has(username: string): boolean {
    return this.followed.has(username.toLowerCase());
  }

  add(username: string): void {
    this.followed.add(username.toLowerCase());
  }

  followedCount(): number {
    return this.followed.size;
  }

  /** Queue a candidate to follow later. Skips users already followed or already queued. */
  enqueue(
    username: string,
    meta?: { name?: string; keyword?: string; verified?: string[] }
  ): void {
    const key = username.toLowerCase();
    if (this.followed.has(key) || this.queuedKeys.has(key)) return;
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

  save(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data: FollowStoreData = {
      followed: [...this.followed],
      queue: [...this.queue],
      lastRun: this.lastRun ? this.lastRun.toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? this.lastSuccessAt.toISOString() : null,
      consecutiveZeroCycles: this.consecutiveZeroCycles,
      lastFollowingSyncAt: this.lastFollowingSyncAt
        ? this.lastFollowingSyncAt.toISOString()
        : null,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}
