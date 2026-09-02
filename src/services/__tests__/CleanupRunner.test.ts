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

/** Counts save() calls while still writing the real file. */
class SpyStore extends FollowStore {
  saves = 0;
  override save(): void {
    this.saves++;
    super.save();
  }
}

function spyStore(): SpyStore {
  const s = new SpyStore(tmpFile());
  s.load();
  return s;
}

test("saves after every unfollow, not once at the end of the cycle", async () => {
  const s = spyStore();
  await new CleanupRunner(new FakeFollower(), s, {
    targets: targets("a", "b", "c"),
    maxPerRun: 3,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();

  assert.equal(s.saves, 3, "one durable write per irreversible unfollow");
});

test("each unfollow is on disk before the next one starts", async () => {
  const file = tmpFile();
  const s = new FollowStore(file);
  s.load();

  // Read the state file at the top of every unfollow: an interrupt at this point
  // must already find the previous unfollows recorded.
  const seen: string[][] = [];
  const follower: IFollower = {
    async follow(): Promise<FollowResult> {
      throw new Error("follow must not be called during cleanup");
    },
    async unfollow(): Promise<UnfollowResult> {
      const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : '{"unfollowed":[]}';
      seen.push((JSON.parse(raw) as { unfollowed?: string[] }).unfollowed ?? []);
      return "unfollowed";
    },
  };

  await new CleanupRunner(follower, s, {
    targets: targets("a", "b", "c"),
    maxPerRun: 3,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();

  assert.deepEqual(seen, [[], ["a"], ["a", "b"]]);
  const final = JSON.parse(fs.readFileSync(file, "utf8")) as { unfollowed?: string[] };
  assert.deepEqual(final.unfollowed, ["a", "b", "c"]);
});

test("a failed unfollow is neither recorded nor counted against the rate ceiling", async () => {
  const s = spyStore();
  await new CleanupRunner(new FakeFollower({ a: "throw" }), s, {
    targets: targets("a", "b"),
    maxPerRun: 2,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();

  assert.equal(s.saves, 1);
  assert.equal(s.unfollowsSince(new Date(0)).length, 1);
});

test("each unfollow records a timestamp for the rate ceiling", async () => {
  const s = store();
  const before = Date.now();
  await new CleanupRunner(new FakeFollower({ b: "not-following" }), s, {
    targets: targets("a", "b"),
    maxPerRun: 2,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();

  const stamps = s.unfollowsSince(new Date(before - 1000));
  // "not-following" counts too: it still consumed an unfollow interaction with X.
  assert.equal(stamps.length, 2);
});

test("dry-run neither saves nor records timestamps", async () => {
  const s = spyStore();
  await new CleanupRunner(new FakeFollower(), s, {
    targets: targets("a", "b"),
    maxPerRun: 2,
    dryRun: true,
    delayMs: noDelay,
  }).runCycle();

  assert.equal(s.saves, 0);
  assert.equal(s.unfollowsSince(new Date(0)).length, 0);
});
