import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCapStall, CAP_STALL_THRESHOLD } from "../capDetection";

test("no baseline carries the counter unchanged and never trips", () => {
  const res = checkCapStall({ addedThisCycle: 25, prevActual: null, actual: 7500, stallCycles: 1 });
  assert.deepEqual(res, { stallCycles: 1, capReached: false });
});

test("cycles below CAP_MIN_ADDED carry the counter unchanged", () => {
  const res = checkCapStall({ addedThisCycle: 3, prevActual: 7500, actual: 7500, stallCycles: 1 });
  assert.deepEqual(res, { stallCycles: 1, capReached: false });
});

test("all follows landing resets the counter", () => {
  const res = checkCapStall({ addedThisCycle: 25, prevActual: 7000, actual: 7025, stallCycles: 1 });
  assert.deepEqual(res, { stallCycles: 0, capReached: false });
});

test("exactly half landing counts as landed (strict less-than)", () => {
  // 24 followed, 12 landed: 12 < 24*0.5 is false → not stalled.
  const res = checkCapStall({ addedThisCycle: 24, prevActual: 7000, actual: 7012, stallCycles: 1 });
  assert.deepEqual(res, { stallCycles: 0, capReached: false });
});

test("a stalled cycle increments the counter without tripping below the threshold", () => {
  const res = checkCapStall({ addedThisCycle: 25, prevActual: 7500, actual: 7501, stallCycles: 0 });
  assert.deepEqual(res, { stallCycles: 1, capReached: false });
});

test("consecutive stalled cycles reaching the threshold trip the cap", () => {
  const res = checkCapStall({
    addedThisCycle: 25,
    prevActual: 7500,
    actual: 7500,
    stallCycles: CAP_STALL_THRESHOLD - 1,
  });
  assert.equal(res.stallCycles, CAP_STALL_THRESHOLD);
  assert.equal(res.capReached, true);
});

test("a negative delta (net unfollows) counts as stalled", () => {
  const res = checkCapStall({ addedThisCycle: 20, prevActual: 7500, actual: 7495, stallCycles: 0 });
  assert.deepEqual(res, { stallCycles: 1, capReached: false });
});

test("one good cycle after a stall resets the streak", () => {
  const stalled = checkCapStall({ addedThisCycle: 25, prevActual: 7500, actual: 7500, stallCycles: 0 });
  assert.equal(stalled.stallCycles, 1);
  const recovered = checkCapStall({ addedThisCycle: 25, prevActual: 7500, actual: 7524, stallCycles: stalled.stallCycles });
  assert.deepEqual(recovered, { stallCycles: 0, capReached: false });
});
