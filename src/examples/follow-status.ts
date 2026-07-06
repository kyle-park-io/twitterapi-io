/// <reference types="node" />
// ^ ts-node compiles this entry file standalone; unlike the other examples it
// doesn't import "../config" (which pulls in dotenv → @types/node) first, so
// without this reference ts-node fails to resolve Node's fs/path/process/console
// types. follow-status must stay env-free (local files only), so we reference the
// node types directly instead of importing config for its side effect.
import { FollowStore } from "../services/FollowStore";
import { isUnhealthy } from "../services/AutoFollowRunner";
import * as fs from "fs";
import * as path from "path";

/**
 * At-a-glance health check for the auto-follow tool. Reads only local files
 * (state + config + JSONL log) — no API call, no env vars — so it's always safe
 * to run:  pnpm follow-status
 */
function ago(date: Date | null): string {
  if (!date) return "never";
  const ms = Date.now() - date.getTime();
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function readThreshold(): number {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "config", "auto-follow.json"), "utf8")
    );
    return typeof cfg.unhealthyAfterZeroCycles === "number" ? cfg.unhealthyAfterZeroCycles : 2;
  } catch {
    return 2;
  }
}

function recentAdded(n: number): number[] {
  try {
    const lines = fs
      .readFileSync(path.join(process.cwd(), "output", "auto-follow-log.jsonl"), "utf8")
      .trim()
      .split("\n");
    const cycles = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.type === "cycle");
    return cycles.slice(-n).map((r) => r.addedCount ?? 0);
  } catch {
    return [];
  }
}

function main() {
  const statePath = path.join(process.cwd(), ".auth", "auto-follow-state.json");
  if (!fs.existsSync(statePath)) {
    console.log("No state yet — has the tool run? (expected " + statePath + ")");
    return;
  }

  const store = new FollowStore(statePath);
  store.load();
  const threshold = readThreshold();
  const zero = store.getConsecutiveZeroCycles();
  const unhealthy = isUnhealthy(zero, threshold);

  const recent = recentAdded(6);
  const spark = recent.length ? recent.map((n) => `+${n}`).join(" ") : "(no log yet)";

  console.log(`Auto-follow status: ${unhealthy ? "⚠️ UNHEALTHY" : "✅ HEALTHY"}`);
  console.log(`  Last run:        ${store.getLastRun()?.toISOString() ?? "never"} (${ago(store.getLastRun())})`);
  console.log(`  Last success:    ${store.getLastSuccessAt()?.toISOString() ?? "never"} (${ago(store.getLastSuccessAt())})`);
  console.log(`  Consecutive zero-follow cycles: ${zero} (threshold ${threshold})`);
  console.log(`  Followed (local): ${store.followedCount()}    Queue: ${store.queueSize()}`);
  console.log(`  Recent cycles (added): ${spark}`);
}

main();
