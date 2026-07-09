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

State (followed set, pending queue, health counters) lives in
`.auth/auto-follow-state.json`; a per-cycle report is appended to
`output/auto-follow-log.jsonl`. Both are git-ignored.

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
| `allowedVerified` | `["blue","legacy","business","government"]` | Verification tiers to follow: `blue` (X Premium), `legacy` (old verified), `business` (gold org), `government` (grey org). Empty `[]` = filter off (follow everyone). | `["blue"]` for Premium-only; `[]` to disable the filter. Unknown tier names are dropped with a warning. |
| `dryRun` | `true` (code default) | `true` reports would-follow targets without following and logs cycles; `false` actually follows. The committed config keeps `true` as a safe default; the running service uses a working-tree copy set to `false`. | Set `false` locally to actually follow. Never commit `false`. |

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

Environment variables (in `.env`): `TWITTERAPI_IO_KEY` (always), `X_USER`,
`X_AUTH_TOKEN`, `X_CT0` (for the browser session). See the README env table.

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
  `alreadyFollowing`, `skippedUnverified`, and each followed account's
  `userName`/`name`/`url`/`keyword`/`verified`; plus daily `type:"audit"` lines
  (`localFollowedCount` vs `actualFollowingCount`).
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

## How verification is checked

The `follow-audit` timer's `local` vs `actual` numbers should grow together day
to day. If `local` keeps climbing but `actual` stalls, follows aren't landing —
investigate the session/health. A small standing gap (a few %) is normal:
accounts get suspended, or the user unfollows by hand.
