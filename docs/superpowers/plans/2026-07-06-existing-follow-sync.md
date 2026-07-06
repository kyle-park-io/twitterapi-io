# Existing-Follow Sync + Follow-Result Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop re-processing already-followed accounts by syncing the real X following list into the followed-set at startup, and make follow() report whether it actually followed or found the account already-following so cycles count/log/health them correctly.

**Architecture:** `IFollower.follow` returns `"followed" | "already-following"`; `BrowserFollowService` returns it from its existing branch. `AutoFollowRunner.drainQueue` splits the counts, `CycleSummary` gains `alreadyFollowing`, and the health rule treats an all-already-following cycle as healthy. The example loop pulls `getFollowings` into the followed-set once at startup (best-effort; failure falls back to prior behavior), and `FollowStore.enqueue`'s existing dedupe keeps already-followed accounts out of the queue.

**Tech Stack:** TypeScript (CommonJS, TS 6), ts-node, `node --test` via `ts-node/register/transpile-only`.

## Global Constraints

- Test runner: `pnpm test` (= `node --require ts-node/register/transpile-only --test "src/**/*.test.ts"`). Type-check: `pnpm exec tsc --noEmit`.
- Tests use `import { test } from "node:test"` and `import assert from "node:assert/strict"`; unit tests in `src/services/__tests__/*.test.ts`, relative `../` imports.
- `examples/` scripts have no tests; must compile and not break the suite.
- Commit convention: Conventional Commits, NO `Co-Authored-By` trailer, every commit has a body.
- `FollowResult` = `"followed" | "already-following"`. `follow()` returns `"followed"` only when it actually clicked Follow and confirmed the flip; `"already-following"` when the followed-state button was already showing; it still THROWS on a genuine failure (neither button rendered / click unconfirmed).
- `addedCount` = number of genuinely new follows this cycle (`followed.length`), NOT including already-following. Dry-run: `addedCount` 0.
- Health rule (real run, EXACT): `followed.length > 0` OR `alreadyFollowing > 0` → reset consecutiveZeroCycles to 0 AND set lastSuccessAt (session works). Else if `attempted > 0` → increment consecutiveZeroCycles (all attempts threw). Else (`attempted === 0`) → leave both untouched. Dry-run never touches either.
- Startup sync is best-effort: wrap in try/catch in auto-follow.ts; on any error log a warning and continue the loop. Only runs when `!config.dryRun`.
- The only `IFollower` implementations are `BrowserFollowService` and the test stubs `recordingFollower`/`failingFollower`.

## Type reference (defined across tasks)

```ts
// IFollower.ts (Task 1)
export type FollowResult = "followed" | "already-following";
export interface IFollower { follow(username: string): Promise<FollowResult>; }

// AutoFollowRunner.ts (Task 2)
// drainQueue returns { followed: FollowedCandidate[]; attempted: number; alreadyFollowing: number }
// CycleSummary gains alreadyFollowing: number
```

---

### Task 1: FollowResult type + BrowserFollowService returns it

**Files:**
- Modify: `src/follow/IFollower.ts`
- Modify: `src/services/BrowserFollowService.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `FollowResult` type; `follow(username): Promise<FollowResult>`.

- [ ] **Step 1: Update the IFollower interface**

Replace `src/follow/IFollower.ts` contents with:

```ts
/** Outcome of a follow attempt that did not throw. */
export type FollowResult = "followed" | "already-following";

/**
 * Follows a single X account by username. Implementations decide the mechanism
 * (browser automation, API, etc.). Idempotent: following an already-followed
 * account must not throw — it returns "already-following". A genuine failure
 * (e.g. the profile never rendered) throws.
 */
export interface IFollower {
  follow(username: string): Promise<FollowResult>;
}
```

- [ ] **Step 2: Return the result from BrowserFollowService.follow**

In `src/services/BrowserFollowService.ts`:

Add `FollowResult` to the import:

```ts
import { IFollower, FollowResult } from "../follow/IFollower";
```

Change the `follow` signature and its two branches. The method currently ends
the `try` block after the `if (followButton visible) { click; waitFor }` and a
trailing comment. Update the signature to `Promise<FollowResult>` and make the
branches return:

```ts
  async follow(username: string): Promise<FollowResult> {
```

Inside, replace the click/skip block (the `if (await followButton.isVisible()...)`
block and the trailing "Otherwise..." comment) with:

```ts
      if (await followButton.isVisible().catch(() => false)) {
        await followButton.click();
        // Confirm the click registered: the button must flip to the followed state
        // ("Following @" or "Unfollow @").
        await followedButton.waitFor({ state: "visible", timeout: 10000 });
        return "followed";
      }
      // The followed-state button is already showing — we already follow them.
      return "already-following";
```

The `finally { await page.close(); }` stays. Because `follow` now returns inside
the `try`, ensure the return value propagates (a `return` inside `try` still runs
`finally` and returns the value — correct).

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: FAILS — `AutoFollowRunner` and the test stubs still expect `Promise<void>`
and don't use the result. That is expected; Task 2 fixes the runner and Task 3's
brief covers nothing here. To keep THIS task self-contained and compiling on its
own is not possible without the consumers; so this task's gate is narrower:

Run: `pnpm exec tsc --noEmit 2>&1 | grep "BrowserFollowService.ts"`
Expected: NO lines (BrowserFollowService.ts itself is type-clean; errors only in
AutoFollowRunner.ts / test files, which Task 2 resolves).

- [ ] **Step 4: Commit**

```bash
git add src/follow/IFollower.ts src/services/BrowserFollowService.ts
git commit -m "feat: follow() returns followed vs already-following

IFollower.follow now returns a FollowResult ('followed' | 'already-
following') instead of void, so callers can tell a real new follow from a
no-op skip on an account we already follow. BrowserFollowService returns
it from its existing branch: 'followed' after a confirmed click, 'already-
following' when the followed-state button was already showing. Genuine
failures still throw. Consumers are updated next."
```

---

### Task 2: AutoFollowRunner — split counts + health rule

**Files:**
- Modify: `src/services/AutoFollowRunner.ts`
- Test: `src/services/__tests__/AutoFollowRunner.test.ts`

**Interfaces:**
- Consumes: `FollowResult` (Task 1).
- Produces: `drainQueue` returns `{ followed, attempted, alreadyFollowing }`; `CycleSummary.alreadyFollowing: number`; adjusted health rule.

- [ ] **Step 1: Update test follower stubs and add new tests**

In `src/services/__tests__/AutoFollowRunner.test.ts`:

The `recordingFollower` stub must return `"followed"`. Replace it with:

```ts
function recordingFollower(): { followed: string[] } & IFollower {
  const followed: string[] = [];
  return {
    followed,
    async follow(username: string) {
      followed.push(username);
      return "followed" as const;
    },
  };
}
```

The `failingFollower` stub throws (unchanged behavior), but its return type must
satisfy `IFollower`. Replace it with:

```ts
function failingFollower(): IFollower {
  return {
    async follow(_username: string): Promise<never> {
      throw new Error("blocked");
    },
  };
}
```

Add an already-following stub after `failingFollower`:

```ts
function alreadyFollowingFollower(): IFollower {
  return {
    async follow(_username: string) {
      return "already-following" as const;
    },
  };
}
```

Then append these tests:

```ts
test("already-following candidates count separately and stay healthy", async () => {
  const store = tmpStore();
  store.setConsecutiveZeroCycles(3);
  store.enqueue("alice");
  store.enqueue("bob");
  const search = fakeSearch({});
  let t = 1000;
  const runner = new AutoFollowRunner(search, store, alreadyFollowingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    now: () => new Date(t++),
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
  });

  const summary = await runner.runCycle();

  assert.equal(summary.addedCount, 0);          // no NEW follows
  assert.equal(summary.alreadyFollowing, 2);    // both were already followed
  assert.equal(summary.attempted, 2);
  assert.equal(summary.consecutiveZeroCycles, 0); // healthy: session works
  assert.equal(store.getConsecutiveZeroCycles(), 0);
  assert.ok(store.getLastSuccessAt() !== null);
});

test("all-throw cycle increments the unhealthy counter", async () => {
  const store = tmpStore();
  store.enqueue("alice");
  const search = fakeSearch({});
  const runner = new AutoFollowRunner(search, store, failingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
    allowedVerified: [],
  });

  const summary = await runner.runCycle();

  assert.equal(summary.addedCount, 0);
  assert.equal(summary.alreadyFollowing, 0);
  assert.equal(summary.attempted, 1);
  assert.equal(summary.consecutiveZeroCycles, 1); // all attempts threw
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `summary.alreadyFollowing` undefined; and the already-following
stub's cycle currently increments the counter (old health rule) so the healthy
assertion fails.

- [ ] **Step 3: Update drainQueue**

In `src/services/AutoFollowRunner.ts`, change `drainQueue`'s signature and the
real-run loop. Signature:

```ts
  private async drainQueue(): Promise<{
    followed: FollowedCandidate[];
    attempted: number;
    alreadyFollowing: number;
  }> {
```

The dry-run early return becomes:

```ts
    if (this.options.dryRun) {
      const targets = this.store.peek(this.options.maxPerRun);
      for (const c of targets) console.log(`[dry-run] would follow @${c.userName}`);
      return { followed: targets.map(toCandidate), attempted: 0, alreadyFollowing: 0 };
    }
```

The real loop becomes:

```ts
    const targets = this.store.dequeue(this.options.maxPerRun);
    const followed: FollowedCandidate[] = [];
    let alreadyFollowing = 0;
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      try {
        if (i > 0) await sleep(this.delayMs());
        const result = await this.follower.follow(c.userName);
        this.store.add(c.userName);
        if (result === "followed") {
          followed.push(toCandidate(c));
          console.log(`Followed @${c.userName}`);
        } else {
          alreadyFollowing++;
          console.log(`Already following @${c.userName}`);
        }
      } catch (err) {
        console.error(
          `Follow failed for @${c.userName}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    return { followed, attempted: targets.length, alreadyFollowing };
```

- [ ] **Step 4: Update runCycle (destructure, health rule, summary)**

Change the destructure of `drainQueue`'s result. Find:

```ts
    const { followed, attempted } = await this.drainQueue();
```

Replace with:

```ts
    const { followed, attempted, alreadyFollowing } = await this.drainQueue();
```

Replace the health-assessment block:

```ts
    if (!this.options.dryRun) {
      if (followed.length > 0) {
        this.store.setConsecutiveZeroCycles(0);
        this.store.setLastSuccessAt(finished);
      } else if (attempted > 0) {
        this.store.setConsecutiveZeroCycles(this.store.getConsecutiveZeroCycles() + 1);
      }
      // attempted === 0 → leave counters untouched.
    }
```

with:

```ts
    if (!this.options.dryRun) {
      if (followed.length > 0 || alreadyFollowing > 0) {
        // A real follow landed, or we confirmed existing follows — session works.
        this.store.setConsecutiveZeroCycles(0);
        this.store.setLastSuccessAt(finished);
      } else if (attempted > 0) {
        // Attempted follows and every one threw.
        this.store.setConsecutiveZeroCycles(this.store.getConsecutiveZeroCycles() + 1);
      }
      // attempted === 0 → nothing to do → leave counters untouched.
    }
```

Add `alreadyFollowing` to the returned summary object, right after the
`attempted:` line:

```ts
      attempted,
      alreadyFollowing: this.options.dryRun ? 0 : alreadyFollowing,
```

Add the field to the `CycleSummary` interface, after `attempted: number;`:

```ts
  /** Candidates already followed (no-op skip); 0 in dry-run. */
  alreadyFollowing: number;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — new tests pass; all existing tests pass (the stub return-type
change is compatible; existing all-`followed` tests still see `addedCount === n`).

- [ ] **Step 6: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (BrowserFollowService from Task 1 now type-checks against
the updated `IFollower` too.)

- [ ] **Step 7: Commit**

```bash
git add src/services/AutoFollowRunner.ts src/services/__tests__/AutoFollowRunner.test.ts
git commit -m "feat: count already-following separately and keep it healthy

drainQueue now branches on follow()'s result: a 'followed' goes in the
followed list (addedCount), an 'already-following' increments a new
alreadyFollowing count and logs 'Already following @x'. CycleSummary gains
alreadyFollowing. The health rule now treats a cycle that only re-confirmed
existing follows as healthy (the session clearly works) — the unhealthy
counter increments only when follows were attempted and every one threw."
```

---

### Task 3: Startup following sync in the loop

**Files:**
- Modify: `src/examples/auto-follow.ts`

**Interfaces:**
- Consumes: `CycleSummary.alreadyFollowing` (Task 2); `UserService.getFollowings(userName): AsyncGenerator<{userName}>` (existing); `FollowStore.add`/`save` (existing).
- Produces: nothing (example script).

- [ ] **Step 1: Add UserService and the sync helper**

In `src/examples/auto-follow.ts`:

Add the import (with the other service imports):

```ts
import { UserService } from "../services/UserService";
```

Add the sync helper above `main()` (near the `kst`/`appendLog` helpers):

```ts
async function syncFollowing(
  users: UserService,
  store: FollowStore,
  xUser: string
): Promise<number> {
  let n = 0;
  for await (const f of users.getFollowings(xUser)) {
    store.add(f.userName);
    n++;
  }
  store.save();
  return n;
}
```

In `main()`, construct `UserService` next to where `tweets` is built. Find:

```ts
  const client = new TwitterClient(config.apiKey);
  const tweets = new TweetService(client);
```

Add after it:

```ts
  const users = new UserService(client);
```

- [ ] **Step 2: Run the sync at startup (best-effort)**

In `main()`, the login block is:

```ts
  if (!config.dryRun) {
    console.log("Logging in to X via browser...");
    await follower.login();
    console.log("Logged in.");
  }
```

Replace it with:

```ts
  if (!config.dryRun) {
    console.log("Logging in to X via browser...");
    await follower.login();
    console.log("Logged in.");

    // Best-effort: merge the account's real following list into the followed-set
    // so already-followed accounts stop being queued. If it fails, warn and keep
    // going — a redundant follow attempt later is a harmless no-op.
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

- [ ] **Step 3: Add already-following to the cycle-done log**

Find the cycle-done log:

```ts
      console.log(
        `Cycle done — scanned ${summary.scanned}, ` +
          `queued ${summary.queued}, followed ${summary.followed.length}`
      );
```

Replace with:

```ts
      console.log(
        `Cycle done — scanned ${summary.scanned}, ` +
          `queued ${summary.queued}, followed ${summary.followed.length}, ` +
          `already-following ${summary.alreadyFollowing}`
      );
```

- [ ] **Step 4: Type-check and run the suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; all tests pass (auto-follow.ts is a script with no
tests but must compile).

- [ ] **Step 5: Smoke-check the script compiles and starts (dry-run, no sync)**

Because sync only runs when `!dryRun` and requires a real login, verify instead
that the script type-checks and that `syncFollowing` is wired without running a
real login. Confirm by grep that the pieces are present:

Run: `grep -n "syncFollowing\|new UserService\|already-following" src/examples/auto-follow.ts`
Expected: shows the helper definition, its call in the login block, the
`UserService` construction, and the cycle-done log line.

- [ ] **Step 6: Commit**

```bash
git add src/examples/auto-follow.ts
git commit -m "feat: sync existing follows at startup

After login (real runs only), pull the account's following list via the
read API and merge it into the followed-set, so FollowStore.enqueue's
dedupe keeps already-followed accounts out of the queue — no more visiting
and delaying on people we already follow. The sync is best-effort: on any
error it warns and the loop proceeds. The cycle-done log now also reports
the already-following count."
```

---

## Self-Review

**1. Spec coverage:**
- `FollowResult` type + `follow` returns it → Task 1 ✅
- BrowserFollowService returns followed/already-following from its branch → Task 1 ✅
- drainQueue splits counts, logs "Already following" → Task 2 ✅
- `CycleSummary.alreadyFollowing`; `addedCount` = new follows only → Task 2 ✅
- Health rule: followed>0 OR alreadyFollowing>0 → healthy; all-throw → increment → Task 2 (impl + 2 tests) ✅
- Startup sync via getFollowings → followed-set; enqueue dedupe excludes them → Task 3 ✅
- Best-effort sync (try/catch, continue on failure), real runs only → Task 3 ✅
- UserService added to loop; cycle-done log gains already-following → Task 3 ✅
- Test stubs return FollowResult → Task 2 ✅

**2. Placeholder scan:** No TBD/TODO; all code shown. Task 1 Step 3's narrowed
type-check gate (grep BrowserFollowService.ts is clean, consumers fixed in Task
2) is an explicit cross-task sequencing note, not a placeholder. ✅

**3. Type consistency:** `FollowResult = "followed" | "already-following"` (Task
1) is returned by the stubs and matched in drainQueue's `if (result ===
"followed")` (Task 2). `drainQueue` returns `{followed, attempted,
alreadyFollowing}` (Task 2) and runCycle destructures exactly those. `CycleSummary.alreadyFollowing:
number` (Task 2) is read in auto-follow.ts's log (Task 3). `syncFollowing(users,
store, xUser)` uses `UserService.getFollowings` (existing, yields `{userName}`)
and `store.add`/`store.save` (existing). ✅
