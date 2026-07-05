# X Keyword-Driven Auto-Follow (Playwright) — Design Spec

**Date:** 2026-07-06

## v2 Revision (2026-07-06) — random-keyword sampling + candidate queue

The v1 design below searched **all** keywords every cycle, collected far more
candidates than `maxPerRun`, followed 25, and discarded the rest — the discarded
candidates never came back (the `since:` filter excluded them next cycle). That is
wasteful: dozens of searches per cycle to follow only 25 people, most search results
thrown away.

**v2 changes (this is what is implemented):**

1. **Candidate queue.** `FollowStore` gains a persisted queue of pending usernames.
   Search *fills* the queue; follow *drains* it. Nothing found is discarded.
2. **Random keyword sampling.** Each cycle picks `keywordsPerCycle` (default 3) keywords
   at random instead of scanning all 36. If the queue is still below `maxPerRun` after
   searching those, it samples another batch and searches again, repeating until the
   queue reaches `maxPerRun` or all keywords are exhausted this cycle.
3. **No `since:` filter.** Removed. Each search fetches the latest popular tweets;
   duplicates are prevented by the queue + followed-set (a username already followed or
   already queued is skipped). `getLastRun`/`setLastRun` are no longer needed for the
   query but the timestamp may remain for informational logging.
4. **Cycle = fill-then-drain.** One cycle: top up the queue via sampled searches (only if
   short), then follow up to `maxPerRun` from the queue, removing each followed user from
   the queue. Search and follow stay in one process/loop (not split).

**Effect:** search calls drop from ~36–72/cycle to ~3–9/cycle (3 keywords × 1–2 pages,
occasionally another batch), with zero wasted candidates.

New config field: `keywordsPerCycle` (default 3). `perKeyword` still caps tweets scanned
per sampled keyword.

Everything below is the v1 design, kept for context; where it conflicts with this v2
section (the `since:` filter, "scan all keywords", discard-extras), **v2 governs.**

## Overview

A long-running automation that periodically searches X/Twitter for tweets matching a
configured set of keywords, collects the authors of those tweets, and follows them
through a real browser session driven by Playwright (not the twitterapi.io write API).

Tweet discovery reuses the existing twitterapi.io `advancedSearch` (read-only, via
`x-api-key`). The follow action itself is performed by automating a logged-in X web
session, because the user wants follows to originate from a genuine browser rather than
the API.

The loop runs continuously (default: one cycle per hour) until stopped. It is safe by
default: `dryRun` is on, so a first run reports who *would* be followed without taking
any action.

All code follows the existing project's SOLID conventions: services depend on
interfaces, each service owns one responsibility, and examples orchestrate services.

---

## Goals / Non-Goals

**Goals**
- Search a configurable keyword list on a recurring interval.
- Follow the authors of matching tweets via a browser (Playwright).
- Never re-follow someone already followed (persistent record).
- Avoid re-scanning tweets already seen (time-window filter).
- Stay within X follow rate limits (per-cycle cap + randomized delay).

**Non-Goals**
- Unfollowing, follow-churn, or follower-count inflation (violates X rules).
- Following via the twitterapi.io write API (`WriteService.followUser` stays as-is,
  unused by this feature).
- Any engagement beyond follow (no auto-like/reply/DM).

---

## Configuration

Config lives in `config/auto-follow.json` (committed, editable). Resolution order for
each runtime parameter: **JSON value → CLI flag → built-in default.** (Per the user's
preference, a value present in the JSON wins; flags fill in only what the JSON omits.)

```jsonc
{
  "keywords": [ "...", "..." ],   // X advanced-search queries (min_faves filters, ko + en)
  "queryType": "Latest",          // advancedSearch sort
  "intervalMinutes": 60,          // gap between cycles
  "perKeyword": 30,               // max tweets scanned per keyword per cycle
  "maxPerRun": 25,                // max follows performed per cycle (rate-limit guard)
  "dryRun": true                  // when true, report targets but do not follow
}
```

The keyword list is the current committed list (26 queries: AI-agent, Claude/MCP,
AI+crypto, crypto-infra, and yapping/attention themes; English with higher `min_faves`,
Korean with lower `min_faves` to match lower volume).

CLI flags mirror the tunable fields and override *only when the JSON omits them*:
`--interval <min>`, `--per-keyword <n>`, `--max <n>`, `--dry-run` / `--no-dry-run`.

---

## Components

```
examples/auto-follow.ts          ← loop orchestration (the runnable entry point)
        ↓
services/AutoFollowRunner.ts     ← one cycle: search → dedupe → filter → follow
        ↓                    ↓                         ↓
TweetService.advancedSearch  FollowStore              BrowserFollowService
(existing, reused)           (new, persistence)       (new, Playwright)
```

### `config.ts` — `loadAutoFollowConfig(argv)`

Adds an `AutoFollowConfig` interface and loader. Reads `config/auto-follow.json`, parses
CLI flags, and merges them (JSON → flag → default). Reuses `requireEnv` for
`TWITTERAPI_IO_KEY` and the `X_*` write vars (needed for browser login). Single
responsibility: turn files + argv + env into one validated config object.

### `services/FollowStore.ts` — persistence

Owns the on-disk record. Two responsibilities kept minimal and cohesive:
- **Followed set**: user IDs (and usernames, for readability) already followed.
- **Last-run timestamp**: ISO time of the last completed cycle, used to build the
  `since:` filter so the next cycle only scans newer tweets.

Stored as a single git-ignored JSON file at `.auth/auto-follow-state.json` — a dedicated
folder (alongside the saved browser session), not `output/`, so a user clearing `output/`
cannot wipe the followed-set and cause re-follows. API: `has(userId)`, `add(user)`,
`getLastRun()`, `setLastRun(date)`, `save()`. Reads once on construction, writes after
each cycle.

### `services/BrowserFollowService.ts` — Playwright

Owns everything browser-related, isolated from the rest so the follow *mechanism* can
change without touching orchestration:
- `login()`: reuse a saved `storageState` (cookies) if present and still valid;
  otherwise perform an automated login with `X_USER` / `X_PASSWORD` (`X_TOTP` if set),
  then persist `storageState` to a git-ignored path for reuse.
- `follow(username)`: navigate to `x.com/<username>`, click the Follow button, verify
  the state changed to "Following", handle the already-following case idempotently.
- `close()`: tear down the browser.

Depends only on Playwright + the `X_*` config — no knowledge of keywords, search, or the
store. Login happens once per process and the context is reused across cycles.

### `services/AutoFollowRunner.ts` — one cycle

Pure orchestration of a single cycle, so the loop in the example stays trivial and the
cycle is independently testable:
1. Build `since:` from `FollowStore.getLastRun()`.
2. For each keyword, pull up to `perKeyword` tweets from `TweetService.advancedSearch`,
   appending `since:<lastRun>` to the query.
3. Collect authors → dedupe by user ID → drop anyone in `FollowStore` → take first
   `maxPerRun`.
4. For each remaining author: if `dryRun`, log the target; else
   `BrowserFollowService.follow(username)` with a randomized delay (30–90s) between
   follows, then `FollowStore.add`.
5. `FollowStore.setLastRun(now)` and `save()`. Return a summary (scanned, candidates,
   followed).

### `examples/auto-follow.ts` — entry point + loop

Loads config, constructs the client + services, then runs cycles forever: run one cycle,
log its summary, `await sleep(intervalMinutes)`, repeat. Handles SIGINT to close the
browser cleanly (matching `menu.ts`'s cleanup pattern). Registered as
`pnpm example:auto-follow`.

---

## Data Flow (one cycle)

```
lastRun ─┐
         ▼
keywords ──► advancedSearch(q + since:lastRun, perKeyword)
         ──► authors ──► dedupe(by id) ──► exclude(FollowStore) ──► take(maxPerRun)
                                                                        │
                             dryRun? ──yes──► log targets ◄─────────────┤
                                └──no──► BrowserFollowService.follow ─── delay 30–90s
                                                                        │
                                                                        ▼
                                                      FollowStore.add + setLastRun + save
```

---

## SOLID Application

| Principle | How it is applied |
|---|---|
| **SRP** | `FollowStore` = persistence only; `BrowserFollowService` = browser only; `AutoFollowRunner` = one cycle's orchestration; `config.ts` = config assembly |
| **OCP** | Follow mechanism is behind `BrowserFollowService`; swapping to the API `WriteService` later means a new implementer, not edits to the runner |
| **LSP** | Runner depends on a narrow follow interface any follower (browser or API) satisfies |
| **ISP** | Runner needs only `follow(username)`; it does not see login/session details |
| **DIP** | `AutoFollowRunner` depends on abstractions (a follower interface, the store, `TweetService`), not concrete Playwright code |

To honor OCP/DIP concretely, define a small `IFollower { follow(username): Promise<void> }`
interface (mirroring the existing `IHttpClient` pattern); `BrowserFollowService`
implements it and the runner depends on it.

---

## Error Handling

- **Login failure**: throw with a clear message; the loop logs and retries next cycle
  (transient) but aborts on repeated auth failure to avoid triggering X lockouts.
- **Follow failure on one user**: catch per-user, log, skip, continue the cycle — one bad
  target must not abort the batch.
- **Search failure on one keyword**: catch per-keyword, log, continue other keywords.
- **State file**: written after each cycle so a crash loses at most the current cycle;
  malformed/missing file starts from empty state (first-run behavior).

---

## Safety & Rate Limits

- `dryRun: true` by default — first run performs zero follows.
- `maxPerRun: 25` per cycle; with `intervalMinutes: 60` that is ≤600/day, under the
  Premium 1,000/day cap.
- Randomized 30–90s delay between follows avoids the "40 follows / 10 minutes" soft cap.
- Session reuse avoids repeated logins (which themselves look automated).
- The tool never unfollows, preventing follow-churn violations.

---

## New Dependencies & Ignore Rules

- Add `playwright` to `dependencies`; `npx playwright install chromium` documented in
  README setup.
- `.gitignore`: add `.auth/` (holds both the browser `storageState` and the
  follow-state JSON).
- `package.json`: add `"example:auto-follow": "ts-node src/examples/auto-follow.ts"`.
- README: document `pnpm example:auto-follow`, the config file, dry-run, and the
  one-time `playwright install` + first manual/automated login step.

---

## Testing

- **FollowStore**: unit-test `has`/`add`/`getLastRun`/`setLastRun` with a temp file
  (round-trip, missing-file, malformed-file cases).
- **AutoFollowRunner**: unit-test the cycle with a fake `TweetService`, an in-memory
  `FollowStore`, and a fake `IFollower` — assert dedupe, exclusion, `maxPerRun` cap, and
  `dryRun` (no follow calls). No network, no browser.
- **BrowserFollowService**: not unit-tested against live X; verified manually via a
  single dry→live run. Kept thin so the untested surface is small.
