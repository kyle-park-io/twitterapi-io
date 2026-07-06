# Verified-Only Follow Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Follow only verified/paid accounts — X Premium (blue), legacy, Business, Government — by filtering search authors against a configurable `allowedVerified` tier list before they are queued.

**Architecture:** Two pure helpers (`authorTiers`, `passesVerifiedFilter`) map an author's raw verification signals to named tiers and decide eligibility. `fillQueue` applies the filter before enqueuing and counts rejects as `skippedUnverified`. The tier list flows from config; the author's tiers ride along the queue candidate into the JSONL log.

**Tech Stack:** TypeScript (CommonJS, TS 6), ts-node, `node --test` via `ts-node/register/transpile-only`.

## Global Constraints

- Test runner: `pnpm test` (= `node --require ts-node/register/transpile-only --test "src/**/*.test.ts"`). Type-check: `pnpm exec tsc --noEmit`.
- Tests use `import { test } from "node:test"` and `import assert from "node:assert/strict"`; unit tests in `src/services/__tests__/*.test.ts`, relative `../` imports.
- `examples/` scripts have no tests; must compile and not break the suite.
- Commit convention: Conventional Commits, NO `Co-Authored-By` trailer, every commit has a body.
- Tier mapping (EXACT): `blue` ⟸ `isBlueVerified === true`; `legacy` ⟸ `isVerified === true`; `business` ⟸ `verifiedType === "Business"`; `government` ⟸ `verifiedType === "Government"`. `verifiedType` values are case-sensitive exactly as the API sends them (`"Business"`, `"Government"`, or `null`).
- Filter rule (EXACT): empty `allowed` array → filter OFF (every author passes). Non-empty → author passes iff it holds at least one tier in `allowed`. An author with no tiers is skipped when the filter is on.
- Default config value: `allowedVerified` = `["blue","legacy","business","government"]`.
- Unknown tier names in config are dropped with `console.warn`; if that empties the list, the filter is off (not an error).
- Backward compat: `.auth/auto-follow-state.json` candidates without `verified` still load.

## Type reference (defined across tasks, used throughout)

```ts
// AutoFollowRunner.ts (Task 1)
export type VerifiedTier = "blue" | "legacy" | "business" | "government";
interface AuthorVerification {
  isVerified?: boolean;
  isBlueVerified?: boolean;
  verifiedType?: string | null;
}
export function authorTiers(author: AuthorVerification): VerifiedTier[];
export function passesVerifiedFilter(author: AuthorVerification, allowed: VerifiedTier[]): boolean;

// FollowStore.ts (Task 2): Candidate gains  verified?: string[]
// AutoFollowRunner (Task 2): AutoFollowRunnerOptions gains allowedVerified: VerifiedTier[];
//   AuthoredTweet.author gains isVerified?/isBlueVerified?/verifiedType?;
//   CycleSummary gains skippedUnverified: number;
//   FollowedCandidate gains verified?: string[]
// config.ts (Task 3): AutoFollowConfig gains allowedVerified: VerifiedTier[]
```

---

### Task 1: Verified-tier pure helpers

**Files:**
- Modify: `src/services/AutoFollowRunner.ts`
- Test: `src/services/__tests__/AutoFollowRunner.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `VerifiedTier` type, `authorTiers(author)`, `passesVerifiedFilter(author, allowed)` — all exported.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/__tests__/AutoFollowRunner.test.ts`:

```ts
import { authorTiers, passesVerifiedFilter } from "../AutoFollowRunner";

test("authorTiers maps each signal to its tier", () => {
  assert.deepEqual(authorTiers({ isBlueVerified: true }), ["blue"]);
  assert.deepEqual(authorTiers({ isVerified: true }), ["legacy"]);
  assert.deepEqual(authorTiers({ verifiedType: "Business" }), ["business"]);
  assert.deepEqual(authorTiers({ verifiedType: "Government" }), ["government"]);
});

test("authorTiers returns all held tiers, or none", () => {
  assert.deepEqual(
    authorTiers({ isBlueVerified: true, verifiedType: "Business" }).sort(),
    ["blue", "business"]
  );
  assert.deepEqual(authorTiers({ isBlueVerified: false, isVerified: false, verifiedType: null }), []);
  assert.deepEqual(authorTiers({}), []);
});

test("passesVerifiedFilter: empty allowed means filter off", () => {
  assert.equal(passesVerifiedFilter({}, []), true);
  assert.equal(passesVerifiedFilter({ isBlueVerified: false }, []), true);
});

test("passesVerifiedFilter matches when a held tier is allowed", () => {
  assert.equal(passesVerifiedFilter({ isBlueVerified: true }, ["blue"]), true);
  assert.equal(passesVerifiedFilter({ verifiedType: "Business" }, ["blue", "business"]), true);
});

test("passesVerifiedFilter rejects when no held tier is allowed", () => {
  assert.equal(passesVerifiedFilter({ verifiedType: "Business" }, ["blue"]), false);
  assert.equal(passesVerifiedFilter({}, ["blue"]), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `authorTiers` / `passesVerifiedFilter` not exported.

- [ ] **Step 3: Implement the helpers**

In `src/services/AutoFollowRunner.ts`, add near the top after the imports (before `interface AuthoredTweet`):

```ts
export type VerifiedTier = "blue" | "legacy" | "business" | "government";

interface AuthorVerification {
  isVerified?: boolean;
  isBlueVerified?: boolean;
  verifiedType?: string | null;
}

/** The verification tiers an author holds (may be several, or none). */
export function authorTiers(author: AuthorVerification): VerifiedTier[] {
  const tiers: VerifiedTier[] = [];
  if (author.isBlueVerified === true) tiers.push("blue");
  if (author.isVerified === true) tiers.push("legacy");
  if (author.verifiedType === "Business") tiers.push("business");
  if (author.verifiedType === "Government") tiers.push("government");
  return tiers;
}

/**
 * True if the author may be followed under `allowed`. Empty `allowed` = filter
 * off (always true). Otherwise true iff the author holds a tier in `allowed`.
 */
export function passesVerifiedFilter(
  author: AuthorVerification,
  allowed: VerifiedTier[]
): boolean {
  if (allowed.length === 0) return true;
  const held = authorTiers(author);
  return held.some((t) => allowed.includes(t));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — the 5 new tests pass, all existing tests still pass.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/AutoFollowRunner.ts src/services/__tests__/AutoFollowRunner.test.ts
git commit -m "feat: add verified-tier helpers for author filtering

authorTiers maps an author's isBlueVerified/isVerified/verifiedType
signals to named tiers (blue/legacy/business/government), and
passesVerifiedFilter decides eligibility against an allowed list (empty
list = filter off). Pure functions, unit-tested for each signal, the
multi-tier case, and the empty/match/no-match filter cases."
```

---

### Task 2: Wire the filter through queue, runner, and summary

**Files:**
- Modify: `src/services/FollowStore.ts`
- Modify: `src/services/AutoFollowRunner.ts`
- Test: `src/services/__tests__/FollowStore.test.ts`
- Test: `src/services/__tests__/AutoFollowRunner.test.ts`

**Interfaces:**
- Consumes: Task 1's `authorTiers`, `passesVerifiedFilter`, `VerifiedTier`.
- Produces: `Candidate.verified?: string[]`; `enqueue(userName, meta?)` meta gains `verified?: string[]`; `AutoFollowRunnerOptions.allowedVerified: VerifiedTier[]`; `AuthoredTweet.author` gains verification fields; `CycleSummary.skippedUnverified: number`; `FollowedCandidate.verified?: string[]`.

- [ ] **Step 1: Write the failing tests**

In `src/services/__tests__/FollowStore.test.ts`, append:

```ts
test("enqueue stores verified tiers and round-trips", () => {
  const file = tmpFile();
  const store = new FollowStore(file);
  store.load();
  store.enqueue("carol", { name: "Carol", keyword: "AI", verified: ["blue"] });
  store.save();
  const reloaded = new FollowStore(file);
  reloaded.load();
  assert.deepEqual(reloaded.dequeue(1), [
    { userName: "carol", name: "Carol", keyword: "AI", verified: ["blue"] },
  ]);
});
```

In `src/services/__tests__/AutoFollowRunner.test.ts`, the `fakeSearch` helper's
`FakeTweet` type must allow verification fields. Update the interface near the
top of that file from:

```ts
interface FakeTweet {
  author?: { userName: string; name: string };
}
```

to:

```ts
interface FakeTweet {
  author?: {
    userName: string;
    name: string;
    isVerified?: boolean;
    isBlueVerified?: boolean;
    verifiedType?: string | null;
  };
}
```

Then append this test:

```ts
test("fillQueue skips unverified authors and counts them", async () => {
  const store = tmpStore();
  const search = fakeSearch({
    kw1: [
      { author: { userName: "verified1", name: "V1", isBlueVerified: true } },
      { author: { userName: "plain1", name: "P1", isBlueVerified: false } },
      { author: { userName: "biz1", name: "B1", verifiedType: "Business" } },
    ],
  });
  const runner = new AutoFollowRunner(search, store, recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: ["blue", "business"],
  });

  const summary = await runner.runCycle();

  // plain1 is skipped; verified1 (blue) and biz1 (business) are queued.
  assert.equal(summary.skippedUnverified, 1);
  assert.equal(store.queueSize(), 2);
  const queued = store.peek(10).map((c) => c.userName).sort();
  assert.deepEqual(queued, ["biz1", "verified1"]);
  const v1 = store.peek(10).find((c) => c.userName === "verified1")!;
  assert.deepEqual(v1.verified, ["blue"]);
});

test("fillQueue with empty allowedVerified keeps everyone (filter off)", async () => {
  const store = tmpStore();
  const search = fakeSearch({
    kw1: [
      { author: { userName: "plain1", name: "P1", isBlueVerified: false } },
      { author: { userName: "plain2", name: "P2" } },
    ],
  });
  const runner = new AutoFollowRunner(search, store, recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
    allowedVerified: [],
  });

  const summary = await runner.runCycle();
  assert.equal(summary.skippedUnverified, 0);
  assert.equal(store.queueSize(), 2);
});
```

Also, every EXISTING `AutoFollowRunner` test constructs `AutoFollowRunnerOptions`
without `allowedVerified`, which will now be a required field. Add
`allowedVerified: [],` to each existing runner-options object in that test file
(the filter-off default keeps their behavior identical).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `allowedVerified` missing / `skippedUnverified` undefined / `verified` not stored.

- [ ] **Step 3: Update FollowStore**

In `src/services/FollowStore.ts`:

Extend `Candidate`:

```ts
export interface Candidate {
  userName: string;
  name?: string;
  keyword?: string;
  verified?: string[];
}
```

Update `enqueue`'s signature and body to carry `verified`:

```ts
  enqueue(
    username: string,
    meta?: { name?: string; keyword?: string; verified?: string[] }
  ): void {
    const key = username.toLowerCase();
    if (this.followed.has(key) || this.queuedKeys.has(key)) return;
    this.queue.push({ userName: username, ...meta });
    this.queuedKeys.add(key);
  }
```

(No change to load/save — `verified` rides in the `Candidate` object already
persisted as-is.)

- [ ] **Step 4: Update AutoFollowRunner**

In `src/services/AutoFollowRunner.ts`:

Extend `AuthoredTweet`:

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

Add `allowedVerified` to `AutoFollowRunnerOptions` (after `pickKeywords?`):

```ts
  /** Verification tiers allowed through the filter; empty = filter off. */
  allowedVerified: VerifiedTier[];
```

Add `skippedUnverified` to `CycleSummary` (after `consecutiveZeroCycles`):

```ts
  /** Candidates rejected by the verified filter this cycle. */
  skippedUnverified: number;
```

Add `verified` to `FollowedCandidate`:

```ts
export interface FollowedCandidate {
  userName: string;
  name?: string;
  url: string;
  keyword?: string;
  verified?: string[];
}
```

Change `fillQueue`'s return type to include `skippedUnverified`. Its signature
becomes:

```ts
  private async fillQueue(): Promise<{ scanned: number; queued: number; skippedUnverified: number }> {
```

Add `let skippedUnverified = 0;` next to the existing `let scanned = 0;` /
`let queued = 0;`. In the `for await` loop, replace the enqueue block:

```ts
            const userName = tweet.author?.userName;
            if (!userName) continue;
            const before = this.store.queueSize();
            this.store.enqueue(userName, { name: tweet.author?.name, keyword });
            if (this.store.queueSize() > before) queued++;
```

with:

```ts
            const userName = tweet.author?.userName;
            if (!userName) continue;
            if (!passesVerifiedFilter(tweet.author ?? {}, this.options.allowedVerified)) {
              skippedUnverified++;
              continue;
            }
            const before = this.store.queueSize();
            this.store.enqueue(userName, {
              name: tweet.author?.name,
              keyword,
              verified: authorTiers(tweet.author ?? {}),
            });
            if (this.store.queueSize() > before) queued++;
```

Change `fillQueue`'s final `return { scanned, queued };` to
`return { scanned, queued, skippedUnverified };`.

In `runCycle`, the summary object reads `fill.scanned` and `fill.queued`; add
`skippedUnverified: fill.skippedUnverified,` alongside them.

In `drainQueue`'s `toCandidate` mapper, carry `verified` through:

```ts
    const toCandidate = (c: {
      userName: string;
      name?: string;
      keyword?: string;
      verified?: string[];
    }): FollowedCandidate => ({
      userName: c.userName,
      name: c.name,
      url: `https://x.com/${c.userName}`,
      keyword: c.keyword,
      verified: c.verified,
    });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all new and existing tests pass.

- [ ] **Step 6: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (If `src/examples/auto-follow.ts` fails to compile because
`AutoFollowRunnerOptions` now requires `allowedVerified`, that is fixed in
Task 3 — but Task 3 also passes the field. To keep this task self-contained,
add `allowedVerified: config.allowedVerified,` to the runner-options object in
`src/examples/auto-follow.ts` now; `config.allowedVerified` is added in Task 3,
so temporarily use `allowedVerified: [],` here and Task 3 switches it to
`config.allowedVerified`.)

Concretely: in `src/examples/auto-follow.ts`, in the `new AutoFollowRunner(...)`
options object, add `allowedVerified: [],` for now.

- [ ] **Step 7: Commit**

```bash
git add src/services/FollowStore.ts src/services/AutoFollowRunner.ts src/examples/auto-follow.ts src/services/__tests__/FollowStore.test.ts src/services/__tests__/AutoFollowRunner.test.ts
git commit -m "feat: filter search authors by verified tier before queuing

fillQueue now skips authors that hold no allowed verification tier
(counting them as skippedUnverified in the cycle summary) and records the
matched tiers on the queued candidate and the followed-candidate log.
FollowStore's Candidate and enqueue carry an optional verified[]. The
example loop passes an empty allowedVerified for now (filter off); config
wiring lands next."
```

---

### Task 3: Config wiring + docs

**Files:**
- Modify: `src/config.ts`
- Modify: `config/auto-follow.json`
- Modify: `src/examples/auto-follow.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `VerifiedTier` (Task 1), `AutoFollowRunnerOptions.allowedVerified` (Task 2).
- Produces: `AutoFollowConfig.allowedVerified: VerifiedTier[]`.

- [ ] **Step 1: Add the config field with validation**

In `src/config.ts`:

Add an import of the tier type at the top (with the other imports):

```ts
import type { VerifiedTier } from "./services/AutoFollowRunner";
```

Add to the `AutoFollowConfig` interface (after `unhealthyAfterZeroCycles: number;`):

```ts
  allowedVerified: VerifiedTier[];
```

Add to the `AutoFollowFile` interface (after `unhealthyAfterZeroCycles?: number;`):

```ts
  allowedVerified?: string[];
```

Add a validation helper above `loadAutoFollowConfig`:

```ts
const VERIFIED_TIERS = ["blue", "legacy", "business", "government"] as const;

function resolveAllowedVerified(fromFile: string[] | undefined): VerifiedTier[] {
  const raw = fromFile ?? ["blue", "legacy", "business", "government"];
  const valid: VerifiedTier[] = [];
  for (const t of raw) {
    if ((VERIFIED_TIERS as readonly string[]).includes(t)) {
      valid.push(t as VerifiedTier);
    } else {
      console.warn(`Ignoring unknown allowedVerified tier: "${t}"`);
    }
  }
  return valid;
}
```

In the returned config object (after the `unhealthyAfterZeroCycles:` line):

```ts
    allowedVerified: resolveAllowedVerified(file.allowedVerified),
```

- [ ] **Step 2: Add the config value**

In `config/auto-follow.json`, add after the `"unhealthyAfterZeroCycles"` line
(keep valid JSON — preceding line gets a trailing comma):

```json
  "allowedVerified": ["blue", "legacy", "business", "government"],
```

Do NOT change any other value.

- [ ] **Step 3: Use the config value in the loop**

In `src/examples/auto-follow.ts`, change the runner-options field added in
Task 2 from `allowedVerified: [],` to:

```ts
    allowedVerified: config.allowedVerified,
```

- [ ] **Step 4: Update the README**

In `README.md`, in the Auto-Follow config table, add a row after the
`maxPerRun` row:

```markdown
| `allowedVerified` | Verification tiers to follow: any of `blue` (X Premium), `legacy`, `business`, `government`. Default all four (follow any verified account, skip unverified). Empty array `[]` turns the filter off (follow everyone). |
```

And add a short paragraph after the config table:

````markdown
The tool reads each search author's verification signals and follows only
accounts whose tier is in `allowedVerified`. Set it to `["blue"]` to follow only
X Premium accounts, or `[]` to disable the filter. Each cycle's JSONL record
includes a `skippedUnverified` count and the matched tiers on every followed
account.
````

- [ ] **Step 5: Type-check and run the suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Smoke-check config loads**

Run: `node --require ts-node/register/transpile-only -e 'const {loadAutoFollowConfig}=require("./src/config"); console.log("allowedVerified:", loadAutoFollowConfig().allowedVerified)'`
Expected: prints `allowedVerified: [ 'blue', 'legacy', 'business', 'government' ]`.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts config/auto-follow.json src/examples/auto-follow.ts README.md
git commit -m "feat: configure verified-follow tiers via allowedVerified

config.allowedVerified (default all four tiers) selects which verification
tiers the loop follows; unknown tier names are dropped with a warning and
an empty list disables the filter. The example loop now passes it into the
runner. README documents the tiers and the skippedUnverified log field."
```

---

## Self-Review

**1. Spec coverage:**
- Tier mapping blue/legacy/business/government from isBlueVerified/isVerified/verifiedType → Task 1 `authorTiers` ✅
- Filter rule (empty=off, else any-held-tier-in-allowed) → Task 1 `passesVerifiedFilter` ✅
- Skip unverified before queuing, keep scanning → Task 2 fillQueue `continue` ✅
- `skippedUnverified` per cycle → Task 2 CycleSummary + fillQueue ✅
- Candidate carries verified tiers, backward-compatible → Task 2 FollowStore ✅
- FollowedCandidate/JSONL shows tiers → Task 2 toCandidate ✅
- config `allowedVerified` default four tiers, validation with warn → Task 3 ✅
- Empty list disables filter (documented) → Task 3 README + Task 1 rule ✅
- README docs → Task 3 ✅

**2. Placeholder scan:** No TBD/TODO; all code shown. The Task 2 Step 6 note about the temporary `allowedVerified: []` in auto-follow.ts (switched to `config.allowedVerified` in Task 3) is an explicit sequencing instruction with the exact value, not a placeholder. ✅

**3. Type consistency:** `VerifiedTier` defined Task 1, imported in config Task 3, used in options Task 2. `authorTiers`/`passesVerifiedFilter` signatures match Task 1 definition and Task 2 call sites. `Candidate.verified?: string[]` (Task 2 FollowStore) matches `enqueue` meta `verified?: string[]` and `authorTiers` return (`VerifiedTier[]` is assignable to `string[]`). `CycleSummary.skippedUnverified` defined Task 2, consumed nowhere else required. `AutoFollowRunnerOptions.allowedVerified: VerifiedTier[]` (Task 2) fed by `config.allowedVerified: VerifiedTier[]` (Task 3). ✅
