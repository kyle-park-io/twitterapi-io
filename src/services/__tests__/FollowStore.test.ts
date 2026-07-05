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

test("malformed file loads as empty state without throwing", () => {
  const file = tmpFile();
  fs.writeFileSync(file, "{ not valid json", "utf8");
  const store = new FollowStore(file);
  store.load();
  assert.equal(store.has("anyone"), false);
  assert.equal(store.getLastRun(), null);
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
  assert.deepEqual(first, ["a", "b"]);
  assert.equal(store.queueSize(), 1);
  const rest = store.dequeue(5); // more than available
  assert.deepEqual(rest, ["c"]);
  assert.equal(store.queueSize(), 0);
});

test("peek returns queued usernames without removing them", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.enqueue("a");
  store.enqueue("b");
  assert.deepEqual(store.peek(1), ["a"]);
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
  assert.deepEqual(b.dequeue(2), ["x", "y"]);
});
