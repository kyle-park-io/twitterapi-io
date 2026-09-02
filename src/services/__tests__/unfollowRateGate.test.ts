import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUnfollowRate, MIN_RUN_SPACING_MS, DAY_MS } from "../unfollowRateGate";

const NOW = new Date("2026-09-02T12:00:00.000Z");

function agoMinutes(n: number): Date {
  return new Date(NOW.getTime() - n * 60_000);
}

test("an empty history allows the first run", () => {
  assert.deepEqual(checkUnfollowRate({ history: [], perDay: 50, now: NOW }), { allowed: true });
});

test("a run more than 55 minutes after the last unfollow is allowed", () => {
  const gate = checkUnfollowRate({ history: [agoMinutes(56)], perDay: 50, now: NOW });
  assert.equal(gate.allowed, true);
});

test("a second run inside the hour is refused with the next allowed time", () => {
  const last = agoMinutes(20);
  const gate = checkUnfollowRate({ history: [last], perDay: 50, now: NOW });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.match(gate.reason, /once an hour/);
  assert.equal(gate.nextAllowedAt.getTime(), last.getTime() + MIN_RUN_SPACING_MS);
});

test("the spacing check uses the most recent unfollow, not the first", () => {
  const gate = checkUnfollowRate({
    history: [agoMinutes(600), agoMinutes(10), agoMinutes(300)],
    perDay: 50,
    now: NOW,
  });
  assert.equal(gate.allowed, false);
});

test("the daily ceiling refuses once the trailing 24h is full", () => {
  // 9 unfollows every hour for the last 6 hours = 54, over a ceiling of 50.
  const history: Date[] = [];
  for (let hour = 1; hour <= 6; hour++) {
    for (let i = 0; i < 9; i++) history.push(agoMinutes(hour * 60 + i));
  }
  const gate = checkUnfollowRate({ history, perDay: 50, now: NOW });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.match(gate.reason, /Daily unfollow ceiling reached: 54 unfollows/);
  // Refusal clears once enough of the oldest entries age out of the window.
  assert.equal(gate.nextAllowedAt.getTime() > NOW.getTime(), true);
  assert.equal(gate.nextAllowedAt.getTime() < NOW.getTime() + DAY_MS, true);
});

test("unfollows older than 24h do not count toward the daily ceiling", () => {
  const history: Date[] = [];
  for (let i = 0; i < 60; i++) history.push(new Date(NOW.getTime() - DAY_MS - i * 60_000));
  const gate = checkUnfollowRate({ history, perDay: 50, now: NOW });
  assert.equal(gate.allowed, true, "a full day of history that has aged out must not block");
});

test("the daily ceiling is checked before the hourly spacing", () => {
  // Over the ceiling AND recent: the daily message is the accurate one.
  const history: Date[] = [];
  for (let i = 0; i < 50; i++) history.push(agoMinutes(i));
  const gate = checkUnfollowRate({ history, perDay: 50, now: NOW });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.match(gate.reason, /Daily unfollow ceiling/);
});

test("next-allowed time for the daily ceiling is when the surplus ages out", () => {
  const oldest = new Date(NOW.getTime() - 20 * 60 * 60 * 1000);
  const gate = checkUnfollowRate({
    history: [oldest, agoMinutes(600), agoMinutes(120)],
    perDay: 3,
    now: NOW,
  });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.nextAllowedAt.getTime(), oldest.getTime() + DAY_MS);
});
