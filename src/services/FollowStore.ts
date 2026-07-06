import * as fs from "fs";
import * as path from "path";

export interface Candidate {
  userName: string;
  name?: string;
  keyword?: string;
}

interface FollowStoreData {
  followed: string[];
  queue: Array<string | Candidate>;
  lastRun: string | null;
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
    } catch {
      this.followed = new Set();
      this.queue = [];
      this.queuedKeys = new Set();
      this.lastRun = null;
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
  enqueue(username: string, meta?: { name?: string; keyword?: string }): void {
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

  save(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data: FollowStoreData = {
      followed: [...this.followed],
      queue: [...this.queue],
      lastRun: this.lastRun ? this.lastRun.toISOString() : null,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}
