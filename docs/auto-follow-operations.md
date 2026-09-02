# Auto-Follow — Operations & Configuration Guide

How the keyword-search → browser-follow loop is configured, run unattended, and
maintained. This is the single reference for day-to-day operation; the README
has the quick start, and `docs/superpowers/specs/` has the per-feature design
history.

## What it does

Every cycle the loop:

1. Samples a few keywords from `config/auto-follow.json` at random and searches
   them via the twitterapi.io read API.
2. Filters the tweet authors by verification tier and skips anyone already
   followed, queuing the rest as candidates.
3. Follows up to `maxPerRun` queued candidates through a real Playwright browser
   session, then sleeps `intervalMinutes` and repeats.

State (followed set, pending queue, health counters, last following-sync time)
lives in `.auth/auto-follow-state.json`; a per-cycle report is appended to
`output/auto-follow-log.jsonl`. Both are git-ignored.

On startup the loop merges the account's real following list into the followed
set (a read-API call that pages the whole list) so already-followed accounts are
not re-queued. This sync is **throttled to once every 2 days** across restarts,
so frequent restarts (config changes, reboots) don't each re-page the list. A
follow made by hand in between is caught on the next sync and is harmless until
then — the browser sees the existing follow and reports "already-following".

## Configuration — `config/auto-follow.json`

A value set in the JSON **wins over the matching CLI flag**; flags only fill in
fields the JSON omits. The shipped config sets every tunable, so tune behaviour
by editing the JSON. Defaults below are the code defaults (`src/config.ts`), used
only when a field is absent from the JSON.

| Field | Default | What it does | When to change |
|---|---|---|---|
| `keywords` | (list) | Search terms, one per entry, with X advanced-search operators like `min_faves:N` (minimum likes). Grouped by theme with blank-line separators. | Add keywords to widen the candidate pool (see *Candidate depletion*). |
| `queryType` | `"Latest"` | X search sort: `Latest` (chronological) or `Top` (algorithmic). | Rarely. `Latest` surfaces fresh accounts. |
| `intervalMinutes` | `60` | Minutes to sleep **after** a cycle finishes before the next one. | Raise to follow more slowly / cut API use; lower to follow faster (watch rate limits). |
| `perKeyword` | `30` | Max tweets scanned per sampled keyword. | Raise to pull more candidates per keyword per cycle. |
| `keywordsPerCycle` | `3` | Keywords sampled per search batch. The loop keeps sampling batches until the queue is full enough or keywords run out. | Raise to fill the queue with fewer, larger batches. |
| `maxPerRun` | `25` | Max follows per cycle, and the queue top-up target. | This is the throttle. 25/cycle ≈ safe. |
| `unhealthyAfterZeroCycles` | `2` | Consecutive real cycles that attempted follows but landed none before the loop logs a loud `⚠️ UNHEALTHY` warning. | Raise to be less noisy, lower to alert sooner. |
| `maxFollowers` | `500000` | Follower-count ceiling for intake: a search candidate with more followers than this is rejected before enqueueing, even if it's otherwise unfollowed and unscored. | Lower to keep intake to smaller/niche accounts; raise to let large accounts back into intake. |
| `unfollowPerRun` | `9` | Max unfollows attempted per `follow-cleanup --run` invocation. | This is the cleanup throttle — see *Cleanup operations* below before raising it. |
| `unfollowPerDay` | `50` | Target daily unfollow pace for a cleanup pass, meant to rise to `100` after the first two days. Not enforced by any rate limiter in code — `follow-cleanup --run` only reads `unfollowPerRun`; hitting this cap means pacing how often you invoke `--run` yourself. | Don't raise without re-reading `docs/follow-unfollow-limits-2026-09.md` — unlike the follow rate, no measured safe unfollow rate exists. |
| `allowedVerified` | `["blue","legacy","business","government"]` | Verification tiers to follow: `blue` (X Premium), `legacy` (old verified), `business` (gold org), `government` (grey org). Empty `[]` = filter off (follow everyone). | `["blue"]` for Premium-only; `[]` to disable the filter. Unknown tier names are dropped with a warning. |
| `dryRun` | `true` (code default) | `true` reports would-follow/would-unfollow targets without acting and logs cycles; `false` actually follows (loop) or unfollows (`follow-cleanup --run`). The committed config keeps `true` as a safe default. **The running service has been on `dryRun: true` since 2026-07-29 and has issued no real follow since** — it only logs would-follow cycles. | Set `false` locally to actually follow or unfollow. Never commit `false`. |

### Effective follow rate

A cycle takes ~25 min (25 follows × a randomised 30–90 s delay between each), then
sleeps `intervalMinutes`. So the real period is ~85 min, i.e. **~25 follows per
~85 min ≈ ~18/hour ≈ ~350–430/day** at defaults — comfortably under X's soft
limits (~40–50/hour) and Premium's ~1000/day cap.

## Commands

All read the same config and state. Run from the repo root.

| Command | Purpose | Network |
|---|---|---|
| `pnpm import-session` | One-time: import the X session from cookies (`X_AUTH_TOKEN`/`X_CT0` in `.env`) into `.auth/x-session.json`. Re-run when the session expires. | Read API + headless verify |
| `pnpm example:auto-follow` | Run the follow loop in the foreground. Normally run via systemd (below), not by hand. | Browser + read API |
| `pnpm follow-status` | At-a-glance health: HEALTHY/UNHEALTHY, last run/success (KST), followed/queue counts, recent cycles. Local files only — safe anytime. | None |
| `pnpm follow-audit` | Append an audit record comparing the tool's local followed count with the account's real X following count. Run occasionally (a systemd timer does it daily). | Read API |
| `pnpm follow-cleanup --scan` | Page the account's whole following list, score every account, write `output/cleanup-targets.json`. Strictly read-only — never touches `.auth/auto-follow-state.json`, never opens a browser. | Read API |
| `pnpm follow-cleanup --run` | Unfollow the scored targets from that file through the Playwright session. Honours `dryRun`; skips anything already in the blocklist, so it's safe to re-invoke daily. | Browser |

See *Cleanup operations* below for how `--scan`/`--run` fit together.

Environment variables (in `.env`): `TWITTERAPI_IO_KEY` (always), `X_USER`,
`X_AUTH_TOKEN`, `X_CT0` (for the browser session). See the README env table.

## Cleanup operations

Alongside the follow loop, `pnpm follow-cleanup` unfollows accounts that were
already followed but shouldn't have been — paid-promotion accounts, bots, and
similar spam that got in before intake scoring was tightened. Background: see
[`docs/follow-unfollow-limits-2026-09.md`](./follow-unfollow-limits-2026-09.md)
for the rate-limit research and
[`docs/superpowers/specs/2026-09-02-following-cleanup-design.md`](./superpowers/specs/2026-09-02-following-cleanup-design.md)
for the design.

### Scan / run split, and why

`--scan` is strictly read-only: it pages the account's whole following list via
the read API (~38 requests at 200/page, ~$1.30 in API cost), scores every
account, and writes `output/cleanup-targets.json`. It never touches
`.auth/auto-follow-state.json` and never opens a browser, so it's safe to
re-run anytime to see how the numbers move.

`--run` reads that file and unfollows the scored targets through the
Playwright browser session, honouring `dryRun`. It skips any target already
recorded in the blocklist, so it's safe to re-invoke daily — each invocation
only attempts whatever's still pending.

Scoring (`src/follow/scoring.ts`) is a weighted-signal check over the
profile's bio and public counts: score >= 3 is an unfollow target, 1–2 is
written to a `review` list but never acted on, 0 is clean. On the current
following list that's 388 unfollow targets / 405 review / 6,675 clean.

### Rate ceiling

The ceiling: 9 unfollows per `--run` invocation (`unfollowPerRun`), one
invocation per hour, and `unfollowPerDay` (50) unfollows per trailing 24 hours.

All three are enforced in code, not left to the operator. Every unfollow
appends a timestamp to `unfollowRunAt` in `.auth/auto-follow-state.json`
(pruned to the trailing 48 h), and a real `--run` refuses to start when either

- the trailing 24 h already holds `unfollowPerDay` unfollows, or
- the most recent unfollow was less than 55 minutes ago.

A refusal prints the reason and the time the next run is allowed, then exits
cleanly — it is not an error, so a cron entry that fires too often is harmless.
Dry runs skip both checks and stay freely repeatable. Raising the daily figure
(the design allows up to 100/day after the first two days) is a matter of
editing `unfollowPerDay` in `config/auto-follow.json`.

Nothing schedules `--run` automatically yet — no systemd timer exists for it
the way `follow-audit.timer` exists for audits — so the cadence still means
invoking it yourself (cron, a timer you add, or by hand) roughly hourly. The
gate is the floor, not the scheduler.

This ceiling is set *below* the account's own measured-safe follow rate —
7,618 follows over 555.6 hours (13.7/hour, 329/day, sustained 23 days with no
spam action) — because no comparable measurement exists for unfollows. Full
detail in `docs/follow-unfollow-limits-2026-09.md`.

### Unfollows are permanent

X's rules are explicit: *"Repeatedly following and unfollowing a user is a
form of spammy behavior, and is never allowed."* So every unfollowed handle
is recorded in a permanent blocklist in `.auth/auto-follow-state.json`
(`FollowStore.markUnfollowed`, append-only, never cleared) and can never be
re-queued by either the follow loop or the cleanup runner. There is no undo —
treat every `--run` invocation as irreversible.

The blocklist is applied at four points, because a handle can already be in the
queue when it gets unfollowed:

1. `enqueue()` refuses a blocklisted handle.
2. `markUnfollowed()` evicts the handle from the pending queue.
3. `load()` filters blocklisted handles out of the restored queue, so a state
   file written by an older process cannot reintroduce them.
4. The follow loop re-reads the blocklist and re-checks every dequeued
   candidate immediately before following it (`AutoFollowRunner.drainQueue`
   and the cap probe in `auto-follow.ts`).

### A corrupt state file stops the loop

`FollowStore.load()` distinguishes *missing* from *corrupt*. A missing file is
a first run and loads as empty state; a file that exists but does not parse
throws, and the process exits. That is deliberate: the old behaviour reset to
empty and the next `save()` wrote `{}` over 7,748 follow records and the
blocklist. If you see `exists but could not be parsed as state`, inspect
`.auth/auto-follow-state.json` by hand — do not delete it. Writes are
temp-file-plus-rename, so a crash mid-save leaves the previous file intact.

### Before running cleanup

Stop the auto-follow service first (`systemctl --user stop auto-follow`).

Both the follow loop and the cleanup runner write
`.auth/auto-follow-state.json`, and each `save()` rewrites the whole file from
its own in-memory snapshot. The append-only fields survive that: `save()`
re-reads the file and unions the on-disk `unfollowed` blocklist and
`unfollowRunAt` history back in before writing, so a concurrent write can no
longer erase an unfollow record or let the daily counter be reset. Everything
else in the file is still last-writer-wins — the followed-set, the queue and
the cap-detection fields would be rolled back to the other process's snapshot —
and the follow loop would keep following from a queue it built before the
cleanup pass started. So stop the service anyway; the union makes a mistake
survivable, not correct.

`dryRun` stays `true` in the committed config — flip it to `false` only in a
working-tree copy for the actual cleanup pass, then restore `true` and restart
the service once the pass is done.

### The `type:"cleanup"` log record

`--run` appends one `type:"cleanup"` line to `output/auto-follow-log.jsonl`
per invocation:

| Field | Meaning |
|---|---|
| `startedAt` / `finishedAt` / `durationMs` | Timing for the invocation. |
| `attempted` | Targets this invocation tried to unfollow (`0` in dry-run). |
| `unfollowedCount` | Targets actually unfollowed. |
| `notFollowing` | Targets no longer followed (e.g. already unfollowed by hand) — still recorded in the blocklist. |
| `failures` | Unfollow calls that threw. Not blocklisted; stays eligible for a later invocation. |
| `remaining` | Targets left in `cleanup-targets.json` after this invocation. |
| `unfollowed[]` | The targets actually unfollowed this invocation (empty in dry-run). |
| `wouldUnfollow[]` | The targets a dry-run would have unfollowed (empty in a real run). |
| `dryRun` | Whether this invocation was a dry run. |

## Running unattended (systemd user services)

The loop runs as a systemd **user** service so it survives terminal/logout and
restarts on crash. Unit files live in `~/.config/systemd/user/`:

- `auto-follow.service` — runs `pnpm example:auto-follow`. `Restart=always`,
  `RestartSec=30`; crash-loop guard `StartLimitBurst=10` / `StartLimitIntervalSec=600`
  (in `[Unit]`). Sets `Environment=HEADLESS=true` (see below) and puts nvm's bin
  dir on `PATH` so `pnpm` finds `node`.
- `follow-audit.service` (oneshot) + `follow-audit.timer` — runs `follow-audit`
  daily at `09:00` local (`OnCalendar=*-*-* 09:00:00`, `Persistent=true` so a
  missed run catches up).

Common operations:

```bash
systemctl --user status auto-follow          # is it running?
systemctl --user restart auto-follow          # apply a config change
systemctl --user stop auto-follow             # pause following
journalctl --user -u auto-follow -f           # live logs
systemctl --user list-timers follow-audit.timer  # next audit time
```

`loginctl enable-linger $USER` is set so the services keep running after all
terminals close.

### Headless requirement

A user systemd service has no X server / `DISPLAY`, so the browser must run
headless — the service sets `HEADLESS=true`. Locally you can watch the window
with `HEADLESS=false pnpm example:auto-follow`. The saved cookie session works
headless; there is no automated login (X blocks it).

### WSL: keep the VM alive

On WSL2 the VM freezes when idle (e.g. overnight), which pauses the service. Fix
it once via `%UserProfile%\.wslconfig`:

```ini
[wsl2]
vmIdleTimeout=-1
```

Then run `wsl --shutdown` in Windows once so WSL restarts and reads the file.
After that the VM never idle-stops and the (linger-enabled, `enabled`) services
keep running across reboots. Without this the loop can silently pause for hours.

## Logs & monitoring

- **`pnpm follow-status`** — the quickest health check.
- **`output/auto-follow-log.jsonl`** — one JSON line per cycle
  (`type:"cycle"`) with timing, before/after follow counts, `addedCount`,
  `alreadyFollowing`, `skippedUnverified`, `skippedScored` (rejected by the
  cleanup scoring function, score > 0), `skippedTooBig` (rejected for
  exceeding `maxFollowers`), `followed[]` (real runs; each with
  `userName`/`name`/`url`/`keyword`/`verified`), and `wouldFollow[]` (same
  shape, dry-run only — `followed` is empty in dry-run cycles); plus daily
  `type:"audit"` lines (`localFollowedCount` vs `actualFollowingCount`) and
  `type:"cleanup"` lines from `follow-cleanup --run` (see *Cleanup
  operations* above for its fields).

  **Historical lines from before this change** recorded dry-run targets in
  `followed` rather than `wouldFollow`, so any analysis spanning older data
  must filter on both the flag and the count, not just `dryRun`:
  `addedCount > 0 && followed.length === addedCount`.
- **`journalctl --user -u auto-follow`** — raw loop output. Follow log lines:
  `Followed @x` (new follow), `Already following @x` (skip, already followed),
  `Clicked Follow … assuming followed` (clicked but the confirmation was slow —
  still counted as followed), `Follow failed for @x` (genuine failure, dropped).

### Reading a cycle line

`Cycle done — scanned S, queued N, followed M, already-following J`

- `scanned` = tweets searched this cycle (÷`perKeyword` ≈ keywords used). Rises
  when candidates are scarce; varies by time of day (busy hours → fewer searches).
- `queued` = new candidates added.
- `followed` = new follows this cycle.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `pnpm follow-status` shows `⚠️ UNHEALTHY` | Session expired / account blocked / X blocking follows — several real cycles landed zero follows. | Re-copy `auth_token`/`ct0` from a logged-in Chrome and `pnpm import-session`. |
| Last activity in `journalctl` is hours old but service is `active` | WSL VM idle-froze. | `systemctl --user restart auto-follow` to resume; apply the `.wslconfig` fix above so it stops recurring. |
| `followed` drops below `maxPerRun` for several cycles **and** `queued` stays < ~10 | Candidate depletion — the current keywords' verified, not-yet-followed accounts are running out. | Add keywords to `config/auto-follow.json` (verify a new keyword yields candidates first), or lower some `min_faves` thresholds. Restart the service. |
| `followed` dips but `queued` is still healthy (20+) | Not depletion — just a few `Follow failed`/slow-confirm this cycle. | None; normal variance. |
| Many `Follow failed: neither Follow nor Following/Unfollow button rendered` | Profile didn't load / account suspended or restricted. | Normal at 1–2/cycle; only a concern if most of a cycle fails. |
| `Follow failed` but the account is actually followed on X | Old bug (fixed): confirmation timed out though the click landed. | Already handled — now logged as `assuming followed` and counted. |
| `follow-status` shows `⏸ FOLLOW-CAPPED` / journal shows `FOLLOW CAP REACHED` | X's ratio-based follow cap: past ~5,000 total follows, X silently drops follows beyond a per-account limit (~1.1× follower count) even though the Follow button flips (help.x.com/en/using-x/x-follow-limit). Detected when 2 consecutive cycles land under half their recorded follows (checked against the actual following count, 1 read-API call/cycle). | Nothing to fix in the tool — the loop pauses real cycles and probes 2 candidates/interval, auto-resuming (`cap-cleared` in the JSONL log) once the actual count rises. The cap only lifts as the account gains followers. Happened 2026-07-28 at ~7,500: 562 ghosted follows were reverted and re-queued. |

## How verification is checked

The `follow-audit` timer's `local` vs `actual` numbers should grow together day
to day. If `local` keeps climbing but `actual` stalls, follows aren't landing —
investigate the session/health. A small standing gap (a few %) is normal:
accounts get suspended, or the user unfollows by hand.
