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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

test("dedupes authors across keywords and caps at maxPerRun", async () => {
  const search = fakeSearch({
    kw1: [{ author: { userName: "alice", name: "A" } }, { author: { userName: "bob", name: "B" } }],
    kw2: [{ author: { userName: "Alice", name: "A" } }, { author: { userName: "carol", name: "C" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1", "kw2"],
    queryType: "Latest",
    perKeyword: 30,
    maxPerRun: 2,
    dryRun: false,
    delayMs: () => 0,
  });

  const summary = await runner.runCycle();

  // alice (once, case-insensitive), bob — carol dropped by maxPerRun=2
  assert.deepEqual(follower.followed, ["alice", "bob"]);
  assert.equal(summary.followed.length, 2);
});

test("excludes users already in the store", async () => {
  const store = tmpStore();
  store.add("bob");
  const search = fakeSearch({
    kw1: [{ author: { userName: "alice", name: "A" } }, { author: { userName: "bob", name: "B" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
  });

  await runner.runCycle();

  assert.deepEqual(follower.followed, ["alice"]);
});

test("dryRun follows nobody but still reports candidates", async () => {
  const search = fakeSearch({
    kw1: [{ author: { userName: "alice", name: "A" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, []);
  assert.deepEqual(summary.followed, ["alice"]);
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
    maxPerRun: 100,
    dryRun: false,
    delayMs: () => 0,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.scanned, 5);
  assert.equal(follower.followed.length, 5);
});

test("appends since: filter when store has a last-run time", async () => {
  const store = tmpStore();
  store.setLastRun(new Date("2026-07-06T00:00:00.000Z"));
  const search = fakeSearch({});
  const runner = new AutoFollowRunner(search, store, recordingFollower(), {
    keywords: ["myword"],
    queryType: "Latest",
    perKeyword: 30,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
  });

  await runner.runCycle();

  assert.equal(search.queries.length, 1);
  assert.match(search.queries[0], /^myword since:2026-07-06/);
});

test("sets last-run after the cycle", async () => {
  const store = tmpStore();
  const fixedNow = new Date("2026-07-06T12:00:00.000Z");
  const runner = new AutoFollowRunner(fakeSearch({}), store, recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    now: () => fixedNow,
  });

  await runner.runCycle();

  assert.deepEqual(store.getLastRun(), fixedNow);
});
