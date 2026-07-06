import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStorageState } from "../SessionState";

const FIXED = new Date("2026-07-06T00:00:00Z");
const EXPECTED_EXPIRES = Math.floor(FIXED.getTime() / 1000) + 31_536_000;

test("builds a storageState with both cookies", () => {
  const state = buildStorageState("AUTHVAL", "CT0VAL", FIXED);
  assert.equal(state.cookies.length, 2);
  assert.deepEqual(state.origins, []);
});

test("auth_token cookie has the right shape", () => {
  const state = buildStorageState("AUTHVAL", "CT0VAL", FIXED);
  const auth = state.cookies.find((c) => c.name === "auth_token");
  assert.ok(auth, "auth_token cookie present");
  assert.equal(auth!.value, "AUTHVAL");
  assert.equal(auth!.domain, ".x.com");
  assert.equal(auth!.path, "/");
  assert.equal(auth!.httpOnly, true);
  assert.equal(auth!.secure, true);
  assert.equal(auth!.sameSite, "None");
  assert.equal(auth!.expires, EXPECTED_EXPIRES);
});

test("ct0 cookie has the right shape", () => {
  const state = buildStorageState("AUTHVAL", "CT0VAL", FIXED);
  const ct0 = state.cookies.find((c) => c.name === "ct0");
  assert.ok(ct0, "ct0 cookie present");
  assert.equal(ct0!.value, "CT0VAL");
  assert.equal(ct0!.domain, ".x.com");
  assert.equal(ct0!.path, "/");
  assert.equal(ct0!.httpOnly, false);
  assert.equal(ct0!.secure, true);
  assert.equal(ct0!.sameSite, "Lax");
  assert.equal(ct0!.expires, EXPECTED_EXPIRES);
});

test("defaults now to the current time when omitted", () => {
  const before = Math.floor(Date.now() / 1000) + 31_536_000;
  const state = buildStorageState("A", "C");
  const after = Math.floor(Date.now() / 1000) + 31_536_000;
  const auth = state.cookies.find((c) => c.name === "auth_token")!;
  assert.ok(auth.expires >= before && auth.expires <= after);
});
