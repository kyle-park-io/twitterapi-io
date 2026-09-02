# Following cleanup + stricter follow criteria — design

**Date:** 2026-09-02
**Status:** Approved
**Prerequisite reading:** [docs/follow-unfollow-limits-2026-09.md](../../follow-unfollow-limits-2026-09.md) — rate limits and the churn rules that constrain this design.

## Problem

The auto-follow loop ran for 23 days and followed 7,618 accounts. It then hit X's
ratio cap at ~7,500, and has issued no follow at all since 2026-07-29 — five
weeks idle (in dry-run rather than cap-probe mode; see Current service state).

The working hypothesis going in was that the list had filled with scam and
promotional accounts. A full census of all 7,468 current followings says
otherwise:

| Metric | Value |
| --- | --- |
| Median followers | 23,225 |
| Median tweets | 14,128 |
| Under 100 followers | 1.0% |
| Bot-shaped (following > followers×2) | 1.9% |
| Default profile image | 0.1% |

By account-authenticity measures the list is clean — the `min_faves` and
verification filters did their job. The real contamination is narrower and of a
different kind:

1. **Promotional / KOL accounts** — real accounts whose whole purpose is paid
   promotion. Bios like *"Crypto Expert | DM For promotion"*, *"Top AI Voice"*,
   *"Building Hype Around Crypto"*, and in 26 cases a pump-token contract address
   pasted straight into the bio.
2. **Bot-shaped and ghost accounts** — a small tail with abnormal
   following/follower ratios, default avatars, or near-zero activity.

Measured with the scoring rules below: **388 accounts (5.2%)** are confidently
junk.

A third category exists — large off-topic accounts such as `@CNN`, `@ManUtd`,
`@netflix`, `@NHL` — but it is explicitly **out of scope**; see Non-Goals.

Separately, the intake criteria that produced this list are still in
`config/auto-follow.json` unchanged, so re-following would re-contaminate at the
same rate.

## Goals

- Unfollow the 388 confidently-junk accounts, freeing an equal amount of headroom
  under the ratio cap.
- Tighten intake so the same junk cannot re-enter.
- Never re-follow an account we unfollowed (X treats follow/unfollow cycling on
  the same account as spam — see Constraints).
- Stay well inside the rate envelope the account has already survived.

## Non-Goals

- **Not touching the 405 "review queue" accounts (score 1–2).** Their
  false-positive rate is too high to act on: `@Shekswess` (AWS Ambassador, ML
  lead, professor) scores 1 purely on the word "ambassador". Unfollows are
  irreversible here, so uncertain cases stay followed.
- **Not touching large off-topic accounts.** They cannot be identified
  automatically. A bio-keyword topical classifier was built and rejected: it
  labelled `@VitalikButerin`, `@coinbase`, `@joeschmidtiv` (a16z partner) and
  `@tori_finance` as off-topic because their bios do not happen to contain the
  keywords, while 35.4% of the list was unclassifiable. Any rule strong enough to
  catch `@ManUtd` also catches accounts we want.
- **Not optimising for follower growth.** The prior campaign followed 7,618
  accounts and the account has 1,276 followers. The goal here is feed quality and
  cap headroom, not reciprocation.
- **No follow-back signal, ever.** See Constraints.

## Constraints (from the rate-limit research)

These are hard requirements, not preferences. Full sourcing in
[docs/follow-unfollow-limits-2026-09.md](../../follow-unfollow-limits-2026-09.md).

1. **Never re-follow an unfollowed account.** X: *"Repeatedly following and
   unfollowing a user is a form of spammy behavior, and is never allowed."* This
   makes every unfollow permanent and is why the blocklist below is mandatory
   rather than an optimisation.
2. **Never use follow-back as a junk signal.** X's own example of a violation is
   *"following 100 users, waiting 24 hours, then unfollowing the users who
   haven't followed you back"*. No component may read follower relationships.
3. **Do not interleave unfollows and follows 1:1 in the same window.** That
   pattern is the churn signature. The cleanup runs to completion first; follows
   resume afterwards.
4. **Rate ceiling:** 8–10 unfollows/hour, 50/day for the first two days then up
   to 100/day. The account has demonstrably survived 13.7 follows/hour and
   329/day for 23 days; unfollow starts below that because practitioner reports
   consistently claim unfollows trip limits sooner, and we have no measurement of
   our own.

## Scoring rules

A single boolean rule per signal was tried first and produced unacceptable false
positives: `@JensenHuang` (NVIDIA CEO, 1.0M followers) was flagged by a
"fewer than 20 tweets" rule, `@Ember_web3` (a Seoul Web3 builder feed) by
"Hidden gems" matching pump language, `@Shekswess` by "ambassador".

Weighted scoring with a threshold of 3 clears all three. Signals are additive;
the threshold is what buys the precision.

| Weight | Signal | Match |
| ---: | --- | --- |
| 3 | Pump contract address in bio | base58 32–44 chars ending `pump` |
| 3 | Explicit promo solicitation | `DM for promo/collab/business/ads/pr`, `paid promo`, `dm open for` |
| 3 | Self-declared KOL / influencer | `KOL`, `key opinion leader`, `crypto expert/influencer`, `top ai voice`, `influencer` |
| 2 | Pump language | `100x`, `1000x`, `moonshot`, `to the moon`, `next gem`, `🚀 gem/moon` |
| 2 | Presale / airdrop solicitation | `giveaway`, `whitelist`, `presale`, `free mint`, `claim now` |
| 2 | Telegram funnel | `t.me/`, `tg handle:` |
| 2 | Bot ratio | following/followers > 3 **and** following > 500 |
| 2 | Default profile image | `default_profile` in avatar URL |
| 2 | Ghost account | followers < 50 **and** tweets < 50 |
| 1 | Ambassador / collab (weak) | `ambassador`, `collab(oration)` |
| 1 | No bio and no banner | both empty |
| 1 | Promo emoji density | ≥3 of `🚀💰🔥💎📈✨🤝💼` |

**Threshold: score ≥ 3 → unfollow. 1–2 → leave alone. 0 → clean.**

Distribution over the 7,468: 6,675 at 0, 253 at 1, 152 at 2, 178 at 3, 159 at 4,
15 at 5, 18 at 6, 17 at 7, 1 at 8. **388 at or above threshold.**

Note the weak (weight-1) signals never reach the threshold alone. They exist to
push accounts already carrying a 2-point signal over the line, and are deliberately
incapable of causing an unfollow by themselves.

### Verification of the threshold

Every previously-identified false positive scores below 3:

| Account | Score | Outcome |
| --- | ---: | --- |
| `@JensenHuang` | 0 | passes |
| `@Ember_web3` | 0 | passes |
| `@VitalikButerin`, `@coinbase`, `@elonmusk`, `@pmarca`, `@satyanadella`, `@joeschmidtiv` | 0 | pass |
| `@Shekswess` | 1 | review queue, not unfollowed |

Samples at or above threshold: `@CoreNews_2` (*"Crypto Expert| DM For
promotion"*, 6), `@tylerrwayne` (*"Top AI Voice"*, 7), `@MeinGottNiles` (pump
address in bio, 3), `@Zillioncoins` (*"CRYPTO KOL"*, 5), `@Web3Kevo` (*"Crypto OG
| KOL"*, 3).

## Intake criteria

The same scoring function gates new follows: **only score 0 is followed.** The
exit rule and the entry rule are the same rule, so the list cannot re-contaminate
by the mechanism that filled it.

Two further filters, each justified by the keyword analysis below:

| Filter | Rule | Rationale |
| --- | --- | --- |
| Follower ceiling | skip if followers > 500,000 | 500k is where media orgs, clubs and celebrities dominate the sample |
| Score gate | skip unless score = 0 | the rule above |

**Recent activity needs no filter.** Candidates are authors of tweets returned by
`advanced_search` with `queryType: "Latest"`, so every candidate has by
construction tweeted recently enough to appear in a chronological search. An
explicit activity check would spend one read call per candidate re-deriving a
property the pipeline already guarantees. Revisit only if the search ever moves
to `queryType: "Top"`.

### Keyword changes

Per-keyword junk rate was computed by joining the follow log's `keyword` field to
each account's score. The correlation with `min_faves` is direct: **raising
`min_faves` pulls in large off-topic accounts.**

| Keyword | Sample | Junk % | >500k % |
| --- | ---: | ---: | ---: |
| `agentic AI min_faves:400` | 26 | 11.5% | **42.3%** |
| `crypto AI agents min_faves:300` | 23 | 8.7% | 26.1% |
| `bitcoin min_faves:250` | 80 | 0.0% | 23.8% |
| `AI agents min_faves:250` | 79 | 3.8% | 16.5% |
| `Claude min_faves:300` | 220 | 4.5% | 15.0% |
| Korean keywords (`min_faves:20–50`) | — | **0.0%** | **0.0%** |

Every Korean-language keyword produced zero junk and zero mega-accounts, with
average follower counts of 6k–30k. The paid-promotion ecosystem these rules
target is English-language.

**Remove** (junk rate ≥ 15%): `futures trading min_faves:120` (24.7%),
`onchain AI min_faves:120` (20.5%), `algorithmic trading min_faves:100` (17.9%),
`web3 min_faves:150` (17.5%), `diffusion models min_faves:80` (17.1%),
`RWA min_faves:120` (16.7%).

**Lower** every remaining `min_faves` at or above 200 into the 100–150 band. In
the current config that is `bitcoin:250`, `AI agents:250`, `ethereum:200`,
`GPT:200`, and `agentic AI:200`. (The `:300`/`:400` variants in the table above
are historical — earlier commits already lowered them.)

**Expand** the Korean keyword set, which is the cleanest segment of the config.

## Components

### `src/follow/scoring.ts` (new)

Pure functions, no I/O — the whole point is that they are directly testable
against the census data.

The two sources name the same fields differently: `/twitter/user/followings`
returns snake_case (`followers_count`, `friends_count`, `statuses_count`,
`profile_image_url_https`, `profile_banner_url`) while `advanced_search` tweet
authors return camelCase (`followers`, `following`, `statusesCount`,
`profilePicture`, `coverPicture`). `scoreAccount` therefore takes a normalised
shape, and two adapters — `fromFollowingsRecord` and `fromSearchAuthor` — are the
only places either wire format is named.

```ts
export interface ScoredAccount {
  score: number;
  reasons: string[];
}
export function scoreAccount(u: UserProfile): ScoredAccount;
export const UNFOLLOW_THRESHOLD = 3;
```

Consumed by both the cleanup runner (exit) and the follow runner (entry).

### `src/follow/IFollower.ts` (extend)

```ts
export type UnfollowResult = "unfollowed" | "not-following";

export interface IFollower {
  follow(username: string): Promise<FollowResult>;
  unfollow(username: string): Promise<UnfollowResult>;
}
```

Idempotent in the same way `follow` is: unfollowing someone we are not following
returns `"not-following"` rather than throwing. A genuine failure throws.

### `src/services/BrowserFollowService.ts` (extend)

Implement `unfollow`. Unlike Follow, X renders a **confirmation modal**, so the
flow is: locate the `Following @<user>` / `Unfollow @<user>` button → click →
wait for the confirmation dialog → click its Unfollow button → confirm the button
flips back to `Follow @<user>`.

Mirror the existing follow-path leniency: if the click landed but confirmation is
slow, log "assuming unfollowed" and count it, rather than retrying and
double-acting.

### `src/services/FollowStore.ts` (extend)

Add a permanent `unfollowed` set, persisted in `.auth/auto-follow-state.json`.

- `markUnfollowed(username)` — records it.
- `enqueue` must skip any username in `unfollowed`, exactly as it already skips
  `followed`.

This set is **append-only and never cleared**, including by the following-list
sync. It is the mechanism that satisfies Constraint 1, so it is load-bearing, not
bookkeeping.

### `src/services/CleanupRunner.ts` (new)

One cleanup cycle, mirroring `AutoFollowRunner`'s shape:

1. Read the target list (precomputed, see entry point).
2. Take the next N targets under the hourly budget.
3. For each: `unfollow()`, `markUnfollowed()`, sleep 30–90 s randomised.
4. Append a `type:"cleanup"` record to `output/auto-follow-log.jsonl`.

Stops when the list is exhausted. Respects a daily cap that starts at 50 and is
raised by config after the first two days.

### `src/examples/follow-cleanup.ts` (new)

Entry point. Two modes:

- `--scan` — pull the full following list, score every account, write
  `output/cleanup-targets.json` plus a human-readable summary. Read-only.
- `--run` — execute the cleanup against that file. Honours `dryRun` from config
  the same way the follow loop does.

Scan is separate from run so the target list can be inspected before anything
irreversible happens.

### `config/auto-follow.json` + `src/config.ts`

New fields:

| Field | Default | Purpose |
| --- | --- | --- |
| `maxFollowers` | `500000` | intake follower ceiling |
| `unfollowPerRun` | `9` | unfollows per cleanup invocation; one invocation per hour |
| `unfollowPerDay` | `50` | cleanup daily cap, raised to 100 after the first two days |

Plus the keyword edits above.

### Log-integrity fix

`output/auto-follow-log.jsonl` is unusable for analysis as written. In dry-run,
`drainQueue` returns `targets.map(toCandidate)` and `runCycle` reports that array
as `followed` while setting `addedCount: 0`. The dry-run queue never drains, so
every hour logs the same top-25 candidates under a field named "followed".

Across 354 such cycles this turns 16,468 logged entries into 7,622 unique ones —
a 53.7% duplication rate that inflated the first pass of the keyword analysis
roughly threefold before it was caught.

Rename the dry-run payload so the field name matches its meaning: report
would-be targets as `wouldFollow` and leave `followed` empty when `dryRun` is
set. `follow-status` reads only `addedCount` from these records and needs no
change, but the cycle console line in `auto-follow.ts` prints
`summary.followed.length` and must be updated to report the right field per mode.

Past log lines stay as they are; any analysis over historical data must filter to
`addedCount > 0 && followed.length === addedCount`, as this design's numbers do.

### Current service state

The loop is **not** in cap-probe mode, despite `capDetectedAt` being set in
`.auth/auto-follow-state.json`. `config/auto-follow.json` has `dryRun: true`
committed with no working-tree override, so since 2026-07-29 the service has
only been printing `[dry-run] would follow` once an hour. No follow has actually
been issued in that time.

This means step 4 of Sequencing ("stop the service") is a formality rather than a
race to avoid — but it stays in the plan, because resuming real follows requires
setting `dryRun: false`, and that must not happen until the cleanup has finished.

## Data flow

```
--scan:
  followings API (38 pages, ~$1.3)
    → scoreAccount() per account
    → score >= 3  → cleanup-targets.json  (388)
    → score 1..2  → review list, reported but not acted on (405)
    → score 0     → untouched (6,675)

--run:
  cleanup-targets.json
    → CleanupRunner (9/h, 50→100/day)
    → BrowserFollowService.unfollow()
    → FollowStore.markUnfollowed()   [permanent, blocks re-follow]
    → JSONL cleanup record

then, separately in time:
  auto-follow loop resumes
    → candidate → scoreAccount() must be 0
                → followers <= 500k
                → tweeted within 30 days
                → not in unfollowed set
    → follow
```

## Sequencing

The cap makes the order mandatory anyway — headroom is 32 accounts, so follows
cannot resume at volume until unfollows create room. That happens to be the same
order Constraint 3 requires.

1. Land scoring + unfollow plumbing, tests passing.
2. `--scan`, inspect the 388.
3. `--run --dry-run`, confirm the targets and pacing.
4. Stop the auto-follow service. Run the cleanup to completion (4–6 days).
5. Apply the config and keyword changes.
6. Wait, then restart the follow loop. Expect it to resume as the cap clears.

## Error handling

- **Unfollow throws** — log, leave the target in the list, move on. A persistently
  failing target must not wedge the run; cap retries per target as
  `AutoFollowRunner` does.
- **Session expired** — same failure mode and remedy as the follow loop
  (`pnpm import-session`).
- **Confirmation modal absent** — treat as the existing "assuming actioned" case
  rather than clicking again, so a slow UI cannot cause a double action.
- **Cap detection interaction** — the existing cap logic watches for the actual
  following count *stalling*. During cleanup it will be *falling*, which
  `capDetection` already treats as stalled (a negative delta counts as stalled,
  per its tests). The cleanup runs with the follow service stopped, so the two
  never run concurrently; this is why step 4 stops the service rather than
  relying on both to coexist.

## Testing

- `scoring.test.ts` — each rule in isolation; the threshold verified against the
  named false positives (`@JensenHuang`, `@Ember_web3`, `@Shekswess`) and the
  named true positives (`@CoreNews_2`, `@tylerrwayne`, `@MeinGottNiles`). The
  census file makes these real fixtures, not invented ones.
- `FollowStore.test.ts` — `unfollowed` blocks `enqueue`; the set survives a
  following-list sync; it is never cleared.
- `CleanupRunner.test.ts` — rate caps honoured; a throwing unfollow does not
  wedge the run; dry-run performs no writes.
- `BrowserFollowService` — manual verification against a real profile, as with
  the original follow implementation. The confirmation modal is the risky part
  and is not unit-testable.

## Open risks

- **Browser automation remains against X's Automation Rules.** 23 days of
  incident-free operation is evidence, not a guarantee. This is the same risk the
  account already carries.
- **No measured unfollow rate limit exists.** The starting numbers are inferred.
  The first two days are effectively the measurement; if anything looks wrong,
  stop rather than tune.
- **388 may not clear the cap.** The cap is X's ratio calculation, not a number we
  can see. Freeing 388 slots is expected to help but is not guaranteed to restore
  full throughput — the cap ultimately lifts as follower count grows.
