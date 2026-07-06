# Auto-follow health monitoring — design

**Date:** 2026-07-06
**Status:** Approved

## Problem

The auto-follow tool is about to run unattended under a systemd service. The
dangerous failure is *silent*: the process keeps running and logging, but every
follow fails — the account got banned, the session cookie expired, or X is
blocking follows — and nobody notices for days. Today a failed follow only emits
a `console.error` inside the cycle; the JSONL cycle record shows `addedCount: 0`
with no distinction between "nothing to do" and "tried and everything failed."
There is no way to answer "is it healthy right now?" without reading raw logs.

## Approach

The runner self-assesses each cycle and persists a small health state; a
`follow-status` command reads that state for an at-a-glance verdict; and the loop
prints a loud warning when unhealthy so it stands out in `journalctl`.

**Failure signal (chosen):** *consecutive zero-follow cycles*. When a cycle
actually attempted follows (had candidates to drain) but followed zero, that is
a symptom. N such cycles in a row (default 2, configurable) → unhealthy. A cycle
with no candidates to drain (empty queue and searches found nothing) is "nothing
to do," not a failure — it must NOT trip the counter. Dry-run cycles are
excluded entirely (they never really follow).

Email/remote alerts are intentionally out of scope (YAGNI). The design leaves a
single natural extension point — the moment health flips to unhealthy — so an
alert hook can be added later without reshaping anything.

## Components

### `FollowStore` — health fields (backward-compatible)

Add two persisted fields to the existing `.auth/auto-follow-state.json` (a
missing field loads as its zero value, so old files keep working):

```ts
interface FollowStoreData {
  followed: string[];
  queue: Array<string | Candidate>;
  lastRun: string | null;
  lastSuccessAt?: string | null;      // last time a cycle followed >0 (real)
  consecutiveZeroCycles?: number;     // consecutive attempted-but-followed-0 cycles
}
```

New methods:
- `getLastSuccessAt(): Date | null`
- `setLastSuccessAt(date: Date): void`
- `getConsecutiveZeroCycles(): number`
- `setConsecutiveZeroCycles(n: number): void`

`load()` reads them defaulting to `null` / `0`; `save()` writes them. Existing
fields and methods unchanged.

### `AutoFollowRunner` — self-assessment

`drainQueue()` currently returns `FollowedCandidate[]` (the successes). To judge
"attempted but followed 0," the runner needs the *attempt count*. Change the
real-run path to also surface how many candidates it dequeued (attempted).
Cleanest: `runCycle` reads the dequeue/peek target count. Implementation:
`drainQueue()` returns `{ followed: FollowedCandidate[]; attempted: number }`
where `attempted` is the number of candidates it tried to follow (real run:
`targets.length` from `dequeue`; dry-run: 0, since nothing is really attempted).

In `runCycle()`, after draining, when **not** dry-run:
- if `attempted > 0 && followed.length === 0`: this cycle failed →
  `consecutiveZeroCycles = getConsecutiveZeroCycles() + 1` (persist via setter).
- else if `followed.length > 0`: success →
  `setConsecutiveZeroCycles(0)`, `setLastSuccessAt(finished)`.
- else (`attempted === 0`): nothing to do → leave both counters untouched.

Dry-run: never touch the counters.

`CycleSummary` gains:
```ts
  attempted: number;              // candidates the cycle tried to follow (0 in dry-run)
  followFailures: number;         // attempted - followed.length (real run), 0 in dry-run
  consecutiveZeroCycles: number;  // counter value AFTER this cycle
```
(`addedCount` already exists = successful follows this cycle.)

The `store.save()` at the end of `runCycle` persists the updated health fields
alongside the queue.

### `AutoFollowRunner` — health verdict helper

Add a small pure helper so both the loop and `follow-status` compute "healthy?"
the same way, without duplicating the rule:

```ts
export function isUnhealthy(consecutiveZeroCycles: number, threshold: number): boolean {
  return consecutiveZeroCycles >= threshold;
}
```

`threshold` comes from config (`unhealthyAfterZeroCycles`, default 2).

### `auto-follow.ts` — loud warning

After appending the cycle's JSONL record, if `!summary.dryRun` and
`isUnhealthy(summary.consecutiveZeroCycles, config.unhealthyAfterZeroCycles)`,
print a prominent multi-line warning to stderr:

```
⚠️⚠️⚠️  UNHEALTHY: 3 consecutive cycles followed 0 of N attempted.
        Last success: 2026-07-05T22:10:00.000Z.
        The account may be banned, the session may have expired, or X may be
        blocking follows. Check with: pnpm follow-status
```

This is the extension point where an email/remote alert would later hook in.

### `follow-status.ts` (new) — at-a-glance verdict

`pnpm follow-status`. Reads ONLY local files (no API call), so it is always safe
and instant:
1. Load `FollowStore` from the state path (`loadAutoFollowConfig().statePath`;
   but that requires env — instead resolve the state path the same way
   `import-session` resolves the session path: read `TWITTERAPI_IO_KEY` is not
   even needed. Decided: compute `statePath` locally as
   `path.join(process.cwd(), ".auth", "auto-follow-state.json")`, matching
   `config.ts`, so `follow-status` needs NO env vars at all.)
2. Read `unhealthyAfterZeroCycles` from `config/auto-follow.json` directly
   (default 2 if absent) — no env needed.
3. Read the last few cycle records from `output/auto-follow-log.jsonl` (if it
   exists) for a recent-cycles sparkline; tolerate a missing file.
4. Print:

```
Auto-follow status: ⚠️ UNHEALTHY        (or ✅ HEALTHY)
  Last run:        2026-07-06T04:03:00Z (12 min ago)
  Last success:    2026-07-05T22:10:00Z (6 h ago)
  Consecutive zero-follow cycles: 3 (threshold 2)
  Followed (local): 6    Queue: 55
  Recent cycles (added): +5 +0 +0 +0
```

Missing state file → print "No state yet — has the tool run?" and exit 0
(not an error; it just hasn't run). Relative-time formatting is a small local
helper.

### Config

`config/auto-follow.json` gains `"unhealthyAfterZeroCycles": 2`.
`AutoFollowConfig` gains `unhealthyAfterZeroCycles: number`; `loadAutoFollowConfig`
resolves it via the existing `pick(json, flag, default=2)` pattern, with a
`--unhealthy-after <n>` flag for consistency with the other tunables.

### Changed / new files

- `src/services/FollowStore.ts` — health fields + accessors.
- `src/services/AutoFollowRunner.ts` — `drainQueue` returns attempted count;
  `runCycle` updates health state; `CycleSummary` new fields; `isUnhealthy` helper.
- `src/examples/auto-follow.ts` — loud unhealthy warning.
- `src/examples/follow-status.ts` — new command.
- `src/config.ts` — `unhealthyAfterZeroCycles` field + flag.
- `config/auto-follow.json` — `unhealthyAfterZeroCycles: 2`.
- `package.json` — `follow-status` script.
- `README.md` — document health monitoring + `follow-status`.
- Tests: `FollowStore.test.ts` (health field round-trip, defaults for old files),
  `AutoFollowRunner.test.ts` (counter increments on attempted-but-0, resets on
  success, untouched when nothing to do, untouched in dry-run; `isUnhealthy`).

## Data flow

```
cycle drains queue → {followed, attempted}
  runCycle (real run):
    attempted>0 && followed==0 → consecutiveZeroCycles++
    followed>0               → consecutiveZeroCycles=0, lastSuccessAt=now
    attempted==0             → unchanged
  store.save() persists health fields
  summary {addedCount, attempted, followFailures, consecutiveZeroCycles}
       └─ auto-follow.ts: JSONL line + (if unhealthy) loud stderr warning

pnpm follow-status  (local files only, no API)
  └─ FollowStore state + config threshold + recent JSONL
       └─ ✅ HEALTHY / ⚠️ UNHEALTHY summary
```

## Error handling

- `follow-status` with no state file → friendly "hasn't run yet" message, exit 0.
- `follow-status` with an unreadable/partial JSONL → skip the sparkline, still
  print the state-based verdict (JSONL is best-effort decoration).
- Health-field persistence rides on the existing `store.save()`; a save failure
  is already handled by the loop's existing try/catch around the cycle.
- The loud warning is stderr `console.error`; it never throws.

## Testing

- `FollowStore`: old file without health fields loads → `getLastSuccessAt()` null,
  `getConsecutiveZeroCycles()` 0; set + save + reload round-trips both.
- `AutoFollowRunner` (with injected `now`, fake source, recording follower):
  - real cycle, candidates present, follower throws for all → `attempted>0`,
    `addedCount 0`, `consecutiveZeroCycles` increments and persists.
  - real cycle with a success → counter resets to 0, `lastSuccessAt` set.
  - real cycle with empty queue and empty search → counter untouched.
  - dry-run cycle → counters untouched regardless.
  - `summary.followFailures === attempted - addedCount` on a partial-failure cycle.
  - `isUnhealthy(2,2) === true`, `isUnhealthy(1,2) === false`.
- No tests for `follow-status.ts` / the loop warning (I/O shells), but they must
  compile and not break the suite.

## Security / privacy notes

`follow-status` reads only local git-ignored files and makes no network call; it
needs no credentials. No secrets are logged. The health fields contain only
timestamps and a counter.
