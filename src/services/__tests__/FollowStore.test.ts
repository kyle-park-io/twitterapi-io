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
