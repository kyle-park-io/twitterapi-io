import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CleanupRunner, CleanupTarget } from "../CleanupRunner";
import { FollowStore } from "../FollowStore";
import { IFollower, FollowResult, UnfollowResult } from "../../follow/IFollower";

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cr-")), "state.json");
}

function store(): FollowStore {
  const s = new FollowStore(tmpFile());
  s.load();
  return s;
}

function targets(...names: string[]): CleanupTarget[] {
  return names.map((userName) => ({ userName, score: 4, reasons: ["self-declared-kol"] }));
}

class FakeFollower implements IFollower {
  calls: string[] = [];
  constructor(
    private readonly behaviour: Record<string, "unfollowed" | "not-following" | "throw"> = {}
  ) {}
  async follow(): Promise<FollowResult> {
    throw new Error("follow must not be called during cleanup");
  }
  async unfollow(username: string): Promise<UnfollowResult> {
    this.calls.push(username);
    const b = this.behaviour[username] ?? "unfollowed";
    if (b === "throw") throw new Error("boom");
    return b;
  }
}

const noDelay = () => 0;

test("unfollows up to maxPerRun and records each in the blocklist", async () => {
  const f = new FakeFollower();
  const s = store();
  const sum = await new CleanupRunner(f, s, {
    targets: targets("a", "b", "c"),
    maxPerRun: 2,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();

  assert.deepEqual(f.calls, ["a", "b"]);
  assert.equal(sum.unfollowedCount, 2);
  assert.equal(sum.remaining, 1);
  assert.equal(s.wasUnfollowed("a"), true);
  assert.equal(s.wasUnfollowed("b"), true);
  assert.equal(s.wasUnfollowed("c"), false);
});

test("a throwing unfollow does not wedge the run", async () => {
  const f = new FakeFollower({ b: "throw" });
  const s = store();
  const sum = await new CleanupRunner(f, s, {
    targets: targets("a", "b", "c"),
    maxPerRun: 3,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();

  assert.deepEqual(f.calls, ["a", "b", "c"]);
  assert.equal(sum.unfollowedCount, 2);
  assert.equal(sum.failures, 1);
  assert.equal(s.wasUnfollowed("b"), false, "a failed unfollow must not be recorded");
});

test("not-following counts separately and is still blocklisted", async () => {
  const f = new FakeFollower({ a: "not-following" });
  const s = store();
  const sum = await new CleanupRunner(f, s, {
    targets: targets("a"),
    maxPerRun: 5,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();

  assert.equal(sum.notFollowing, 1);
  assert.equal(sum.unfollowedCount, 0);
  assert.equal(
    s.wasUnfollowed("a"),
    true,
    "already-not-following still must never be re-followed"
  );
});

test("dry-run performs no unfollows and no writes", async () => {
  const f = new FakeFollower();
  const s = store();
  const sum = await new CleanupRunner(f, s, {
    targets: targets("a", "b"),
    maxPerRun: 2,
    dryRun: true,
    delayMs: noDelay,
  }).runCycle();

  assert.deepEqual(f.calls, []);
  assert.equal(sum.unfollowedCount, 0);
  assert.equal(sum.wouldUnfollow.length, 2);
  assert.equal(sum.unfollowed.length, 0);
  assert.equal(s.unfollowedCount(), 0);
});

test("an empty target list is a no-op, not an error", async () => {
  const sum = await new CleanupRunner(new FakeFollower(), store(), {
    targets: [],
    maxPerRun: 5,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();
  assert.equal(sum.attempted, 0);
  assert.equal(sum.remaining, 0);
});
