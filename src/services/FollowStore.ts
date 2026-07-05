import * as fs from "fs";
import * as path from "path";

interface FollowStoreData {
  followed: string[];
  lastRun: string | null;
}

export class FollowStore {
  private followed = new Set<string>();
  private lastRun: Date | null = null;

  constructor(private readonly filePath: string) {}

  load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as FollowStoreData;
      this.followed = new Set((data.followed ?? []).map((u) => u.toLowerCase()));
      this.lastRun = data.lastRun ? new Date(data.lastRun) : null;
    } catch {
      this.followed = new Set();
      this.lastRun = null;
    }
  }

  has(username: string): boolean {
    return this.followed.has(username.toLowerCase());
  }

  add(username: string): void {
    this.followed.add(username.toLowerCase());
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
      lastRun: this.lastRun ? this.lastRun.toISOString() : null,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}
