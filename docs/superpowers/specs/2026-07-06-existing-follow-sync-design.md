# Existing-follow sync + follow-result reporting — design

**Date:** 2026-07-06
**Status:** Approved

## Problem

The auto-follow tool only knows accounts *it* followed; it has no idea who the
user already follows (manually or from before). Two consequences:

1. **Wasted work.** An already-followed account (e.g. `@AvalancheKorea`, which
   the user likely followed by hand) still gets queued, visited, and its
   inter-follow delay spent — only for `follow()` to find the profile already in
   the "Following" state and no-op.
2. **Ambiguous logs.** `follow()` returns `void`; whether it actually clicked
   Follow or skipped because it was already following is indistinguishable — both
   log `Followed @X`. This is why it was unclear whether `@AvalancheKorea` was a
   new follow or a pre-existing one.

## Approach

Two complementary changes:

1. **Sync existing follows at startup.** After login, pull the account's real
   following list via the read API and merge every handle into the followed-set.
   `FollowStore.enqueue` already skips anyone in the followed-set, so
   already-followed accounts stop entering the queue. The sync is a best-effort
   optimization: if it fails or only partially loads, log a warning and start
   the loop anyway (fall back to prior behavior — a redundant follow attempt is a
   harmless no-op).
2. **Report the follow result.** `follow()` returns whether it actually followed
   or found the account already-following, so the loop can log and count them
   separately, and health assessment can treat "already following" correctly
   (the session is clearly alive — not a failure).

## Components

### `IFollower` / `BrowserFollowService` — follow result

```ts
// src/follow/IFollower.ts
export type FollowResult = "followed" | "already-following";
export interface IFollower {
  follow(username: string): Promise<FollowResult>;
}
```

`BrowserFollowService.follow` returns the result from its existing branch — no
new logic, just a return value:
- If the `Follow @<user>` button was visible → clicked → confirmed flip → return
  `"followed"`.
- Otherwise (the followed-state button was already showing) → return
  `"already-following"`.

A genuine failure (neither button rendered, click didn't confirm) still throws,
as today.

### `AutoFollowRunner` — branch on result, count separately

`drainQueue`'s real-run loop uses the returned result:
```ts
const result = await this.follower.follow(c.userName);
this.store.add(c.userName);
if (result === "followed") {
  followed.push(toCandidate(c));
  console.log(`Followed @${c.userName}`);
} else {
  alreadyFollowing++;
  console.log(`Already following @${c.userName}`);
}
```
`drainQueue` returns `{ followed, attempted, alreadyFollowing }`.
(Dry-run unchanged: it peeks and reports would-follow candidates;
`alreadyFollowing` is 0.)

`CycleSummary` gains `alreadyFollowing: number`. `addedCount` stays defined as
`followed.length` — i.e. **only genuinely new follows**, so a cycle that merely
re-confirms existing follows reports `addedCount: 0` (correct — nothing new
happened) but is NOT treated as unhealthy (below).

### Health assessment adjustment (the subtle part)

Current rule (real run): `followed.length > 0` → reset counter + set
lastSuccessAt; else if `attempted > 0` → increment consecutiveZeroCycles; else
untouched.

Problem: with `addedCount` now excluding already-following, a cycle where every
dequeued candidate was already followed would have `followed.length === 0` and
`attempted > 0`, wrongly incrementing the unhealthy counter — even though the
session is plainly working (it successfully read those profiles as
already-following).

New rule (real run):
- `followed.length > 0` → reset counter, set lastSuccessAt (a real new follow
  landed).
- else if `alreadyFollowing > 0` → the session works (we confirmed existing
  follows); reset counter, set lastSuccessAt. Not a failure.
- else if `attempted > 0` → tried to follow, got neither a new follow nor an
  already-following confirmation (all threw) → increment consecutiveZeroCycles.
- else (`attempted === 0`) → nothing to do → untouched.

So "unhealthy" now means specifically: attempted follows, and every one *failed*
(threw) — not merely "no new follow this cycle."

### `auto-follow.ts` — startup sync + UserService + logging

Add `UserService` (one line: `new UserService(client)` — `client` already
exists). After `follower.login()` and before the interval-respect wait, run a
best-effort sync:

```ts
async function syncFollowing(users, store, xUser): Promise<number> {
  let n = 0;
  for await (const f of users.getFollowings(xUser)) {
    store.add(f.userName);
    n++;
  }
  store.save();
  return n;
}
// ...
if (!config.dryRun) {
  await follower.login();
  try {
    const n = await syncFollowing(users, store, config.xUser);
    console.log(`Synced ${n} existing follows from X.`);
  } catch (err) {
    console.error(
      `Following sync failed (continuing anyway): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
```

The cycle-done log line gains the already-following count:
`Cycle done — scanned N, queued M, followed K, already-following J`.

### Changed / new files

- `src/follow/IFollower.ts` — `FollowResult` type; `follow` returns it.
- `src/services/BrowserFollowService.ts` — `follow` returns `FollowResult`.
- `src/services/AutoFollowRunner.ts` — `drainQueue` result branch +
  `alreadyFollowing`; `CycleSummary.alreadyFollowing`; adjusted health rule.
- `src/examples/auto-follow.ts` — `UserService`, `syncFollowing`, cycle log line.
- Tests: `AutoFollowRunner.test.ts` — the `recordingFollower`/`failingFollower`
  helpers return a `FollowResult`; a new follower stub returning
  `"already-following"`; tests for the count split and the health rule
  (already-following keeps healthy; all-throw increments). The only `IFollower`
  implementations are `BrowserFollowService` (production) and the two test stubs
  above — `WriteService`/cli do not implement `IFollower`, so nothing else needs
  updating.

## Data flow

```
startup: login → getFollowings(xUser) → store.add(each) → store.save()
  (fail → warn, continue)
cycle: fillQueue (enqueue skips already-followed) → drainQueue
   per candidate: follow() → "followed"  → followed[], addedCount
                          → "already-following" → alreadyFollowing++
   health: followed>0 OR alreadyFollowing>0 → healthy; all-throw → unhealthy
   summary {addedCount, alreadyFollowing, ...} → JSONL
```

## Error handling

- Sync failure (API error, partial page) → caught in `auto-follow.ts`, logged,
  loop proceeds. `syncFollowing` itself may throw mid-iteration; the caller's
  try/catch covers it. Whatever was added before the throw stays (harmless).
- `follow()` throwing (real failure) is caught in `drainQueue` as today →
  `Follow failed` log, candidate dropped, counted in neither `followed` nor
  `alreadyFollowing`.
- Existing queue/health/verified-filter behavior otherwise unchanged.

## Testing

- `AutoFollowRunner`: fakeFollower variants returning `"followed"` /
  `"already-following"` / throwing.
  - all-`followed` cycle → `addedCount === n`, `alreadyFollowing === 0`, counter
    reset, lastSuccessAt set.
  - all-`already-following` cycle → `addedCount === 0`, `alreadyFollowing === n`,
    counter reset (healthy), lastSuccessAt set.
  - all-throw cycle (attempted>0) → `addedCount === 0`, `alreadyFollowing === 0`,
    counter incremented.
  - mixed → counts split correctly; `summary.followed` holds only the
    genuinely-followed.
- No unit test for `syncFollowing`/loop wiring (I/O shell); must compile and not
  break the suite. End-to-end sync verified manually by running once and
  confirming already-followed accounts stop being queued.

## Security / privacy notes

`getFollowings` uses the read API key already in use; the following list stays
local (in `.auth/`, git-ignored). No credentials logged.
