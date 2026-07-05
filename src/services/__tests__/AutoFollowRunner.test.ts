import { test } from "node:test";
import assert from "node:assert/strict";
import { AutoFollowRunner } from "../AutoFollowRunner";
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
  assert.deepEqual(summary.followed, ["alice"]); // but reports who it would follow
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
