# Follow-run reporting — design

**Date:** 2026-07-06
**Status:** Approved

## Problem

The auto-follow tool follows people but keeps no durable, structured record of
what it did. Today the only trace is: console logs (lost when the process
ends), and `.auth/auto-follow-state.json` (a flat `followed` username array + a
`queue` of usernames + `lastRun`). There is no per-cycle report — no start/end
time, no before/after follow counts, no per-followed profile link, display
name, or the keyword that surfaced them. The user wants a persistent, per-cycle
log with those fields, plus an occasional check of the account's *actual*
following count to confirm follows are landing.

## Approach

Three coordinated changes:

1. **Queue candidates carry metadata** (backward-compatible). Each queued
   candidate becomes `{ userName, name?, keyword? }` instead of a bare string.
   Old string entries still load (they just lack `name`/`keyword`), so the
   current on-disk queue (61 usernames) keeps working.

2. **Per-cycle JSONL report.** `runCycle()` returns an enriched summary
   (timing, before/after counts, per-followed metadata). The example loop
   appends one JSON object per cycle to `output/auto-follow-log.jsonl`.

3. **Separate audit command** (`pnpm follow-audit`). Run manually (e.g. once or
   twice a day). It looks up the account's real `following` count via
   twitterapi.io and appends an audit record to the same JSONL. The real count
   is a *reference* — the user also follows/unfollows by hand, so an approximate
   match (local followed-count ≈ actual following-count, within some drift)
   confirms the tool is working, not an exact equality check.

### Rejected alternatives

- **JSON array file** (rewrite whole file each cycle): more fragile, no
  append-only durability. JSONL chosen.
- **Auditing every cycle**: wastes API calls; the count barely moves per cycle
  and the user edits follows by hand anyway. Manual/occasional audit chosen.
- **Auditing inside the loop every N cycles**: complicates the loop; a separate
  command keeps the loop simple and the audit on the user's schedule.

## Components

### `FollowStore` — candidate metadata (backward-compatible)

New exported type:

```ts
export interface Candidate {
  userName: string;
  name?: string;
  keyword?: string;
}
```

On-disk `queue` becomes `Array<string | Candidate>`. On `load()`, normalize
every entry to a `Candidate` via `typeof item === "string" ? { userName: item }
: item`. Internally the queue is `Candidate[]`; `save()` always writes the
object form. Dedupe key stays `userName.toLowerCase()`.

Method changes:
- `enqueue(userName: string, meta?: { name?: string; keyword?: string }): void`
  — unchanged dedupe (skip if followed or queued); stores
  `{ userName, ...meta }`.
- `peek(n): Candidate[]` — returns candidate objects (was `string[]`).
- `dequeue(n): Candidate[]` — returns candidate objects (was `string[]`).
- `has`, `add`, `isQueued`, `queueSize`, `getLastRun`, `setLastRun` unchanged.
- New: `followedCount(): number` — returns `this.followed.size`, for
  before/after reporting.

`AutoFollowRunner` is the only consumer of `peek`/`dequeue`; it is updated in
lockstep (below), so the return-type change is contained.

### `AutoFollowRunner` — enriched summary

`CycleSummary` becomes:

```ts
export interface FollowedCandidate {
  userName: string;
  name?: string;
  url: string;        // `https://x.com/${userName}`
  keyword?: string;
}

export interface CycleSummary {
  startedAt: string;          // ISO
  finishedAt: string;         // ISO
  durationMs: number;
  scanned: number;
  queued: number;
  followedCountBefore: number;
  followedCountAfter: number;
  addedCount: number;         // followed.length (real) — how many newly followed this cycle
  followed: FollowedCandidate[];
  dryRun: boolean;
}
```

- `runCycle()` records `startedAt` (via injected `now()`), reads
  `store.followedCount()` as `followedCountBefore`, runs fill+drain, then reads
  `followedCountAfter`, computes `durationMs`, sets `finishedAt`.
- `fillQueue()` passes metadata when enqueuing: from the search tweet it has
  `tweet.author?.userName` and `tweet.author?.name`, plus the loop's current
  `keyword`. So `enqueue(userName, { name, keyword })`.
- `drainQueue()` works on `Candidate[]` from `peek`/`dequeue`. For each, build a
  `FollowedCandidate { userName, name, url: https://x.com/${userName}, keyword }`.
  In dry-run, `followed` is the peeked candidates mapped to `FollowedCandidate`
  (nothing actually followed); `addedCount` is 0 in dry-run (no real follows),
  and before/after counts are equal.
- Existing behavior preserved: dry-run peeks (no queue consumption), real run
  dequeues + delays + records to followed-set + drops failures.

### `auto-follow.ts` — JSONL append

After each `runCycle()`, append `JSON.stringify(summary)` + `"\n"` to
`output/auto-follow-log.jsonl` (mkdir `output/` if needed; it is git-ignored).
Keep the existing console line. On dry-run the record still appends (useful to
see what *would* happen), with `dryRun: true`.

### `follow-audit.ts` (new) — reference count check

```
pnpm follow-audit
```

1. `loadAutoFollowConfig()` for `apiKey`, `xUser`, `statePath` — but `xUser`
   needs env. Since audit needs the account handle, read it from the config's
   `xUser` (already required by `loadAutoFollowConfig`). If we want audit to run
   without write creds, resolve `xUser` from `process.env["X_USER"]` directly
   and `apiKey` from `TWITTERAPI_IO_KEY`, mirroring how the read examples build
   a client — decided: use `loadConfig()` for `apiKey` and read `X_USER` from
   env directly, so audit needs only the read API key + the handle, not the
   browser/login creds.
2. Build `UserService` (`new UserService(new TwitterClient(apiKey))`), call
   `getUserInfo(xUser)` → `following`.
3. Load `FollowStore` for `followedCount()` (local tally).
4. Append an audit record to `output/auto-follow-log.jsonl`:
   ```json
   {
     "type": "audit",
     "at": "2026-07-06T...",
     "account": "bcd_kyle",
     "localFollowedCount": 6,
     "actualFollowingCount": 342,
     "note": "reference only — includes manual follows/unfollows"
   }
   ```
5. Print a one-line human summary (`local=6 actual=342`).

Cycle records have no `type` field (or `type: "cycle"`); audit records carry
`type: "audit"`. A reader distinguishes them by `type`. Decided: give cycle
records `type: "cycle"` explicitly so every JSONL line is self-describing.

### Changed / new files

- `src/services/FollowStore.ts` — Candidate type, normalization, `enqueue` meta,
  `peek`/`dequeue` return `Candidate[]`, `followedCount()`.
- `src/services/AutoFollowRunner.ts` — enriched `CycleSummary`, metadata on
  enqueue, `FollowedCandidate` mapping, timing + before/after counts.
- `src/examples/auto-follow.ts` — JSONL append; add `type: "cycle"`.
- `src/examples/follow-audit.ts` — new audit command.
- `package.json` — `"follow-audit"` script.
- `README.md` — document the JSONL log location/fields and `follow-audit`.
- Tests: `FollowStore.test.ts` (backward-compat load of string+object queue,
  meta round-trip, `followedCount`, `peek`/`dequeue` shape) and
  `AutoFollowRunner.test.ts` (summary fields, before/after counts, metadata
  propagation, dry-run addedCount=0) updated/extended.

## Data flow

```
search tweet {author:{userName,name}} + current keyword
  └─ store.enqueue(userName, {name, keyword})  → queue: Candidate[]
       └─ drainQueue: dequeue Candidate[]
            ├─ follower.follow(userName)  (real)
            ├─ store.add(userName)
            └─ FollowedCandidate {userName,name,url,keyword}
  runCycle → CycleSummary {timing, before/after, followed[]}
       └─ auto-follow.ts appends JSONL line {type:"cycle", ...summary}

pnpm follow-audit (manual, occasional)
  └─ UserService.getUserInfo(X_USER).following (actual)
       + FollowStore.followedCount() (local)
       └─ appends JSONL line {type:"audit", localFollowedCount, actualFollowingCount}
```

## Error handling

- JSONL append failure: log the error but do NOT crash the follow loop — the
  follows already happened; a lost log line must not stop future cycles.
- `follow-audit` API failure: print the error and exit 1 (nothing was written).
- Missing `X_USER` for audit: exit 1 with a clear message.
- Backward-compat: a malformed queue entry (neither string nor object with
  `userName`) is skipped on load, not fatal.

## Testing

- `FollowStore`: load a queue mixing `"alice"` and `{userName:"bob",name:"Bob",
  keyword:"AI"}` → both normalize to Candidates; `peek`/`dequeue` return objects;
  `enqueue("carol",{name:"Carol",keyword:"crypto"})` round-trips through
  `save`/`load`; `followedCount()` matches adds; dedupe still by lowercased
  userName across string and object forms.
- `AutoFollowRunner`: with injected `now`, `pickKeywords`, and a fake source
  emitting authored tweets, assert the summary has correct `scanned/queued`,
  `followedCountBefore/After`, `addedCount`, per-`followed` `url` and `keyword`,
  and that dry-run yields `addedCount:0` with equal before/after counts and no
  queue consumption.
- No test for the JSONL file-append glue or the audit script (I/O shells,
  consistent with other `examples/`), but both must compile and not break the
  suite.

## Security / privacy notes

`output/` is git-ignored; the JSONL may contain followed usernames/display
names but no credentials. The audit hits only the read API with
`TWITTERAPI_IO_KEY`. No cookie or password values are ever written to the log.
