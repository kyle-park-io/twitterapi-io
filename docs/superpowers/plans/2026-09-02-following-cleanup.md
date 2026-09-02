# Following Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unfollow the 388 promotional/bot accounts in the current following list, and tighten intake so the same junk cannot re-enter.

**Architecture:** A pure scoring function (`src/follow/scoring.ts`) grades a normalised X profile from its public fields. The same function serves both directions: the cleanup runner unfollows anyone scoring ≥3, and the follow runner admits only accounts scoring 0. Two thin adapters convert the two wire formats (the `followings` endpoint and search-result authors) into that normalised shape. Unfollows execute through the existing Playwright session by extending `IFollower` with `unfollow()`, and every unfollowed handle lands in a permanent blocklist in `FollowStore` that `enqueue` consults, because X prohibits re-following an account you unfollowed.

**Tech Stack:** TypeScript, `node:test` + `node:assert/strict` (no test framework), ts-node, Playwright. Run tests with `pnpm test`.

**Spec:** `docs/superpowers/specs/2026-09-02-following-cleanup-design.md`

## Global Constraints

- **Never re-follow an unfollowed account.** X: *"Repeatedly following and unfollowing a user is a form of spammy behavior, and is never allowed."* The `unfollowed` set is append-only and never cleared, including by the following-list sync.
- **Never read or use follow-back status as a signal.** X's own stated example of a violation is unfollowing users who did not follow back. No component may call `check_follow_relationship` or compare follower lists for this purpose.
- **Do not interleave unfollows and follows 1:1 in the same window.** The cleanup runs to completion before real follows resume.
- **Unfollow rate ceiling:** 9 per run with one run per hour, 50/day for the first two days, then up to 100/day. Delay between actions is randomised 30–90 s, matching the existing follow loop.
- **`UNFOLLOW_THRESHOLD` is 3.** Weight-1 signals must never be able to reach it alone.
- **`config/auto-follow.json` keeps `dryRun: true` in git.** Never commit `false`.
- Tests are `node:test`; assertions are `node:assert/strict`. Test files live in `src/**/__tests__/*.test.ts`.
- Commit messages: Conventional Commits with a body explaining what and why. No `Co-Authored-By` trailer.

---

### Task 1: Scoring function and source adapters

**Files:**
- Create: `src/follow/scoring.ts`
- Test: `src/follow/__tests__/scoring.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module, no I/O)
- Produces:
  - `export interface ScorableProfile { userName: string; description: string; followersCount: number; followingCount: number; statusesCount: number; avatarUrl: string; bannerUrl: string | null }`
  - `export interface ScoredAccount { score: number; reasons: string[] }`
  - `export function scoreAccount(u: ScorableProfile): ScoredAccount`
  - `export interface FollowingsRecord { … }` / `export function fromFollowingsRecord(u: FollowingsRecord): ScorableProfile`
  - `export interface SearchAuthor { … }` / `export function fromSearchAuthor(a: SearchAuthor): ScorableProfile`
  - `export const UNFOLLOW_THRESHOLD = 3`

**Why two adapters.** The two sources disagree on field names, and the scoring function has to serve both:

| Source | Bio | Followers | Following | Tweets | Avatar | Banner |
| --- | --- | --- | --- | --- | --- | --- |
| `/twitter/user/followings` | `description` | `followers_count` | `friends_count` | `statuses_count` | `profile_image_url_https` | `profile_banner_url` |
| `/twitter/tweet/advanced_search` author | `description` | `followers` | `following` | `statusesCount` | `profilePicture` | `coverPicture` |

`scoreAccount` takes the normalised shape only. The adapters are the sole place either wire format is named, so no rule has to know where its input came from.

- [ ] **Step 1: Write the failing test**

```ts
// src/follow/__tests__/scoring.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreAccount,
  fromFollowingsRecord,
  fromSearchAuthor,
  UNFOLLOW_THRESHOLD,
  ScorableProfile,
} from "../scoring";

function profile(over: Partial<ScorableProfile> = {}): ScorableProfile {
  return {
    userName: "someone",
    description: "",
    followersCount: 5000,
    followingCount: 500,
    statusesCount: 3000,
    avatarUrl: "https://pbs.twimg.com/profile_images/1/a_normal.jpg",
    bannerUrl: "https://pbs.twimg.com/profile_banners/1/2",
    ...over,
  };
}

test("threshold is 3", () => {
  assert.equal(UNFOLLOW_THRESHOLD, 3);
});

test("a plain profile scores 0", () => {
  assert.equal(scoreAccount(profile()).score, 0);
});

test("pump contract address in bio scores 3", () => {
  const r = scoreAccount(
    profile({ description: "The Life of a Chud EoP9nKZMtTFTWVjkJVJEQQXAgWoFZwgVgoKspkrVpump" })
  );
  assert.equal(r.score, 3);
  assert.ok(r.reasons.includes("pump-contract-in-bio"));
});

test("explicit promo solicitation reaches the threshold", () => {
  const r = scoreAccount(profile({ description: "AI & Tech | DM for promo and collabs" }));
  assert.ok(r.score >= UNFOLLOW_THRESHOLD, `scored ${r.score}`);
  assert.ok(r.reasons.includes("promo-solicitation"));
});

test("self-declared KOL scores 3", () => {
  assert.equal(scoreAccount(profile({ description: "Crypto OG | KOL" })).score, 3);
});

test("bot ratio scores 2 and does not reach the threshold alone", () => {
  const r = scoreAccount(profile({ followersCount: 100, followingCount: 900 }));
  assert.equal(r.score, 2);
  assert.ok(r.score < UNFOLLOW_THRESHOLD);
});

test("weak signals alone never reach the threshold", () => {
  const r = scoreAccount(
    profile({ description: "AWS Ambassador @aws ML and Applied Research Lead", bannerUrl: null })
  );
  assert.ok(r.score < UNFOLLOW_THRESHOLD, `expected <3, got ${r.score}`);
});

// Regression fixtures — real accounts a naive rule set misclassified.
test("known false positives stay below the threshold", () => {
  const cases: ScorableProfile[] = [
    // @JensenHuang — a huge account that simply does not tweet
    profile({
      userName: "JensenHuang",
      description: "Founder and CEO of NVIDIA.",
      followersCount: 1038966,
      followingCount: 53,
      statusesCount: 12,
    }),
    // @Ember_web3 — "Hidden gems" here is not pump language
    profile({
      userName: "Ember_web3",
      description:
        "What's being built in Seoul\nKorea Web3 • Builders • Startups\nShort clips • Hidden gems • NFA",
      followersCount: 17109,
    }),
    // @Shekswess — "Ambassador" is a real role
    profile({
      userName: "Shekswess",
      description: "AWS Ambassador @aws ML and Applied Research Lead @lokahq College Professor",
      followersCount: 1520,
    }),
  ];
  for (const c of cases) {
    assert.ok(
      scoreAccount(c).score < UNFOLLOW_THRESHOLD,
      `${c.userName} scored ${scoreAccount(c).score}`
    );
  }
});

test("known true positives reach the threshold", () => {
  const cases: ScorableProfile[] = [
    profile({
      userName: "CoreNews_2",
      description: "Fan Page & Parody | Crypto Expert| Crypto Enthusiast|DM For promotion| #sol",
      followersCount: 397849,
    }),
    profile({
      userName: "tylerrwayne",
      description: "Top AI Voice | Sharing insights on AI, No-Code, Tech Tools & prompts",
      followersCount: 407264,
    }),
    profile({
      userName: "Zillioncoins",
      description: "FEED CREATOR | CRYPTO KOL | COIN X",
      followersCount: 23139,
    }),
  ];
  for (const c of cases) {
    assert.ok(
      scoreAccount(c).score >= UNFOLLOW_THRESHOLD,
      `${c.userName} scored ${scoreAccount(c).score}`
    );
  }
});

test("fromFollowingsRecord maps the snake_case wire format", () => {
  const p = fromFollowingsRecord({
    userName: "jayc_BM",
    description: "Head of BD",
    followers_count: 2109,
    friends_count: 1862,
    statuses_count: 4200,
    profile_image_url_https: "https://pbs.twimg.com/profile_images/1/x_normal.jpg",
    profile_banner_url: null,
  });
  assert.deepEqual(p, {
    userName: "jayc_BM",
    description: "Head of BD",
    followersCount: 2109,
    followingCount: 1862,
    statusesCount: 4200,
    avatarUrl: "https://pbs.twimg.com/profile_images/1/x_normal.jpg",
    bannerUrl: null,
  });
});

test("fromSearchAuthor maps the camelCase wire format", () => {
  const p = fromSearchAuthor({
    userName: "BSCNews",
    description: "",
    followers: 1371990,
    following: 171,
    statusesCount: 91806,
    profilePicture: "https://pbs.twimg.com/profile_images/2/y_normal.jpg",
    coverPicture: null,
  });
  assert.deepEqual(p, {
    userName: "BSCNews",
    description: "",
    followersCount: 1371990,
    followingCount: 171,
    statusesCount: 91806,
    avatarUrl: "https://pbs.twimg.com/profile_images/2/y_normal.jpg",
    bannerUrl: null,
  });
});

test("adapters tolerate missing fields", () => {
  assert.equal(fromFollowingsRecord({ userName: "a" }).followersCount, 0);
  assert.equal(fromSearchAuthor({ userName: "b" }).description, "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../scoring'`

- [ ] **Step 3: Write the implementation**

```ts
// src/follow/scoring.ts

/**
 * A profile in the shape the scoring rules read. Both wire formats are converted
 * into this by the adapters below, so no rule has to know its input's origin.
 */
export interface ScorableProfile {
  userName: string;
  description: string;
  followersCount: number;
  followingCount: number;
  statusesCount: number;
  avatarUrl: string;
  bannerUrl: string | null;
}

export interface ScoredAccount {
  score: number;
  reasons: string[];
}

/** A record from `GET /twitter/user/followings` (snake_case). */
export interface FollowingsRecord {
  userName: string;
  description?: string | null;
  followers_count?: number;
  friends_count?: number;
  statuses_count?: number;
  profile_image_url_https?: string | null;
  profile_banner_url?: string | null;
}

/** A tweet author from `GET /twitter/tweet/advanced_search` (camelCase). */
export interface SearchAuthor {
  userName: string;
  description?: string | null;
  followers?: number;
  following?: number;
  statusesCount?: number;
  profilePicture?: string | null;
  coverPicture?: string | null;
}

export function fromFollowingsRecord(u: FollowingsRecord): ScorableProfile {
  return {
    userName: u.userName,
    description: u.description ?? "",
    followersCount: u.followers_count ?? 0,
    followingCount: u.friends_count ?? 0,
    statusesCount: u.statuses_count ?? 0,
    avatarUrl: u.profile_image_url_https ?? "",
    bannerUrl: u.profile_banner_url ?? null,
  };
}

export function fromSearchAuthor(a: SearchAuthor): ScorableProfile {
  return {
    userName: a.userName,
    description: a.description ?? "",
    followersCount: a.followers ?? 0,
    followingCount: a.following ?? 0,
    statusesCount: a.statusesCount ?? 0,
    avatarUrl: a.profilePicture ?? "",
    bannerUrl: a.coverPicture ?? null,
  };
}

/**
 * Score at or above which an account is unfollowed. Weighted scoring rather than
 * per-rule booleans exists because single rules produced unacceptable false
 * positives: a "<20 tweets" rule flags @JensenHuang, "hidden gems" flags a Seoul
 * builder feed, "ambassador" flags an AWS ambassador. The threshold is what buys
 * the precision — see the regression fixtures in the tests.
 */
export const UNFOLLOW_THRESHOLD = 3;

const PROMO_EMOJI = /[\u{1F680}\u{1F4B0}\u{1F525}\u{1F48E}\u{1F4C8}\u{2728}\u{1F91D}\u{1F4BC}]/gu;

interface Rule {
  weight: number;
  reason: string;
  test: (u: ScorableProfile) => boolean;
}

const RULES: Rule[] = [
  {
    weight: 3,
    reason: "pump-contract-in-bio",
    test: (u) => /[A-HJ-NP-Za-km-z1-9]{32,44}pump\b/.test(u.description),
  },
  {
    weight: 3,
    reason: "promo-solicitation",
    test: (u) =>
      /dm for (promo|collab|business|ads|pr\b)|\u{1F4E9} *for (ads|promo|pr)|paid (promo|collab)|for ads *& *pr|dm (is )?open for/iu.test(
        u.description
      ),
  },
  {
    weight: 3,
    reason: "self-declared-kol",
    test: (u) =>
      /\bKOL\b|key opinion leader|crypto (expert|influencer)|top ai voice|\binfluencer\b/i.test(
        u.description
      ),
  },
  {
    weight: 2,
    reason: "pump-language",
    test: (u) => /100x|1000x|moonshot|to the moon|next gem|\u{1F680} *(gem|moon)/iu.test(u.description),
  },
  {
    weight: 2,
    reason: "presale-solicitation",
    test: (u) => /giveaway|whitelist|presale|free mint|claim now/i.test(u.description),
  },
  {
    weight: 2,
    reason: "telegram-funnel",
    test: (u) => /t\.me\/|tg *(handle|:)/i.test(u.description),
  },
  {
    weight: 2,
    reason: "bot-ratio",
    test: (u) => u.followingCount / (u.followersCount || 1) > 3 && u.followingCount > 500,
  },
  {
    weight: 2,
    reason: "default-avatar",
    test: (u) => /default_profile/.test(u.avatarUrl),
  },
  {
    weight: 2,
    reason: "ghost-account",
    test: (u) => u.followersCount < 50 && u.statusesCount < 50,
  },
  {
    weight: 1,
    reason: "ambassador-or-collab",
    test: (u) => /ambassador|collab(oration)?s?\b/i.test(u.description),
  },
  {
    weight: 1,
    reason: "no-bio-no-banner",
    test: (u) => u.description.trim() === "" && !u.bannerUrl,
  },
  {
    weight: 1,
    reason: "promo-emoji-density",
    test: (u) => (u.description.match(PROMO_EMOJI) ?? []).length >= 3,
  },
];

export function scoreAccount(u: ScorableProfile): ScoredAccount {
  let score = 0;
  const reasons: string[] = [];
  for (const rule of RULES) {
    if (rule.test(u)) {
      score += rule.weight;
      reasons.push(rule.reason);
    }
  }
  return { score, reasons };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all scoring tests green

- [ ] **Step 5: Commit**

```bash
git add src/follow/scoring.ts src/follow/__tests__/scoring.test.ts
git commit -m "feat: add profile scoring for follow cleanup and intake

Grades an X profile from public fields to identify paid-promotion and
bot accounts. Weighted signals with a threshold of 3 rather than
per-rule booleans: single rules misfire badly on real accounts, so
regression fixtures pin @JensenHuang, @Ember_web3 and @Shekswess below
the threshold while @CoreNews_2, @tylerrwayne and @Zillioncoins stay
above it.

The followings endpoint and search-result authors describe the same
fields under different names, so two adapters normalise both into one
shape and the rules never name a wire format. The same function gates
both directions later — cleanup unfollows at or above the threshold,
intake admits only zero."
```

---

### Task 2: `unfollow()` on the follower interface

**Files:**
- Modify: `src/follow/IFollower.ts`
- Modify: `src/services/BrowserFollowService.ts`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:
  - `export type UnfollowResult = "unfollowed" | "not-following"`
  - `IFollower.unfollow(username: string): Promise<UnfollowResult>`

No unit test: this is Playwright DOM interaction against live X, verified manually in Step 4. The runner that calls it is tested against a fake in Task 4.

- [ ] **Step 1: Extend the interface**

Append to `src/follow/IFollower.ts`:

```ts
/** Outcome of an unfollow attempt that did not throw. */
export type UnfollowResult = "unfollowed" | "not-following";
```

And add to the `IFollower` interface body:

```ts
  /**
   * Unfollows a single X account by username. Idempotent in the same way
   * `follow` is: unfollowing someone not currently followed returns
   * "not-following" rather than throwing. A genuine failure (the profile never
   * rendered) throws.
   */
  unfollow(username: string): Promise<UnfollowResult>;
```

- [ ] **Step 2: Verify it fails to compile**

Run: `pnpm build`
Expected: FAIL — `BrowserFollowService` does not implement `unfollow`

Note: `recordingFollower()` in `src/services/__tests__/AutoFollowRunner.test.ts` also implements `IFollower` and will fail to compile. Add a stub there that throws `new Error("unfollow must not be called")` — the follow runner must never unfollow, so a throwing stub is the correct assertion.

- [ ] **Step 3: Implement `unfollow` in `BrowserFollowService`**

Add alongside the existing `follow`. Unlike Follow, X opens a **confirmation dialog**, so the flow is click → confirm → verify the flip.

```ts
  async unfollow(username: string): Promise<UnfollowResult> {
    await this.login();
    const page = await this.context!.newPage();
    try {
      await page.goto(`https://x.com/${username}`, { waitUntil: "domcontentloaded" });

      // The followed-state button renders as "Following @user" or "Unfollow @user"
      // depending on the UI variant and hover state — accept either, exactly as
      // the follow path does.
      const followedState = page.getByRole("button", {
        name: new RegExp(`^(Following|Unfollow) @${username}$`, "i"),
      });
      const followButton = page.getByRole("button", {
        name: new RegExp(`^Follow @${username}$`, "i"),
      });

      const isFollowed = await followedState
        .waitFor({ state: "visible", timeout: 15000 })
        .then(() => true)
        .catch(() => false);

      if (!isFollowed) {
        // Already not following is a valid outcome; nothing rendering at all is not.
        const canFollow = await followButton.isVisible({ timeout: 3000 }).catch(() => false);
        if (canFollow) return "not-following";
        throw new Error(
          `neither Follow nor Following/Unfollow button rendered for @${username} within 15s`
        );
      }

      await followedState.click();

      // Confirmation dialog — its confirm button carries a stable test id.
      const confirm = page.getByTestId("confirmationSheetConfirm");
      const sawDialog = await confirm
        .waitFor({ state: "visible", timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (sawDialog) await confirm.click();

      // Confirm the flip back to Follow. As with the follow path, a slow
      // confirmation is treated as success rather than retried — clicking again
      // would re-follow, which is the one thing we must never do.
      const flipped = await followButton
        .waitFor({ state: "visible", timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      if (!flipped) {
        console.warn(
          `Clicked Unfollow for @${username} but confirmation was slow — assuming unfollowed`
        );
      }
      return "unfollowed";
    } finally {
      await page.close();
    }
  }
```

Import `UnfollowResult` alongside the existing `IFollower, FollowResult` import.

- [ ] **Step 4: Verify against a real profile**

Create `/tmp/try-unfollow.ts`:

```ts
import "dotenv/config";
import { BrowserFollowService } from "./src/services/BrowserFollowService";

const handle = process.argv[2];
const s = new BrowserFollowService({
  xUser: process.env.X_USER!,
  xEmail: process.env.X_EMAIL ?? "",
  xPassword: process.env.X_PASSWORD ?? "",
  storageStatePath: ".auth/x-session.json",
  headless: false,
});
s.unfollow(handle)
  .then((r) => console.log("result:", r))
  .finally(() => s.close());
```

Run: `pnpm ts-node /tmp/try-unfollow.ts SOME_TEST_HANDLE`

Pick a genuinely junk handle from the census — this is a real unfollow and cannot be undone. Expected: the profile opens, the dialog appears and is confirmed, `result: unfollowed` prints. Run it again on the same handle; expected `result: not-following`.

- [ ] **Step 5: Commit**

```bash
git add src/follow/IFollower.ts src/services/BrowserFollowService.ts src/services/__tests__/AutoFollowRunner.test.ts
git commit -m "feat: add unfollow to the browser follower

Extends IFollower with unfollow() and implements it on the Playwright
path, which is the only working write path — the twitterapi.io API needs
a proxy we do not have.

Unlike Follow, X gates unfollow behind a confirmation dialog, so the
flow is click, confirm, then verify the button flips back. A slow
confirmation is treated as success rather than retried: clicking again
would re-follow the account, which X treats as spam. The follow runner's
test fake gets a throwing unfollow stub, since that path must never
unfollow."
```

---

### Task 3: Permanent unfollowed blocklist

**Files:**
- Modify: `src/services/FollowStore.ts`
- Test: `src/services/__tests__/FollowStore.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `FollowStore.markUnfollowed(username: string): void`
  - `FollowStore.wasUnfollowed(username: string): boolean`
  - `FollowStore.unfollowedCount(): number`
  - `enqueue` gains a third skip condition: usernames in `unfollowed`

This set is load-bearing, not bookkeeping — it is the mechanism that stops the follow loop re-following a cleaned account, which X prohibits.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/services/__tests__/FollowStore.test.ts
test("markUnfollowed is case-insensitive and queryable", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.markUnfollowed("Spammer");
  assert.equal(store.wasUnfollowed("spammer"), true);
  assert.equal(store.wasUnfollowed("SPAMMER"), true);
  assert.equal(store.unfollowedCount(), 1);
});

test("enqueue skips a previously unfollowed user", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.markUnfollowed("spammer");
  store.enqueue("spammer");
  assert.equal(store.queueSize(), 0);
  assert.equal(store.isQueued("spammer"), false);
});

test("unfollowed set round-trips through save and load", () => {
  const file = tmpFile();
  const a = new FollowStore(file);
  a.load();
  a.markUnfollowed("spammer");
  a.save();

  const b = new FollowStore(file);
  b.load();
  assert.equal(b.wasUnfollowed("spammer"), true);
});

test("removing from the followed set does not clear the unfollowed record", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.add("spammer");
  store.markUnfollowed("spammer");
  store.remove("spammer");
  assert.equal(store.wasUnfollowed("spammer"), true);
  store.enqueue("spammer");
  assert.equal(store.queueSize(), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `store.markUnfollowed is not a function`

- [ ] **Step 3: Implement**

In `FollowStoreData`, add `unfollowed?: string[];`.

As a class field:

```ts
  /**
   * Handles we have unfollowed. Append-only and never cleared — X prohibits
   * re-following an account you unfollowed, so this set permanently excludes
   * them from the candidate queue.
   */
  private unfollowed = new Set<string>();
```

In `load()`'s `try`: `this.unfollowed = new Set((data.unfollowed ?? []).map((u) => u.toLowerCase()));`
In `load()`'s `catch`: `this.unfollowed = new Set();`

Add the methods:

```ts
  /** Record a handle as unfollowed. Permanent — never removed. */
  markUnfollowed(username: string): void {
    this.unfollowed.add(username.toLowerCase());
  }

  wasUnfollowed(username: string): boolean {
    return this.unfollowed.has(username.toLowerCase());
  }

  unfollowedCount(): number {
    return this.unfollowed.size;
  }
```

Change `enqueue`'s guard to:

```ts
    const key = username.toLowerCase();
    if (this.followed.has(key) || this.queuedKeys.has(key) || this.unfollowed.has(key)) return;
```

In `save()`'s `data` object, add `unfollowed: [...this.unfollowed],`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — including the pre-existing FollowStore tests

- [ ] **Step 5: Commit**

```bash
git add src/services/FollowStore.ts src/services/__tests__/FollowStore.test.ts
git commit -m "feat: track unfollowed handles as a permanent blocklist

X prohibits re-following an account you unfollowed, so every unfollow is
final and the tool has to remember it. enqueue now skips this set
alongside followed and queued, keeping cleaned accounts out of the
candidate queue for good.

The set is append-only: remove() clearing the followed entry must not
resurrect a cleaned account, so that case has its own test."
```

---

### Task 4: Cleanup runner

**Files:**
- Create: `src/services/CleanupRunner.ts`
- Test: `src/services/__tests__/CleanupRunner.test.ts`

**Interfaces:**
- Consumes: `IFollower.unfollow` (Task 2), `FollowStore.markUnfollowed` (Task 3)
- Produces:
  - `export interface CleanupTarget { userName: string; score: number; reasons: string[] }`
  - `export interface CleanupRunnerOptions { targets: CleanupTarget[]; maxPerRun: number; dryRun: boolean; delayMs?: () => number }`
  - `export interface CleanupSummary { startedAt: string; finishedAt: string; durationMs: number; attempted: number; unfollowedCount: number; notFollowing: number; failures: number; remaining: number; unfollowed: CleanupTarget[]; wouldUnfollow: CleanupTarget[]; dryRun: boolean }`
  - `export class CleanupRunner { constructor(follower: IFollower, store: FollowStore, options: CleanupRunnerOptions); runCycle(): Promise<CleanupSummary> }`

`delayMs` is injectable so tests run instantly; production omits it and gets the 30–90 s randomised delay.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/__tests__/CleanupRunner.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CleanupRunner, CleanupTarget } from "../CleanupRunner";
import { FollowStore } from "../FollowStore";
import { IFollower, FollowResult, UnfollowResult } from "../../follow/IFollower";

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cr-")), "state.json");
}

function store(): FollowStore {
  const s = new FollowStore(tmpFile());
  s.load();
  return s;
}

function targets(...names: string[]): CleanupTarget[] {
  return names.map((userName) => ({ userName, score: 4, reasons: ["self-declared-kol"] }));
}

class FakeFollower implements IFollower {
  calls: string[] = [];
  constructor(
    private readonly behaviour: Record<string, "unfollowed" | "not-following" | "throw"> = {}
  ) {}
  async follow(): Promise<FollowResult> {
    throw new Error("follow must not be called during cleanup");
  }
  async unfollow(username: string): Promise<UnfollowResult> {
    this.calls.push(username);
    const b = this.behaviour[username] ?? "unfollowed";
    if (b === "throw") throw new Error("boom");
    return b;
  }
}

const noDelay = () => 0;

test("unfollows up to maxPerRun and records each in the blocklist", async () => {
  const f = new FakeFollower();
  const s = store();
  const sum = await new CleanupRunner(f, s, {
    targets: targets("a", "b", "c"),
    maxPerRun: 2,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();

  assert.deepEqual(f.calls, ["a", "b"]);
  assert.equal(sum.unfollowedCount, 2);
  assert.equal(sum.remaining, 1);
  assert.equal(s.wasUnfollowed("a"), true);
  assert.equal(s.wasUnfollowed("b"), true);
  assert.equal(s.wasUnfollowed("c"), false);
});

test("a throwing unfollow does not wedge the run", async () => {
  const f = new FakeFollower({ b: "throw" });
  const s = store();
  const sum = await new CleanupRunner(f, s, {
    targets: targets("a", "b", "c"),
    maxPerRun: 3,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();

  assert.deepEqual(f.calls, ["a", "b", "c"]);
  assert.equal(sum.unfollowedCount, 2);
  assert.equal(sum.failures, 1);
  assert.equal(s.wasUnfollowed("b"), false, "a failed unfollow must not be recorded");
});

test("not-following counts separately and is still blocklisted", async () => {
  const f = new FakeFollower({ a: "not-following" });
  const s = store();
  const sum = await new CleanupRunner(f, s, {
    targets: targets("a"),
    maxPerRun: 5,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();

  assert.equal(sum.notFollowing, 1);
  assert.equal(sum.unfollowedCount, 0);
  assert.equal(
    s.wasUnfollowed("a"),
    true,
    "already-not-following still must never be re-followed"
  );
});

test("dry-run performs no unfollows and no writes", async () => {
  const f = new FakeFollower();
  const s = store();
  const sum = await new CleanupRunner(f, s, {
    targets: targets("a", "b"),
    maxPerRun: 2,
    dryRun: true,
    delayMs: noDelay,
  }).runCycle();

  assert.deepEqual(f.calls, []);
  assert.equal(sum.unfollowedCount, 0);
  assert.equal(sum.wouldUnfollow.length, 2);
  assert.equal(sum.unfollowed.length, 0);
  assert.equal(s.unfollowedCount(), 0);
});

test("an empty target list is a no-op, not an error", async () => {
  const sum = await new CleanupRunner(new FakeFollower(), store(), {
    targets: [],
    maxPerRun: 5,
    dryRun: false,
    delayMs: noDelay,
  }).runCycle();
  assert.equal(sum.attempted, 0);
  assert.equal(sum.remaining, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../CleanupRunner'`

- [ ] **Step 3: Implement**

```ts
// src/services/CleanupRunner.ts
import { IFollower } from "../follow/IFollower";
import { FollowStore } from "./FollowStore";

export interface CleanupTarget {
  userName: string;
  score: number;
  reasons: string[];
}

export interface CleanupRunnerOptions {
  /** Targets to unfollow, highest score first. Consumed from the front. */
  targets: CleanupTarget[];
  /** Max unfollows this cycle. */
  maxPerRun: number;
  dryRun: boolean;
  /** Injectable for tests; production uses the randomised 30–90 s delay. */
  delayMs?: () => number;
}

export interface CleanupSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  attempted: number;
  unfollowedCount: number;
  notFollowing: number;
  failures: number;
  /** Targets left over after this cycle. */
  remaining: number;
  unfollowed: CleanupTarget[];
  wouldUnfollow: CleanupTarget[];
  dryRun: boolean;
}

function randomDelayMs(): number {
  return 30000 + Math.floor(Math.random() * 60001); // 30000–90000
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CleanupRunner {
  constructor(
    private readonly follower: IFollower,
    private readonly store: FollowStore,
    private readonly options: CleanupRunnerOptions
  ) {}

  private delay(): number {
    return this.options.delayMs ? this.options.delayMs() : randomDelayMs();
  }

  async runCycle(): Promise<CleanupSummary> {
    const startedAt = new Date();
    const batch = this.options.targets.slice(0, this.options.maxPerRun);
    const remaining = Math.max(0, this.options.targets.length - batch.length);

    if (this.options.dryRun) {
      for (const t of batch) {
        console.log(
          `[dry-run] would unfollow @${t.userName} (score ${t.score}: ${t.reasons.join(", ")})`
        );
      }
      const finishedAt = new Date();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        attempted: 0,
        unfollowedCount: 0,
        notFollowing: 0,
        failures: 0,
        remaining,
        unfollowed: [],
        wouldUnfollow: batch,
        dryRun: true,
      };
    }

    const unfollowed: CleanupTarget[] = [];
    let notFollowing = 0;
    let failures = 0;

    for (let i = 0; i < batch.length; i++) {
      const t = batch[i];
      try {
        if (i > 0) await sleep(this.delay());
        const result = await this.follower.unfollow(t.userName);
        // Recorded on both outcomes: "not-following" still means this account
        // must never be re-followed.
        this.store.markUnfollowed(t.userName);
        this.store.remove(t.userName);
        if (result === "unfollowed") {
          unfollowed.push(t);
          console.log(`Unfollowed @${t.userName} (score ${t.score}: ${t.reasons.join(", ")})`);
        } else {
          notFollowing++;
          console.log(`Not following @${t.userName} — recorded anyway`);
        }
      } catch (err) {
        // A failed unfollow is NOT blocklisted: we may still be following them,
        // and the target stays eligible for a later cycle.
        failures++;
        console.error(
          `Unfollow failed for @${t.userName}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    this.store.save();
    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      attempted: batch.length,
      unfollowedCount: unfollowed.length,
      notFollowing,
      failures,
      remaining,
      unfollowed,
      wouldUnfollow: [],
      dryRun: false,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/CleanupRunner.ts src/services/__tests__/CleanupRunner.test.ts
git commit -m "feat: add the cleanup runner

Runs one batch of unfollows with the same randomised 30-90s rhythm the
follow loop uses, recording each handle in the permanent blocklist.

Two outcomes are deliberately asymmetric: 'not-following' is still
blocklisted, because the account must never be re-followed either way,
while a thrown failure is not, because we may still be following them
and the target should stay eligible for a later cycle. A throwing target
never wedges the batch."
```

---

### Task 5: Scan and run entry point

**Files:**
- Create: `src/examples/follow-cleanup.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `scoreAccount`, `fromFollowingsRecord`, `FollowingsRecord`, `UNFOLLOW_THRESHOLD` (Task 1); `CleanupRunner`, `CleanupTarget` (Task 4); `BrowserFollowService` (Task 2); `FollowStore` (Task 3); `config.unfollowPerRun` (Task 6)
- Produces: `output/cleanup-targets.json` — `{ generatedAt: string; account: string; total: number; targets: CleanupTarget[]; review: CleanupTarget[] }`

Scan is read-only and separate from run so the target list can be inspected before anything irreversible happens.

**Ordering note:** this task consumes `config.unfollowPerRun` from Task 6. Either do Task 6 first, or hardcode `9` here and swap it in Task 6 — the plan assumes the former.

- [ ] **Step 1: Write the entry point**

```ts
// src/examples/follow-cleanup.ts
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { loadAutoFollowConfig } from "../config";
import { BrowserFollowService } from "../services/BrowserFollowService";
import { CleanupRunner, CleanupTarget } from "../services/CleanupRunner";
import { FollowStore } from "../services/FollowStore";
import {
  scoreAccount,
  fromFollowingsRecord,
  FollowingsRecord,
  UNFOLLOW_THRESHOLD,
} from "../follow/scoring";

const TARGETS_PATH = path.join(process.cwd(), "output", "cleanup-targets.json");
const LOG_PATH = path.join(process.cwd(), "output", "auto-follow-log.jsonl");

function appendLog(record: unknown): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    console.error("Failed to write log:", err instanceof Error ? err.message : String(err));
  }
}

/** Page the account's whole following list. ~38 requests for 7.5k accounts. */
async function fetchFollowings(apiKey: string, userName: string): Promise<FollowingsRecord[]> {
  const all: FollowingsRecord[] = [];
  let cursor = "";
  for (let page = 0; page < 100; page++) {
    const url =
      `https://api.twitterapi.io/twitter/user/followings?userName=${encodeURIComponent(userName)}&pageSize=200` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const res = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!res.ok) throw new Error(`followings HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      followings?: FollowingsRecord[];
      has_next_page?: boolean;
      next_cursor?: string;
    };
    const batch = body.followings ?? [];
    all.push(...batch);
    process.stderr.write(`  page ${page + 1}: +${batch.length} (total ${all.length})\n`);
    if (!body.has_next_page || !body.next_cursor || batch.length === 0) break;
    cursor = body.next_cursor;
    await new Promise((r) => setTimeout(r, 300));
  }
  return all;
}

async function scan(): Promise<void> {
  const config = loadAutoFollowConfig();
  console.log(`Scanning @${config.xUser}'s following list...`);
  const accounts = await fetchFollowings(config.apiKey, config.xUser);

  const targets: CleanupTarget[] = [];
  const review: CleanupTarget[] = [];
  for (const record of accounts) {
    const { score, reasons } = scoreAccount(fromFollowingsRecord(record));
    if (score >= UNFOLLOW_THRESHOLD) targets.push({ userName: record.userName, score, reasons });
    else if (score > 0) review.push({ userName: record.userName, score, reasons });
  }
  targets.sort((a, b) => b.score - a.score);

  fs.mkdirSync(path.dirname(TARGETS_PATH), { recursive: true });
  fs.writeFileSync(
    TARGETS_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        account: config.xUser,
        total: accounts.length,
        targets,
        review,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`\nScanned ${accounts.length} accounts`);
  console.log(`  unfollow targets (score >= ${UNFOLLOW_THRESHOLD}): ${targets.length}`);
  console.log(`  review only (score 1-2, NOT actioned):            ${review.length}`);
  console.log(
    `  clean (score 0):                                  ${accounts.length - targets.length - review.length}`
  );
  console.log(`\nWritten to ${TARGETS_PATH}`);
  console.log("\nTop 20 targets:");
  for (const t of targets.slice(0, 20)) {
    console.log(`  [${t.score}] @${t.userName} — ${t.reasons.join(", ")}`);
  }
}

async function run(): Promise<void> {
  const config = loadAutoFollowConfig();
  if (!fs.existsSync(TARGETS_PATH)) {
    throw new Error(`No ${TARGETS_PATH}. Run 'pnpm follow-cleanup --scan' first.`);
  }
  const file = JSON.parse(fs.readFileSync(TARGETS_PATH, "utf8")) as { targets: CleanupTarget[] };

  const store = new FollowStore(config.statePath);
  store.load();

  // Anything already cleaned in an earlier cycle is skipped, so --run is safe
  // to re-invoke across days.
  const pending = file.targets.filter((t) => !store.wasUnfollowed(t.userName));
  console.log(
    `${pending.length} targets pending (${file.targets.length - pending.length} already done)`
  );
  if (pending.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const follower = new BrowserFollowService({
    xUser: config.xUser,
    xEmail: config.xEmail,
    xPassword: config.xPassword,
    xTotp: config.xTotp,
    storageStatePath: config.storageStatePath,
    headless: process.env["HEADLESS"] !== "false",
  });

  try {
    const summary = await new CleanupRunner(follower, store, {
      targets: pending,
      maxPerRun: config.unfollowPerRun,
      dryRun: config.dryRun,
    }).runCycle();

    console.log(
      `Cleanup done — attempted ${summary.attempted}, unfollowed ${summary.unfollowedCount}, ` +
        `not-following ${summary.notFollowing}, failures ${summary.failures}, remaining ${summary.remaining}`
    );
    appendLog({ type: "cleanup", ...summary });
  } finally {
    await follower.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--scan")) return scan();
  if (args.includes("--run")) return run();
  console.log("Usage: pnpm follow-cleanup --scan | --run");
  console.log("  --scan  read-only: score the following list, write output/cleanup-targets.json");
  console.log("  --run   execute unfollows against that file (honours dryRun in config)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, after `"follow-status"`:

```json
    "follow-cleanup": "ts-node src/examples/follow-cleanup.ts"
```

- [ ] **Step 3: Verify the scan runs read-only**

Run: `pnpm follow-cleanup --scan`

Expected: 38 pages fetched, then a summary reporting roughly 388 targets, 405 review, 6,675 clean. `output/cleanup-targets.json` exists. No unfollow occurred.

If the target count differs substantially from 388, stop and investigate before proceeding — the census was taken 2026-09-02 and the list drifts by 2–3 accounts/day through suspensions, but not by hundreds.

- [ ] **Step 4: Verify the dry run**

Run: `pnpm follow-cleanup --run` (config still has `dryRun: true`)

Expected: `[dry-run] would unfollow @...` lines, no browser action, and `.auth/auto-follow-state.json` unchanged (`git status` on it, or compare `unfollowedCount`).

- [ ] **Step 5: Commit**

```bash
git add src/examples/follow-cleanup.ts package.json
git commit -m "feat: add follow-cleanup scan and run entry point

--scan pages the whole following list, scores every account and writes
output/cleanup-targets.json; --run executes against that file. They are
separate commands so the target list can be inspected before anything
irreversible happens, and --run skips anything already in the blocklist
so it is safe to re-invoke across days.

Honours dryRun from config the same way the follow loop does."
```

---

### Task 6: Config fields and intake filters

**Files:**
- Modify: `src/config.ts`
- Modify: `src/services/AutoFollowRunner.ts`
- Test: `src/services/__tests__/AutoFollowRunner.test.ts`

**Interfaces:**
- Consumes: `scoreAccount`, `fromSearchAuthor` (Task 1)
- Produces: `AutoFollowConfig` gains `maxFollowers: number`, `unfollowPerRun: number`, `unfollowPerDay: number`; `CycleSummary` gains `skippedScored: number`, `skippedTooBig: number`

**On the activity requirement.** The spec lists "no tweet in the last 30 days" as an intake filter. It is **not implemented, and does not need to be**: candidates are authors of tweets returned by `advanced_search` with `queryType: "Latest"`, so every candidate has by construction tweeted recently enough to appear in a chronological search. A separate activity check would cost one read call per candidate to re-derive a property the pipeline already guarantees. The `requireRecentActivityDays` config field from the spec is therefore **not added**; if the search ever moves to `queryType: "Top"`, revisit this.

- [ ] **Step 1: Write the failing tests**

The harness in this file uses `fakeSearch(byQuery)` with `FakeTweet.author`. Extend the `FakeTweet` author type with the fields the scorer reads:

```ts
interface FakeTweet {
  author?: {
    userName: string;
    name: string;
    isVerified?: boolean;
    isBlueVerified?: boolean;
    verifiedType?: string | null;
    description?: string;
    followers?: number;
    following?: number;
    statusesCount?: number;
    profilePicture?: string;
    coverPicture?: string | null;
  };
}
```

Then add:

```ts
test("a candidate whose bio scores above zero is not queued", async () => {
  const search = fakeSearch({
    kw1: [
      {
        author: {
          userName: "shill",
          name: "Shill",
          description: "Crypto OG | KOL",
          followers: 20000,
          following: 500,
          statusesCount: 3000,
        },
      },
    ],
  });
  const follower = recordingFollower();
  const store = tmpStore();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, []);
  assert.equal(store.queueSize(), 0);
  assert.equal(summary.skippedScored, 1);
});

test("a candidate over the follower ceiling is not queued", async () => {
  const search = fakeSearch({
    kw1: [
      {
        author: {
          userName: "megacorp",
          name: "Mega",
          description: "Breaking news, fast.",
          followers: 1371990,
          following: 171,
          statusesCount: 91806,
        },
      },
    ],
  });
  const follower = recordingFollower();
  const store = tmpStore();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, []);
  assert.equal(summary.skippedTooBig, 1);
});

test("a clean candidate under the ceiling is still queued and followed", async () => {
  const search = fakeSearch({
    kw1: [
      {
        author: {
          userName: "realdev",
          name: "Real Dev",
          description: "Engineer. Building things.",
          followers: 4200,
          following: 300,
          statusesCount: 1800,
        },
      },
    ],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, ["realdev"]);
  assert.equal(summary.skippedScored, 0);
  assert.equal(summary.skippedTooBig, 0);
});
```

The third test is the control: without it, the two rejections could pass because the harness is broken rather than because the filters fire.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `maxFollowers` is not an accepted option, and `skippedScored` is undefined

- [ ] **Step 3: Add the config fields**

In `AutoFollowConfig`:

```ts
  maxFollowers: number;
  unfollowPerRun: number;
  unfollowPerDay: number;
```

The same three as optional in `AutoFollowFile`. In the returned object:

```ts
    maxFollowers: file.maxFollowers ?? 500000,
    unfollowPerRun: file.unfollowPerRun ?? 9,
    unfollowPerDay: file.unfollowPerDay ?? 50,
```

- [ ] **Step 4: Implement the filters**

Add `maxFollowers: number` to `AutoFollowRunnerOptions`. Import `scoreAccount` and `fromSearchAuthor` from `../follow/scoring`.

In the candidate-queueing loop, alongside the existing verified-tier check, add two rejections before `enqueue`:

```ts
      if (scoreAccount(fromSearchAuthor(author)).score > 0) {
        skippedScored++;
        continue;
      }
      if ((author.followers ?? 0) > this.options.maxFollowers) {
        skippedTooBig++;
        continue;
      }
```

Declare `skippedScored` and `skippedTooBig` beside the existing `skippedUnverified` counter, add both to `CycleSummary` with doc comments, and populate them in `runCycle`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — including the pre-existing runner tests

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/services/AutoFollowRunner.ts src/services/__tests__/AutoFollowRunner.test.ts
git commit -m "feat: gate follow intake on the cleanup score and a follower ceiling

Reuses the cleanup's scoring function at the entry point: only accounts
scoring 0 are queued. The exit rule and the entry rule being the same
rule is what stops the list re-contaminating by the mechanism that
filled it.

Adds a 500k follower ceiling, which the per-keyword analysis showed is
where media orgs, clubs and celebrities start dominating. Cycle
summaries break out skippedScored and skippedTooBig so the log shows
which filter is doing the work.

The spec's 30-day activity requirement is deliberately not implemented:
candidates are authors of tweets from a Latest-sorted search, so recent
activity is already guaranteed by construction and a per-candidate read
call would only re-derive it."
```

---

### Task 7: Keyword and config changes

**Files:**
- Modify: `config/auto-follow.json`

**Interfaces:**
- Consumes: the config fields added in Task 6
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Remove the six high-junk keywords**

Delete these entries exactly:

```
"futures trading min_faves:120"
"onchain AI min_faves:120"
"algorithmic trading min_faves:100"
"web3 min_faves:150"
"diffusion models min_faves:80"
"RWA min_faves:120"
```

Measured junk rates were 24.7%, 20.5%, 17.9%, 17.5%, 17.1% and 16.7% respectively, against a 5.3% baseline.

- [ ] **Step 2: Lower every `min_faves` at or above 200**

| From | To |
| --- | --- |
| `bitcoin min_faves:250` | `bitcoin min_faves:120` |
| `AI agents min_faves:250` | `AI agents min_faves:120` |
| `ethereum min_faves:200` | `ethereum min_faves:100` |
| `GPT min_faves:200` | `GPT min_faves:100` |
| `agentic AI min_faves:200` | `agentic AI min_faves:100` |

Raising `min_faves` is what pulled in mega-accounts: `agentic AI min_faves:400` produced 42.3% accounts over 500k followers, against 0.0% for every Korean-language keyword.

- [ ] **Step 3: Add the new tunables**

After `"unhealthyAfterZeroCycles"`, add:

```json
  "maxFollowers": 500000,
  "unfollowPerRun": 9,
  "unfollowPerDay": 50,
```

- [ ] **Step 4: Verify the config still loads**

Run: `pnpm follow-cleanup` (no args — prints usage, which forces a config parse)
Expected: usage text, no JSON parse error.

Then confirm `"dryRun": true` is still present and unchanged: `grep dryRun config/auto-follow.json`

- [ ] **Step 5: Commit**

```bash
git add config/auto-follow.json
git commit -m "feat: drop high-junk keywords and lower min_faves thresholds

Per-keyword junk rates from the census identify six keywords at or above
15% against a 5.3% baseline, the worst being futures trading:120 at
24.7%. Removed.

min_faves at or above 200 is lowered into the 100-150 band because
raising it is what pulls in mega-accounts — agentic AI:400 produced
42.3% accounts over 500k followers while every Korean-language keyword
produced zero junk and zero mega-accounts.

Adds the intake and cleanup tunables. dryRun stays true in git."
```

---

### Task 8: Dry-run log field fix

**Files:**
- Modify: `src/services/AutoFollowRunner.ts`
- Modify: `src/examples/auto-follow.ts` (the cycle console line, around line 313)
- Test: `src/services/__tests__/AutoFollowRunner.test.ts`

**Interfaces:**
- Consumes: `CycleSummary` (existing)
- Produces: `CycleSummary` gains `wouldFollow: FollowedCandidate[]`; `followed` is empty in dry-run

- [ ] **Step 1: Write the failing test**

```ts
test("dry-run reports would-be targets as wouldFollow, not followed", async () => {
  const search = fakeSearch({
    kw1: [
      {
        author: {
          userName: "alice",
          name: "A",
          description: "Engineer.",
          followers: 3000,
          following: 200,
          statusesCount: 900,
        },
      },
      {
        author: {
          userName: "bob",
          name: "B",
          description: "Researcher.",
          followers: 4000,
          following: 300,
          statusesCount: 1200,
        },
      },
    ],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, [], "dry-run must not follow");
  assert.equal(summary.followed.length, 0, "followed must be empty in dry-run");
  assert.equal(summary.wouldFollow.length, 2);
  assert.equal(summary.addedCount, 0);
});

test("a real run reports followed and leaves wouldFollow empty", async () => {
  const search = fakeSearch({
    kw1: [
      {
        author: {
          userName: "alice",
          name: "A",
          description: "Engineer.",
          followers: 3000,
          following: 200,
          statusesCount: 900,
        },
      },
    ],
  });
  const runner = new AutoFollowRunner(search, tmpStore(), recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
    maxFollowers: 500000,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.followed.length, 1);
  assert.equal(summary.wouldFollow.length, 0);
  assert.equal(summary.addedCount, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `summary.followed` holds the peeked targets and `wouldFollow` is undefined

- [ ] **Step 3: Implement**

Change `drainQueue`'s return type to carry both:

```ts
  private async drainQueue(): Promise<{
    followed: FollowedCandidate[];
    wouldFollow: FollowedCandidate[];
    attempted: number;
    alreadyFollowing: number;
  }> {
```

The dry-run branch returns:

```ts
      return {
        followed: [],
        wouldFollow: targets.map(toCandidate),
        attempted: 0,
        alreadyFollowing: 0,
      };
```

The real branch returns `wouldFollow: []`. Add `wouldFollow` to `CycleSummary`:

```ts
  /** Candidates a dry-run would have followed. Empty in a real run. */
  wouldFollow: FollowedCandidate[];
```

and update the `followed` field's doc comment — it no longer means "or, in dry-run, would-follow". Populate both in `runCycle`.

In `src/examples/auto-follow.ts`, the cycle console line must report the right field per mode:

```ts
      console.log(
        `Cycle done — scanned ${summary.scanned}, ` +
          `queued ${summary.queued}, ` +
          `${summary.dryRun ? `would-follow ${summary.wouldFollow.length}` : `followed ${summary.followed.length}`}, ` +
          `already-following ${summary.alreadyFollowing}`
      );
```

`src/examples/follow-status.ts` reads only `addedCount` from these records and needs no change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/AutoFollowRunner.ts src/examples/auto-follow.ts src/services/__tests__/AutoFollowRunner.test.ts
git commit -m "fix: stop dry-run cycles logging would-be targets as followed

In dry-run the runner peeked the queue and reported those candidates in
the summary's followed field while addedCount stayed 0. Because dry-run
never drains the queue, every hourly cycle logged the same top 25
accounts under a field named followed.

Over 354 such cycles this turned 16,468 logged entries into 7,622 unique
ones and inflated a keyword analysis roughly threefold before it was
caught. Dry-run now reports wouldFollow and leaves followed empty.

Historical log lines keep the old shape; analysis over them must filter
to addedCount > 0 && followed.length === addedCount."
```

---

### Task 9: Operations documentation

**Files:**
- Modify: `docs/auto-follow-operations.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Document the cleanup command**

Add two rows to the Commands table:

| Command | Purpose | Network |
| --- | --- | --- |
| `pnpm follow-cleanup --scan` | Score the whole following list, write `output/cleanup-targets.json`. Read-only. | Read API |
| `pnpm follow-cleanup --run` | Unfollow the scored targets. Honours `dryRun`. | Browser |

- [ ] **Step 2: Document the new config fields**

Add `maxFollowers` (default `500000`), `unfollowPerRun` (`9`) and `unfollowPerDay` (`50`) to the configuration table, each with what it does and when to change it.

- [ ] **Step 3: Add a cleanup operations section**

Cover: the scan/run split and why it exists; the rate ceiling (9 per run, one run per hour, 50/day rising to 100/day) and where it came from; that unfollows are permanent because re-following is prohibited; that the service must be stopped and `dryRun` left `true` until cleanup finishes; and the `type:"cleanup"` JSONL record's fields.

Link to `docs/follow-unfollow-limits-2026-09.md` for the limit research and `docs/superpowers/specs/2026-09-02-following-cleanup-design.md` for the design.

- [ ] **Step 4: Fix the stale dry-run claim**

The Configuration table's `dryRun` row says *"the running service uses a working-tree copy set to false"*. That is no longer true — the service has been running in dry-run since 2026-07-29. Correct it.

- [ ] **Step 5: Update the log documentation**

The "Logs & monitoring" section describes the `type:"cycle"` line's fields. Add `wouldFollow`, `skippedScored` and `skippedTooBig`, and note that historical lines before this change record dry-run targets in `followed`, so analysis must filter to `addedCount > 0 && followed.length === addedCount`.

- [ ] **Step 6: Commit**

```bash
git add docs/auto-follow-operations.md
git commit -m "docs: document the cleanup command and correct the dryRun note

Adds follow-cleanup --scan/--run, the three new config fields and a
cleanup operations section covering the rate ceiling, why unfollows are
permanent, and the JSONL record shape.

Corrects the dryRun row, which claimed the running service used a
working-tree copy set to false — it has been running in dry-run since
2026-07-29. Also documents the new cycle-summary fields and the filter
historical log analysis needs."
```

---

## Execution notes

Tasks 1, 3, 4, 6 and 8 are verifiable entirely with `pnpm test`. Task 2's Step 4 is the first **irreversible** action (a real unfollow) and Task 5's Step 3 is the first network call — both need a human present.

Task 5 consumes `config.unfollowPerRun` from Task 6, so run Task 6 before Task 5, or hardcode `9` and swap it.

After Task 9, the operational sequence from the spec begins. It is **not** part of this plan:

1. `pnpm follow-cleanup --scan`, inspect the 388.
2. `pnpm follow-cleanup --run` with `dryRun: true`, confirm targets and pacing.
3. Stop the service, set `dryRun: false` in the working tree only, run the cleanup to completion over 4–6 days at 50/day rising to 100/day.
4. Restore `dryRun: true`, wait, then restart the follow loop.
