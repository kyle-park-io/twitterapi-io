# Verified-only follow filter — design

**Date:** 2026-07-06
**Status:** Approved

## Problem

The auto-follow tool queues and follows the author of every matching tweet,
regardless of account quality. The user wants to follow only **verified /
paid** accounts — X Premium (blue check), legacy verified, and organization
verified (Business / Government) — and skip everyone else. The search API
already returns each author's verification signals; the tool currently reads
only `userName` and `name` and discards the rest.

## Verification signals (from the live `advancedSearch` author object)

Sampled 90 authors across keywords. The relevant fields and their observed
values:

- `isBlueVerified`: `true | false` — X Premium (the blue check).
- `isVerified`: `true | false` — legacy verified (rare now; observed only
  `false` in the sample, but the field is present and authoritative).
- `verifiedType`: `null | "Business" | "Government"` — organization verification
  (gold / grey checks). `null` for individuals.

An account can hold more than one (e.g. a Business org that also subscribes to
Premium has `isBlueVerified: true` and `verifiedType: "Business"`).

## Approach

Map each author's raw signals to a small set of human-named tiers, let the user
pick which tiers to allow via config, and skip any author that matches none of
the allowed tiers before it is queued.

**Tier mapping (author → tiers):**
- `blue`       ⟸ `isBlueVerified === true`
- `legacy`     ⟸ `isVerified === true`
- `business`   ⟸ `verifiedType === "Business"`
- `government` ⟸ `verifiedType === "Government"`

**Filter rule:** `allowedVerified` is a config array of tier names. If it is
**empty**, the filter is off (every author passes — the current behavior). If it
is non-empty, an author passes when at least one of its tiers is in
`allowedVerified`. An author with no tiers (all signals false/null) is skipped
whenever the filter is on.

**Default config:** `["blue","legacy","business","government"]` — follow any
verified account, skip only the unverified. The user can narrow it (e.g.
`["blue"]`) anytime.

Unknown tier names in the config are ignored with a warning (typos shouldn't
silently widen or break the filter).

## Components

### `AutoFollowRunner` — read signals, filter, and a pure helper

The `AuthoredTweet.author` shape gains the verification fields the API already
sends:

```ts
interface AuthoredTweet {
  author?: {
    userName: string;
    name: string;
    isVerified?: boolean;
    isBlueVerified?: boolean;
    verifiedType?: string | null;
  };
}
```

A pure, exported, unit-tested helper (no I/O):

```ts
export type VerifiedTier = "blue" | "legacy" | "business" | "government";

/** The verification tiers an author holds (may be several, or none). */
export function authorTiers(author: {
  isVerified?: boolean;
  isBlueVerified?: boolean;
  verifiedType?: string | null;
}): VerifiedTier[];

/**
 * True if the author may be followed under `allowed`. Empty `allowed` = filter
 * off (always true). Otherwise true iff the author holds a tier in `allowed`.
 */
export function passesVerifiedFilter(
  author: { isVerified?: boolean; isBlueVerified?: boolean; verifiedType?: string | null },
  allowed: VerifiedTier[]
): boolean;
```

In `fillQueue()`, before enqueuing an author, call
`passesVerifiedFilter(tweet.author, this.options.allowedVerified)`. If it
returns false, `continue` (skip; still counts as scanned, so search keeps
finding candidates). `AutoFollowRunnerOptions` gains `allowedVerified:
VerifiedTier[]`.

### `FollowStore` — carry the tier on the candidate (backward-compatible)

`Candidate` gains an optional `verified?: VerifiedTier[]` (the author's tiers at
enqueue time), so logs/queue show why someone was eligible. `enqueue`'s `meta`
param gains `verified?`. Loading an old candidate without the field is fine
(stays undefined). This is additive to the existing `{userName, name?,
keyword?}` shape.

### `CycleSummary` / logging

`fillQueue` passes `verified: authorTiers(tweet.author)` into `enqueue`'s meta.
`FollowedCandidate` gains `verified?: VerifiedTier[]`, surfaced in the JSONL
cycle record so each followed account shows its tier(s). Additionally,
`CycleSummary` gains `skippedUnverified: number` — how many candidates the
filter rejected this cycle — so the JSONL log shows the filter's effect. (This
also answers "how many is it filtering out.")

### Config

`config/auto-follow.json` gains `"allowedVerified":
["blue","legacy","business","government"]`. `AutoFollowConfig` gains
`allowedVerified: VerifiedTier[]`. `loadAutoFollowConfig` resolves it from the
JSON (default the four-tier array), validating each entry against the known
tiers and dropping unknown ones with a `console.warn`. No CLI flag (an array is
awkward as a flag, and the JSON-wins rule makes flags secondary anyway).

### Changed / new files

- `src/services/AutoFollowRunner.ts` — author verified fields, `VerifiedTier`,
  `authorTiers`, `passesVerifiedFilter`, filter in `fillQueue`, `allowedVerified`
  option, `skippedUnverified` in summary, `verified` on followed candidates.
- `src/services/FollowStore.ts` — `Candidate.verified?`, `enqueue` meta
  `verified?`.
- `src/config.ts` — `allowedVerified` field + validation.
- `config/auto-follow.json` — `allowedVerified` array.
- `README.md` — document the filter and tiers.
- Tests: `AutoFollowRunner.test.ts` (`authorTiers` for each signal combo,
  `passesVerifiedFilter` empty-allow / match / no-match / multi-tier, and a
  `fillQueue` cycle that skips an unverified author and queues a verified one,
  asserting `skippedUnverified`), `FollowStore.test.ts` (`verified` round-trips).

## Data flow

```
search tweet.author {isVerified,isBlueVerified,verifiedType}
  └─ authorTiers(author) → e.g. ["blue"] or ["business"] or []
       └─ passesVerifiedFilter(author, allowedVerified)?
            ├─ no  → skip (skippedUnverified++), keep scanning
            └─ yes → enqueue(userName, {name, keyword, verified: tiers})
                       └─ drain → follow → FollowedCandidate {…, verified}
                            └─ JSONL cycle record shows verified tiers + skippedUnverified
```

## Error handling

- Missing/partial author signals (undefined fields) → treated as that signal
  being false/absent; `authorTiers` returns `[]`, so the author is skipped when
  the filter is on. Never throws.
- Unknown config tier names → dropped with a warning; if that leaves
  `allowedVerified` empty, the filter is off (documented), not an error.
- All existing follow/queue/health behavior is unchanged.

## Testing

- `authorTiers`: `{isBlueVerified:true}`→`["blue"]`; `{isVerified:true}`→
  `["legacy"]`; `{verifiedType:"Business"}`→`["business"]`;
  `{verifiedType:"Government"}`→`["government"]`; blue+business→`["blue",
  "business"]`; all false/null→`[]`.
- `passesVerifiedFilter`: empty `allowed` → always true (even for `[]`-tier
  author); `["blue"]` vs a blue author → true; `["blue"]` vs a business-only
  author → false; `["blue","business"]` vs a business author → true.
- `fillQueue` integration (fake source): a mix of one verified and one
  unverified author with `allowedVerified:["blue"]` queues only the verified
  one and reports `skippedUnverified: 1`.
- `FollowStore`: `enqueue("x",{verified:["blue"]})` round-trips through
  save/load.

## Security / privacy notes

No new data leaves the machine; verification flags come from the same read API
already in use. No credentials involved.
