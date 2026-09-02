import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FollowStore } from "../FollowStore";

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fs-")), "state.json");
}

test("missing file loads as empty state", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  assert.equal(store.has("alice"), false);
  assert.equal(store.getLastRun(), null);
  assert.equal(store.getLastSuccessAt(), null);
  assert.equal(store.getConsecutiveZeroCycles(), 0);
  assert.equal(store.getLastActualFollowingCount(), null);
  assert.equal(store.getCapStallCycles(), 0);
  assert.equal(store.getCapDetectedAt(), null);
  assert.equal(store.getCapActualCount(), null);
  assert.equal(store.unfollowedCount(), 0);
});

test("add + has is case-insensitive", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.add("Alice");
  assert.equal(store.has("alice"), true);
  assert.equal(store.has("ALICE"), true);
});

test("save then load round-trips followed set and lastRun", () => {
  const file = tmpFile();
  const when = new Date("2026-07-06T00:00:00.000Z");
  const a = new FollowStore(file);
  a.load();
  a.add("bob");
  a.setLastRun(when);
  a.save();

  const b = new FollowStore(file);
  b.load();
  assert.equal(b.has("bob"), true);
  assert.deepEqual(b.getLastRun(), when);
});

// This test used to assert the opposite — that a malformed file loads as empty
// state without throwing. That encoded the bug: an unreadable state file is
// indistinguishable from a first run, and the very next save() writes that empty
// state over thousands of real follow records and the permanent unfollow
// blocklist. Only a *missing* file may reset.
test("an existing but unparseable file throws rather than resetting to empty", () => {
  const file = tmpFile();
  fs.writeFileSync(file, "{ not valid json", "utf8");
  const store = new FollowStore(file);
  assert.throws(() => store.load(), /could not be parsed as state/);
});

test("a file holding valid JSON that is not a state object throws", () => {
  const file = tmpFile();
  fs.writeFileSync(file, "[1, 2, 3]", "utf8");
  const store = new FollowStore(file);
  assert.throws(() => store.load(), /could not be parsed as state/);
});

test("save creates parent directories", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fs-")), "nested", "deep", "state.json");
  const store = new FollowStore(file);
  store.load();
  store.add("carol");
  store.save();
  assert.equal(fs.existsSync(file), true);
});

test("enqueue adds to queue and queueSize reflects it", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.enqueue("alice");
  store.enqueue("bob");
  assert.equal(store.queueSize(), 2);
});

test("enqueue skips users already followed or already queued (case-insensitive)", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.add("Followed");
  store.enqueue("followed"); // already followed -> skip
  store.enqueue("Alice");
  store.enqueue("alice"); // already queued -> skip
  assert.equal(store.queueSize(), 1);
  assert.equal(store.isQueued("ALICE"), true);
  assert.equal(store.isQueued("followed"), false);
});

test("dequeue returns up to n usernames in FIFO order and removes them", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.enqueue("a");
  store.enqueue("b");
  store.enqueue("c");
  const first = store.dequeue(2);
  assert.deepEqual(first, [{ userName: "a" }, { userName: "b" }]);
  assert.equal(store.queueSize(), 1);
  const rest = store.dequeue(5); // more than available
  assert.deepEqual(rest, [{ userName: "c" }]);
  assert.equal(store.queueSize(), 0);
});

test("peek returns queued usernames without removing them", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.enqueue("a");
  store.enqueue("b");
  assert.deepEqual(store.peek(1), [{ userName: "a" }]);
  assert.equal(store.queueSize(), 2); // peek does not consume
});

test("queue round-trips through save/load", () => {
  const file = tmpFile();
  const a = new FollowStore(file);
  a.load();
  a.enqueue("x");
  a.enqueue("y");
  a.save();

  const b = new FollowStore(file);
  b.load();
  assert.equal(b.queueSize(), 2);
  assert.deepEqual(b.dequeue(2), [{ userName: "x" }, { userName: "y" }]);
});

test("loads a queue mixing bare strings and candidate objects", () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({
      followed: [],
      queue: ["alice", { userName: "bob", name: "Bob", keyword: "AI" }],
      lastRun: null,
    })
  );
  const store = new FollowStore(file);
  store.load();
  assert.equal(store.queueSize(), 2);
  const peeked = store.peek(2);
  assert.deepEqual(peeked[0], { userName: "alice" });
  assert.deepEqual(peeked[1], { userName: "bob", name: "Bob", keyword: "AI" });
});

test("enqueue stores metadata and round-trips through save/load", () => {
  const file = tmpFile();
  const store = new FollowStore(file);
  store.load();
  store.enqueue("carol", { name: "Carol", keyword: "crypto" });
  store.save();

  const reloaded = new FollowStore(file);
  reloaded.load();
  assert.deepEqual(reloaded.dequeue(1), [
    { userName: "carol", name: "Carol", keyword: "crypto" },
  ]);
});

test("dequeue returns candidate objects and removes them", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.enqueue("alice");
  store.enqueue("bob", { name: "Bob" });
  const taken = store.dequeue(1);
  assert.deepEqual(taken, [{ userName: "alice" }]);
  assert.equal(store.queueSize(), 1);
});

test("dedupe is by lowercased userName across string and object forms", () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({ followed: [], queue: ["Alice"], lastRun: null })
  );
  const store = new FollowStore(file);
  store.load();
  store.enqueue("alice", { name: "A" }); // already queued as "Alice"
  assert.equal(store.queueSize(), 1);
});

test("followedCount reflects adds", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  assert.equal(store.followedCount(), 0);
  store.add("alice");
  store.add("Alice"); // case-insensitive, same person
  store.add("bob");
  assert.equal(store.followedCount(), 2);
});

test("health fields default when absent from an old file", () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({ followed: [], queue: [], lastRun: null })
  );
  const store = new FollowStore(file);
  store.load();
  assert.equal(store.getLastSuccessAt(), null);
  assert.equal(store.getConsecutiveZeroCycles(), 0);
});

test("health fields round-trip through save/load", () => {
  const file = tmpFile();
  const store = new FollowStore(file);
  store.load();
  const when = new Date("2026-07-06T12:00:00.000Z");
  store.setLastSuccessAt(when);
  store.setConsecutiveZeroCycles(3);
  store.save();

  const reloaded = new FollowStore(file);
  reloaded.load();
  assert.equal(reloaded.getConsecutiveZeroCycles(), 3);
  assert.equal(reloaded.getLastSuccessAt()?.toISOString(), when.toISOString());
});

test("lastFollowingSyncAt defaults to null when absent from an old file", () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({ followed: [], queue: [], lastRun: null })
  );
  const store = new FollowStore(file);
  store.load();
  assert.equal(store.getLastFollowingSyncAt(), null);
});

test("lastFollowingSyncAt round-trips through save/load", () => {
  const file = tmpFile();
  const store = new FollowStore(file);
  store.load();
  const when = new Date("2026-07-16T00:00:00.000Z");
  store.setLastFollowingSyncAt(when);
  store.save();

  const reloaded = new FollowStore(file);
  reloaded.load();
  assert.equal(reloaded.getLastFollowingSyncAt()?.toISOString(), when.toISOString());
});

test("enqueue stores verified tiers and round-trips", () => {
  const file = tmpFile();
  const store = new FollowStore(file);
  store.load();
  store.enqueue("carol", { name: "Carol", keyword: "AI", verified: ["blue"] });
  store.save();
  const reloaded = new FollowStore(file);
  reloaded.load();
  assert.deepEqual(reloaded.dequeue(1), [
    { userName: "carol", name: "Carol", keyword: "AI", verified: ["blue"] },
  ]);
});

test("cap fields default to empty when absent from an old file", () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({ followed: [], queue: [], lastRun: null })
  );
  const store = new FollowStore(file);
  store.load();
  assert.equal(store.getLastActualFollowingCount(), null);
  assert.equal(store.getCapStallCycles(), 0);
  assert.equal(store.getCapDetectedAt(), null);
  assert.equal(store.getCapActualCount(), null);
});

test("cap fields round-trip through save/load", () => {
  const file = tmpFile();
  const store = new FollowStore(file);
  store.load();
  const when = new Date("2026-07-29T00:00:00.000Z");
  store.setLastActualFollowingCount(7500);
  store.setCapStallCycles(2);
  store.setCapDetectedAt(when);
  store.setCapActualCount(7500);
  store.save();

  const reloaded = new FollowStore(file);
  reloaded.load();
  assert.equal(reloaded.getLastActualFollowingCount(), 7500);
  assert.equal(reloaded.getCapStallCycles(), 2);
  assert.equal(reloaded.getCapDetectedAt()?.toISOString(), when.toISOString());
  assert.equal(reloaded.getCapActualCount(), 7500);
});

test("clearing cap fields with null round-trips", () => {
  const file = tmpFile();
  const store = new FollowStore(file);
  store.load();
  store.setCapDetectedAt(new Date());
  store.setCapActualCount(7500);
  store.setCapDetectedAt(null);
  store.setCapActualCount(null);
  store.save();

  const reloaded = new FollowStore(file);
  reloaded.load();
  assert.equal(reloaded.getCapDetectedAt(), null);
  assert.equal(reloaded.getCapActualCount(), null);
});

test("remove takes a user out of the followed-set case-insensitively", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.add("Alice");
  store.remove("ALICE");
  assert.equal(store.has("alice"), false);
});

test("a removed user can be re-queued", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.add("bob");
  store.enqueue("bob"); // no-op: already followed
  assert.equal(store.queueSize(), 0);
  store.remove("bob");
  store.enqueue("bob", { keyword: "AI" });
  assert.equal(store.queueSize(), 1);
  assert.equal(store.isQueued("bob"), true);
});

test("markUnfollowed is case-insensitive and queryable", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.markUnfollowed("Spammer");
  assert.equal(store.wasUnfollowed("spammer"), true);
  assert.equal(store.wasUnfollowed("SPAMMER"), true);
  assert.equal(store.unfollowedCount(), 1);
});

test("enqueue skips a previously unfollowed user", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.markUnfollowed("spammer");
  store.enqueue("spammer");
  assert.equal(store.queueSize(), 0);
  assert.equal(store.isQueued("spammer"), false);
});

test("unfollowed set round-trips through save and load", () => {
  const file = tmpFile();
  const a = new FollowStore(file);
  a.load();
  a.markUnfollowed("spammer");
  a.save();

  const b = new FollowStore(file);
  b.load();
  assert.equal(b.wasUnfollowed("spammer"), true);
});

test("removing from the followed set does not clear the unfollowed record", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.add("spammer");
  store.markUnfollowed("spammer");
  store.remove("spammer");
  assert.equal(store.wasUnfollowed("spammer"), true);
  store.enqueue("spammer");
  assert.equal(store.queueSize(), 0);
});

test("markUnfollowed evicts the handle from the pending queue", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.enqueue("spammer", { keyword: "AI" });
  store.enqueue("keeper");
  store.markUnfollowed("SPAMMER"); // case-insensitive
  assert.equal(store.isQueued("spammer"), false);
  assert.equal(store.queueSize(), 1);
  assert.deepEqual(store.peek(5), [{ userName: "keeper" }]);
});

test("load drops unfollowed handles from a persisted queue", () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({
      followed: [],
      // Written by an older process that queued the handle before it was cleaned.
      queue: ["Spammer", { userName: "keeper" }],
      lastRun: null,
      unfollowed: ["spammer"],
    })
  );
  const store = new FollowStore(file);
  store.load();
  assert.equal(store.queueSize(), 1);
  assert.equal(store.isQueued("spammer"), false);
  assert.equal(store.wasUnfollowed("spammer"), true);
  assert.deepEqual(store.peek(5), [{ userName: "keeper" }]);
});

test("save unions the on-disk unfollowed set instead of overwriting it", () => {
  const file = tmpFile();
  // Two processes that each loaded the same state and unfollowed someone else.
  const a = new FollowStore(file);
  a.load();
  const b = new FollowStore(file);
  b.load();

  a.markUnfollowed("first");
  a.save();
  b.markUnfollowed("second"); // b's snapshot predates a's write
  b.save();

  const c = new FollowStore(file);
  c.load();
  assert.equal(c.wasUnfollowed("first"), true, "b.save() must not erase a's blocklist entry");
  assert.equal(c.wasUnfollowed("second"), true);
  assert.equal(c.unfollowedCount(), 2);
});

test("save also unions the on-disk unfollow history", () => {
  const file = tmpFile();
  const a = new FollowStore(file);
  a.load();
  const b = new FollowStore(file);
  b.load();

  a.recordUnfollow(new Date(Date.now() - 60_000));
  a.save();
  b.recordUnfollow(new Date(Date.now() - 30_000));
  b.save();

  const c = new FollowStore(file);
  c.load();
  assert.equal(c.unfollowsSince(new Date(Date.now() - 3_600_000)).length, 2);
});

test("save unions across processes even when the queue diverged", () => {
  const file = tmpFile();
  const service = new FollowStore(file);
  service.load();
  service.enqueue("spammer");
  service.save();

  const cleanup = new FollowStore(file);
  cleanup.load();
  cleanup.markUnfollowed("spammer");
  cleanup.save();

  // The follow service still holds "spammer" queued from before the cleanup.
  service.save();
  const after = new FollowStore(file);
  after.load();
  assert.equal(after.wasUnfollowed("spammer"), true);
  assert.equal(after.isQueued("spammer"), false, "the persisted queue must not resurrect it");
});

test("refreshUnfollowed picks up another process's blocklist and purges the queue", () => {
  const file = tmpFile();
  const service = new FollowStore(file);
  service.load();
  service.enqueue("spammer");
  service.save();

  const cleanup = new FollowStore(file);
  cleanup.load();
  cleanup.markUnfollowed("spammer");
  cleanup.save();

  assert.equal(service.wasUnfollowed("spammer"), false); // stale snapshot
  service.refreshUnfollowed();
  assert.equal(service.wasUnfollowed("spammer"), true);
  assert.equal(service.isQueued("spammer"), false);
  assert.equal(service.queueSize(), 0);
});

test("refreshUnfollowed tolerates a missing state file", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.enqueue("alice");
  store.refreshUnfollowed();
  assert.equal(store.queueSize(), 1);
});

test("recordUnfollow timestamps count toward the trailing 24h window", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  const now = Date.now();
  store.recordUnfollow(new Date(now - 2 * 60 * 60 * 1000));
  store.recordUnfollow(new Date(now - 60 * 60 * 1000));
  store.recordUnfollow(new Date(now - 30 * 60 * 60 * 1000)); // 30h ago: inside retention, outside 24h

  assert.equal(store.unfollowsSince(new Date(now - 24 * 60 * 60 * 1000)).length, 2);
  assert.equal(store.unfollowsSince(new Date(now - 48 * 60 * 60 * 1000)).length, 3);
});

test("unfollow history is pruned beyond 48h so it cannot grow unbounded", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  const now = Date.now();
  store.recordUnfollow(new Date(now - 49 * 60 * 60 * 1000));
  store.recordUnfollow(new Date(now - 1000));
  const kept = store.unfollowsSince(new Date(0));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].getTime() > now - 60_000, true);
});

test("load prunes unfollow history older than 48h", () => {
  const file = tmpFile();
  const now = Date.now();
  fs.writeFileSync(
    file,
    JSON.stringify({
      followed: [],
      queue: [],
      lastRun: null,
      unfollowRunAt: [
        new Date(now - 72 * 60 * 60 * 1000).toISOString(),
        new Date(now - 60_000).toISOString(),
      ],
    })
  );
  const store = new FollowStore(file);
  store.load();
  assert.equal(store.unfollowsSince(new Date(0)).length, 1);
});

test("lastUnfollowAt returns the most recent timestamp", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  assert.equal(store.lastUnfollowAt(), null);
  const now = Date.now();
  store.recordUnfollow(new Date(now - 5 * 60 * 1000));
  store.recordUnfollow(new Date(now - 90 * 60 * 1000)); // out of order
  assert.equal(store.lastUnfollowAt()?.getTime(), now - 5 * 60 * 1000);
});

test("unfollow history round-trips through save/load", () => {
  const file = tmpFile();
  const when = new Date(Date.now() - 10 * 60 * 1000);
  const store = new FollowStore(file);
  store.load();
  store.recordUnfollow(when);
  store.save();

  const reloaded = new FollowStore(file);
  reloaded.load();
  assert.equal(reloaded.lastUnfollowAt()?.toISOString(), when.toISOString());
});

test("save leaves no temp file behind and writes parseable state", () => {
  const file = tmpFile();
  const store = new FollowStore(file);
  store.load();
  store.add("alice");
  store.save();
  store.save();
  const siblings = fs.readdirSync(path.dirname(file));
  assert.deepEqual(siblings, [path.basename(file)]);
  assert.equal(typeof JSON.parse(fs.readFileSync(file, "utf8")), "object");
});
