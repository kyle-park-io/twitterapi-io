import { test } from "node:test";
import assert from "node:assert/strict";
import { AutoFollowRunner, isUnhealthy } from "../AutoFollowRunner";
import { FollowStore } from "../FollowStore";
import { IFollower } from "../../follow/IFollower";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface FakeTweet {
  author?: { userName: string; name: string };
}

function fakeSearch(byQuery: Record<string, FakeTweet[]>) {
  const queries: string[] = [];
  return {
    queries,
    async *advancedSearch(query: string, _queryType?: string): AsyncGenerator<FakeTweet> {
      queries.push(query);
      for (const t of byQuery[query] ?? []) yield t;
    },
  };
}

function recordingFollower(): { followed: string[] } & IFollower {
  const followed: string[] = [];
  return {
    followed,
    async follow(username: string) {
      followed.push(username);
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
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, []); // dry-run follows nobody
  assert.deepEqual(
    summary.followed.map((f) => f.userName),
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
  });

  const summary = await runner.runCycle();

  assert.equal(summary.dryRun, true);
  assert.equal(summary.addedCount, 0);
  assert.equal(summary.followedCountBefore, 0);
  assert.equal(summary.followedCountAfter, 0);
  assert.equal(follower.followed.length, 0); // nobody actually followed
  assert.equal(store.queueSize(), 1); // candidate still queued (peek, not dequeue)
  assert.equal(summary.followed[0].userName, "alice");
  assert.equal(summary.followed[0].url, "https://x.com/alice");
  assert.equal(summary.followed[0].keyword, "kw1");
});

function failingFollower(): IFollower {
  return {
    async follow(_username: string) {
      throw new Error("blocked");
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
