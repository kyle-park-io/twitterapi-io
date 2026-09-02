import { test } from "node:test";
import assert from "node:assert/strict";
import { AutoFollowRunner, isUnhealthy } from "../AutoFollowRunner";
import { FollowStore } from "../FollowStore";
import { IFollower } from "../../follow/IFollower";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface FakeTweet {
  author?: {
    userName: string;
    name: string;
    isVerified?: boolean;
    isBlueVerified?: boolean;
    verifiedType?: string | null;
    description?: string;
    followers?: number;
    following?: number;
    statusesCount?: number;
    profilePicture?: string;
    coverPicture?: string | null;
  };
}

/**
 * Author fields the scoring gate (Task 6) reads, applied as defaults for any
 * fixture that doesn't set them explicitly. Most fixtures in this file predate
 * the scoring gate and exercise queue/follow mechanics, not content scoring —
 * without a clean baseline, `fromSearchAuthor`'s zeroed-out defaults (0
 * followers, 0 statuses, empty bio) trip the scorer's ghost-account and
 * no-bio-no-banner rules and the candidate never reaches the assertions the
 * test is actually about. A test that cares about scoring sets these fields
 * itself, which overrides the defaults below.
 */
const CLEAN_AUTHOR_DEFAULTS = {
  description: "Just a person, tweeting.",
  followers: 1000,
  following: 100,
  statusesCount: 500,
};

function fakeSearch(byQuery: Record<string, FakeTweet[]>) {
  const queries: string[] = [];
  return {
    queries,
    async *advancedSearch(query: string, _queryType?: string): AsyncGenerator<FakeTweet> {
      queries.push(query);
      for (const t of byQuery[query] ?? []) {
        yield t.author ? { ...t, author: { ...CLEAN_AUTHOR_DEFAULTS, ...t.author } } : t;
      }
    },
  };
}

function recordingFollower(): { followed: string[] } & IFollower {
  const followed: string[] = [];
  return {
    followed,
    async follow(username: string) {
      followed.push(username);
      return "followed" as const;
    },
    async unfollow(_username: string): Promise<never> {
      throw new Error("unfollow must not be called");
    },
  };
}

function tmpStore(): FollowStore {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "afr-")), "s.json");
  const s = new FollowStore(file);
  s.load();
  return s;
}

/** Deterministic keyword picker: hand out batches in order, so tests control sampling. */
function scriptedPicker(batches: string[][]) {
  let i = 0;
  return (_all: string[], _n: number): string[] => {
    const batch = batches[i] ?? [];
    i++;
    return batch;
  };
}

test("searches one sampled batch, queues authors, and follows up to maxPerRun", async () => {
  const search = fakeSearch({
    kw1: [{ author: { userName: "alice", name: "A" } }, { author: { userName: "bob", name: "B" } }],
    kw2: [{ author: { userName: "carol", name: "C" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1", "kw2", "kw3"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 2,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1", "kw2"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(search.queries, ["kw1", "kw2"]); // one batch of 2, no since: suffix
  assert.deepEqual(follower.followed.sort(), ["alice", "bob", "carol"]);
  assert.equal(summary.followed.length, 3);
  assert.deepEqual(
    summary.followed.map((f) => f.userName).sort(),
    ["alice", "bob", "carol"]
  );
});

test("caps follows at maxPerRun and leaves the rest queued for next cycle", async () => {
  const store = tmpStore();
  const search = fakeSearch({
    kw1: [
      { author: { userName: "a", name: "" } },
      { author: { userName: "b", name: "" } },
      { author: { userName: "c", name: "" } },
    ],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 2,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, ["a", "b"]);
  assert.equal(summary.followed.length, 2);
  assert.equal(store.queueSize(), 1); // "c" stays queued
});

test("samples additional batches when the queue is still short", async () => {
  const search = fakeSearch({
    kw1: [{ author: { userName: "a", name: "" } }],
    kw2: [{ author: { userName: "b", name: "" } }],
    kw3: [{ author: { userName: "c", name: "" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1", "kw2", "kw3"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 3,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"], ["kw2"], ["kw3"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  await runner.runCycle();

  // Each batch yields 1 candidate; needs 3 batches to reach maxPerRun=3.
  assert.deepEqual(search.queries, ["kw1", "kw2", "kw3"]);
  assert.deepEqual(follower.followed, ["a", "b", "c"]);
});

test("skips searching when the queue already has enough candidates", async () => {
  const store = tmpStore();
  store.enqueue("pre1");
  store.enqueue("pre2");
  const search = fakeSearch({ kw1: [{ author: { userName: "new", name: "" } }] });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(store === store ? search : search, store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 2,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  await runner.runCycle();

  assert.deepEqual(search.queries, []); // queue already had 2 >= maxPerRun, no search
  assert.deepEqual(follower.followed, ["pre1", "pre2"]);
});

test("does not queue users already followed", async () => {
  const store = tmpStore();
  store.add("bob");
  const search = fakeSearch({
    kw1: [{ author: { userName: "alice", name: "" } }, { author: { userName: "Bob", name: "" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  await runner.runCycle();

  assert.deepEqual(follower.followed, ["alice"]);
});

test("respects perKeyword scan cap", async () => {
  const many: FakeTweet[] = Array.from({ length: 50 }, (_, i) => ({
    author: { userName: `u${i}`, name: "x" },
  }));
  const search = fakeSearch({ kw1: many });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 5,
    keywordsPerCycle: 1,
    maxPerRun: 100,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.scanned, 5); // only 5 tweets scanned from the keyword
  assert.equal(follower.followed.length, 5);
});

test("dryRun follows nobody and does not consume the queue", async () => {
  const store = tmpStore();
  const search = fakeSearch({ kw1: [{ author: { userName: "alice", name: "" } }] });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, []); // dry-run follows nobody
  assert.deepEqual(summary.followed, []); // followed stays empty in dry-run
  assert.deepEqual(
    summary.wouldFollow.map((f) => f.userName),
    ["alice"]
  ); // but reports who it would follow
  assert.equal(store.queueSize(), 1); // candidate stays queued for a real run
});

test("no keywords sampled and empty queue follows nobody without error", async () => {
  const runner = new AutoFollowRunner(fakeSearch({}), tmpStore(), recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(summary.followed, []);
});

test("summary carries timing, before/after counts, and per-followed metadata", async () => {
  const search = fakeSearch({
    kw1: [
      { author: { userName: "alice", name: "Alice A" } },
      { author: { userName: "bob", name: "Bob B" } },
    ],
  });
  const follower = recordingFollower();
  let t = 1000;
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1", "kw2"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    now: () => new Date(t++), // advances 1ms per call
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.dryRun, false);
  assert.equal(summary.followedCountBefore, 0);
  assert.equal(summary.followedCountAfter, 2);
  assert.equal(summary.addedCount, 2);
  assert.ok(summary.durationMs >= 0);
  assert.equal(typeof summary.startedAt, "string");
  assert.equal(typeof summary.finishedAt, "string");
  const alice = summary.followed.find((f) => f.userName === "alice")!;
  assert.equal(alice.name, "Alice A");
  assert.equal(alice.url, "https://x.com/alice");
  assert.equal(alice.keyword, "kw1");
});

test("dry-run reports would-follow candidates with addedCount 0 and no queue consumption", async () => {
  const store = tmpStore();
  const search = fakeSearch({
    kw1: [{ author: { userName: "alice", name: "Alice" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1", "kw2"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.dryRun, true);
  assert.equal(summary.addedCount, 0);
  assert.equal(summary.followedCountBefore, 0);
  assert.equal(summary.followedCountAfter, 0);
  assert.equal(follower.followed.length, 0); // nobody actually followed
  assert.equal(store.queueSize(), 1); // candidate still queued (peek, not dequeue)
  assert.equal(summary.followed.length, 0); // dry-run must not report followed
  assert.equal(summary.wouldFollow[0].userName, "alice");
  assert.equal(summary.wouldFollow[0].url, "https://x.com/alice");
  assert.equal(summary.wouldFollow[0].keyword, "kw1");
});

test("dry-run reports would-be targets as wouldFollow, not followed", async () => {
  const search = fakeSearch({
    kw1: [
      {
        author: {
          userName: "alice",
          name: "A",
          description: "Engineer.",
          followers: 3000,
          following: 200,
          statusesCount: 900,
        },
      },
      {
        author: {
          userName: "bob",
          name: "B",
          description: "Researcher.",
          followers: 4000,
          following: 300,
          statusesCount: 1200,
        },
      },
    ],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, [], "dry-run must not follow");
  assert.equal(summary.followed.length, 0, "followed must be empty in dry-run");
  assert.equal(summary.wouldFollow.length, 2);
  assert.equal(summary.addedCount, 0);
});

test("a real run reports followed and leaves wouldFollow empty", async () => {
  const search = fakeSearch({
    kw1: [
      {
        author: {
          userName: "alice",
          name: "A",
          description: "Engineer.",
          followers: 3000,
          following: 200,
          statusesCount: 900,
        },
      },
    ],
  });
  const runner = new AutoFollowRunner(search, tmpStore(), recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.followed.length, 1);
  assert.equal(summary.wouldFollow.length, 0);
  assert.equal(summary.addedCount, 1);
});

function failingFollower(): IFollower {
  return {
    async follow(_username: string): Promise<never> {
      throw new Error("blocked");
    },
    async unfollow(_username: string): Promise<never> {
      throw new Error("unfollow must not be called");
    },
  };
}

function alreadyFollowingFollower(): IFollower {
  return {
    async follow(_username: string) {
      return "already-following" as const;
    },
    async unfollow(_username: string): Promise<never> {
      throw new Error("unfollow must not be called");
    },
  };
}

test("attempted-but-followed-0 increments consecutiveZeroCycles", async () => {
  const store = tmpStore();
  store.enqueue("alice");
  store.enqueue("bob");
  const search = fakeSearch({}); // no new candidates; drain the pre-queued ones
  const runner = new AutoFollowRunner(search, store, failingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]), // empty batch → no search, just drain
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.attempted, 2);
  assert.equal(summary.addedCount, 0);
  assert.equal(summary.followFailures, 2);
  assert.equal(summary.consecutiveZeroCycles, 1);
  assert.equal(store.getConsecutiveZeroCycles(), 1);
});

test("a successful cycle resets the counter and sets lastSuccessAt", async () => {
  const store = tmpStore();
  store.setConsecutiveZeroCycles(5);
  store.enqueue("alice");
  const search = fakeSearch({});
  let t = 1000;
  const runner = new AutoFollowRunner(search, store, recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    now: () => new Date(t++),
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.addedCount, 1);
  assert.equal(summary.consecutiveZeroCycles, 0);
  assert.equal(store.getConsecutiveZeroCycles(), 0);
  assert.ok(store.getLastSuccessAt() !== null);
});

test("a cycle with nothing to attempt leaves the counter untouched", async () => {
  const store = tmpStore();
  store.setConsecutiveZeroCycles(3);
  const search = fakeSearch({}); // empty queue + empty search = nothing to drain
  const runner = new AutoFollowRunner(search, store, failingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.attempted, 0);
  assert.equal(summary.consecutiveZeroCycles, 3); // unchanged
  assert.equal(store.getConsecutiveZeroCycles(), 3);
});

test("dry-run never touches the health counter", async () => {
  const store = tmpStore();
  store.setConsecutiveZeroCycles(4);
  store.enqueue("alice");
  const search = fakeSearch({});
  const runner = new AutoFollowRunner(search, store, failingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.attempted, 0); // dry-run attempts nothing
  assert.equal(summary.consecutiveZeroCycles, 4); // unchanged
  assert.equal(store.getConsecutiveZeroCycles(), 4);
});

test("isUnhealthy compares against threshold", () => {
  assert.equal(isUnhealthy(2, 2), true);
  assert.equal(isUnhealthy(3, 2), true);
  assert.equal(isUnhealthy(1, 2), false);
  assert.equal(isUnhealthy(0, 2), false);
});

import { authorTiers, passesVerifiedFilter } from "../AutoFollowRunner";

test("authorTiers maps each signal to its tier", () => {
  assert.deepEqual(authorTiers({ isBlueVerified: true }), ["blue"]);
  assert.deepEqual(authorTiers({ isVerified: true }), ["legacy"]);
  assert.deepEqual(authorTiers({ verifiedType: "Business" }), ["business"]);
  assert.deepEqual(authorTiers({ verifiedType: "Government" }), ["government"]);
});

test("authorTiers returns all held tiers, or none", () => {
  assert.deepEqual(
    authorTiers({ isBlueVerified: true, verifiedType: "Business" }).sort(),
    ["blue", "business"]
  );
  assert.deepEqual(authorTiers({ isBlueVerified: false, isVerified: false, verifiedType: null }), []);
  assert.deepEqual(authorTiers({}), []);
});

test("passesVerifiedFilter: empty allowed means filter off", () => {
  assert.equal(passesVerifiedFilter({}, []), true);
  assert.equal(passesVerifiedFilter({ isBlueVerified: false }, []), true);
});

test("passesVerifiedFilter matches when a held tier is allowed", () => {
  assert.equal(passesVerifiedFilter({ isBlueVerified: true }, ["blue"]), true);
  assert.equal(passesVerifiedFilter({ verifiedType: "Business" }, ["blue", "business"]), true);
});

test("passesVerifiedFilter rejects when no held tier is allowed", () => {
  assert.equal(passesVerifiedFilter({ verifiedType: "Business" }, ["blue"]), false);
  assert.equal(passesVerifiedFilter({}, ["blue"]), false);
});

test("fillQueue skips unverified authors and counts them", async () => {
  const store = tmpStore();
  const search = fakeSearch({
    kw1: [
      { author: { userName: "verified1", name: "V1", isBlueVerified: true } },
      { author: { userName: "plain1", name: "P1", isBlueVerified: false } },
      { author: { userName: "biz1", name: "B1", verifiedType: "Business" } },
    ],
  });
  const runner = new AutoFollowRunner(search, store, recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: ["blue", "business"],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  // plain1 is skipped; verified1 (blue) and biz1 (business) are queued.
  assert.equal(summary.skippedUnverified, 1);
  assert.equal(store.queueSize(), 2);
  const queued = store.peek(10).map((c) => c.userName).sort();
  assert.deepEqual(queued, ["biz1", "verified1"]);
  const v1 = store.peek(10).find((c) => c.userName === "verified1")!;
  assert.deepEqual(v1.verified, ["blue"]);
  // verified tiers must reach the summary (the JSONL log's source); dry-run
  // reports it under wouldFollow, not followed.
  const summaryV1 = summary.wouldFollow.find((f) => f.userName === "verified1")!;
  assert.deepEqual(summaryV1.verified, ["blue"]);
});

test("fillQueue with empty allowedVerified keeps everyone (filter off)", async () => {
  const store = tmpStore();
  const search = fakeSearch({
    kw1: [
      { author: { userName: "plain1", name: "P1", isBlueVerified: false } },
      { author: { userName: "plain2", name: "P2" } },
    ],
  });
  const runner = new AutoFollowRunner(search, store, recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();
  assert.equal(summary.skippedUnverified, 0);
  assert.equal(store.queueSize(), 2);
});

test("already-following candidates count separately and stay healthy", async () => {
  const store = tmpStore();
  store.setConsecutiveZeroCycles(3);
  store.enqueue("alice");
  store.enqueue("bob");
  const search = fakeSearch({});
  let t = 1000;
  const runner = new AutoFollowRunner(search, store, alreadyFollowingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    now: () => new Date(t++),
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.addedCount, 0);          // no NEW follows
  assert.equal(summary.alreadyFollowing, 2);    // both were already followed
  assert.equal(summary.attempted, 2);
  assert.equal(summary.consecutiveZeroCycles, 0); // healthy: session works
  assert.equal(store.getConsecutiveZeroCycles(), 0);
  assert.ok(store.getLastSuccessAt() !== null);
});

test("all-throw cycle increments the unhealthy counter", async () => {
  const store = tmpStore();
  store.enqueue("alice");
  const search = fakeSearch({});
  const runner = new AutoFollowRunner(search, store, failingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.addedCount, 0);
  assert.equal(summary.alreadyFollowing, 0);
  assert.equal(summary.attempted, 1);
  assert.equal(summary.consecutiveZeroCycles, 1); // all attempts threw
});

test("followFailures counts only genuine throws, not already-following", async () => {
  const store = tmpStore();
  store.enqueue("newone"); // will follow
  store.enqueue("existing"); // already following
  store.enqueue("broken"); // throws
  const search = fakeSearch({});
  // Per-username outcomes: one new follow, one already-following, one failure.
  const mixedFollower: IFollower = {
    async follow(username: string) {
      if (username === "existing") return "already-following" as const;
      if (username === "broken") throw new Error("blocked");
      return "followed" as const;
    },
    async unfollow(_username: string): Promise<never> {
      throw new Error("unfollow must not be called");
    },
  };
  const runner = new AutoFollowRunner(search, store, mixedFollower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.attempted, 3);
  assert.equal(summary.addedCount, 1); // "newone"
  assert.equal(summary.alreadyFollowing, 1); // "existing"
  assert.equal(summary.followFailures, 1); // only "broken", NOT "existing"
});

test("a candidate whose bio scores above zero is not queued", async () => {
  const search = fakeSearch({
    kw1: [
      {
        author: {
          userName: "shill",
          name: "Shill",
          description: "Crypto OG | KOL",
          followers: 20000,
          following: 500,
          statusesCount: 3000,
        },
      },
    ],
  });
  const follower = recordingFollower();
  const store = tmpStore();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, []);
  assert.equal(store.queueSize(), 0);
  assert.equal(summary.skippedScored, 1);
});

test("a candidate over the follower ceiling is not queued", async () => {
  const search = fakeSearch({
    kw1: [
      {
        author: {
          userName: "megacorp",
          name: "Mega",
          description: "Breaking news, fast.",
          followers: 1371990,
          following: 171,
          statusesCount: 91806,
        },
      },
    ],
  });
  const follower = recordingFollower();
  const store = tmpStore();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, []);
  assert.equal(summary.skippedTooBig, 1);
});

test("a clean candidate under the ceiling is still queued and followed", async () => {
  const search = fakeSearch({
    kw1: [
      {
        author: {
          userName: "realdev",
          name: "Real Dev",
          description: "Engineer. Building things.",
          followers: 4200,
          following: 300,
          statusesCount: 1800,
        },
      },
    ],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, ["realdev"]);
  assert.equal(summary.skippedScored, 0);
  assert.equal(summary.skippedTooBig, 0);
});

function tmpPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "afr-")), "s.json");
}

/**
 * A store that reports one handle as unfollowed without evicting it from the
 * queue, so the drain-point guard can be exercised directly. In production the
 * store purges such handles on markUnfollowed/load/refresh; the guard exists
 * because re-following an unfollowed account is unrecoverable, and defence in
 * depth is cheap next to that.
 */
class BlocklistOverrideStore extends FollowStore {
  constructor(
    file: string,
    private readonly blocked: string
  ) {
    super(file);
  }
  override wasUnfollowed(username: string): boolean {
    return username.toLowerCase() === this.blocked || super.wasUnfollowed(username);
  }
}

test("the drain point never follows a blocklisted candidate already in the queue", async () => {
  const store = new BlocklistOverrideStore(tmpPath(), "spammer");
  store.load();
  store.enqueue("spammer");
  store.enqueue("keeper");

  const follower = recordingFollower();
  const summary = await new AutoFollowRunner(fakeSearch({}), store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 5,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
    maxFollowers: 500000,
  }).runCycle();

  assert.deepEqual(follower.followed, ["keeper"]);
  assert.equal(summary.attempted, 1, "the blocklisted candidate is not counted as attempted");
});

test("a dry-run cycle does not report a blocklisted candidate as would-follow", async () => {
  const store = new BlocklistOverrideStore(tmpPath(), "spammer");
  store.load();
  store.enqueue("spammer");
  store.enqueue("keeper");

  const summary = await new AutoFollowRunner(fakeSearch({}), store, recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 5,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
    maxFollowers: 500000,
  }).runCycle();

  assert.deepEqual(
    summary.wouldFollow.map((c) => c.userName),
    ["keeper"]
  );
});

test("a handle unfollowed by another process is never followed on the next cycle", async () => {
  const file = tmpPath();
  const service = new FollowStore(file);
  service.load();
  service.enqueue("spammer");
  service.enqueue("keeper");
  service.save();

  // A separate `follow-cleanup --run` process unfollows one of the queued handles.
  const cleanup = new FollowStore(file);
  cleanup.load();
  cleanup.markUnfollowed("spammer");
  cleanup.save();

  // The follow service is still running on its pre-cleanup snapshot.
  const follower = recordingFollower();
  await new AutoFollowRunner(fakeSearch({}), service, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 5,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
    maxFollowers: 500000,
  }).runCycle();

  assert.deepEqual(follower.followed, ["keeper"]);
  const after = new FollowStore(file);
  after.load();
  assert.equal(after.wasUnfollowed("spammer"), true, "the cycle's save must not erase the blocklist");
});
