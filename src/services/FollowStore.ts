import * as fs from "fs";
import * as path from "path";

interface FollowStoreData {
  followed: string[];
  queue: string[];
  lastRun: string | null;
}

export class FollowStore {
  private followed = new Set<string>();
  /** Pending candidates to follow, in FIFO order. Stored as-typed; deduped via queuedKeys. */
  private queue: string[] = [];
  private queuedKeys = new Set<string>();
  private lastRun: Date | null = null;

  constructor(private readonly filePath: string) {}

  load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as FollowStoreData;
      this.followed = new Set((data.followed ?? []).map((u) => u.toLowerCase()));
      this.queue = [...(data.queue ?? [])];
      this.queuedKeys = new Set(this.queue.map((u) => u.toLowerCase()));
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

  /** Queue a candidate to follow later. Skips users already followed or already queued. */
  enqueue(username: string): void {
    const key = username.toLowerCase();
    if (this.followed.has(key) || this.queuedKeys.has(key)) return;
    this.queue.push(username);
    this.queuedKeys.add(key);
  }

  isQueued(username: string): boolean {
    return this.queuedKeys.has(username.toLowerCase());
  }

  queueSize(): number {
    return this.queue.length;
  }

  /** Remove and return up to `n` queued usernames in FIFO order. */
  dequeue(n: number): string[] {
    const taken = this.queue.splice(0, n);
    for (const u of taken) this.queuedKeys.delete(u.toLowerCase());
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
