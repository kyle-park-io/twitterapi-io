# Auto-Follow Health Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect silent auto-follow failure (banned account / expired session / X blocking) by having the runner self-assess each cycle, persist a small health state, warn loudly when unhealthy, and expose a `follow-status` command for an at-a-glance verdict.

**Architecture:** `FollowStore` gains two persisted health fields (backward-compatible). `AutoFollowRunner.drainQueue()` returns how many follows it attempted; `runCycle()` uses that to increment a consecutive-zero-follow counter (reset on any success) and enriches `CycleSummary`. A pure `isUnhealthy()` helper is shared by the loop (loud warning) and a new `follow-status` command (reads only local files, no API/env).

**Tech Stack:** TypeScript (CommonJS, TS 6), ts-node, `node --test` via `ts-node/register/transpile-only`.

## Global Constraints

- Test runner: `pnpm test` (= `node --require ts-node/register/transpile-only --test "src/**/*.test.ts"`). Type-check: `pnpm exec tsc --noEmit`.
- Tests use `import { test } from "node:test"` and `import assert from "node:assert/strict"`; unit tests in `src/services/__tests__/*.test.ts`, relative `../` imports.
- `examples/` scripts have no tests (I/O shells); must compile and not break the suite.
- Commit convention: Conventional Commits, NO `Co-Authored-By` trailer, every commit has a body (what/why).
- Backward compat mandatory: `.auth/auto-follow-state.json` files without the new fields must load — missing `lastSuccessAt` → `null`, missing `consecutiveZeroCycles` → `0`.
- Health rule (exact): a REAL cycle (not dry-run) that had `attempted > 0` and `followed.length === 0` increments `consecutiveZeroCycles`; a cycle with `followed.length > 0` resets it to 0 AND sets `lastSuccessAt`; a cycle with `attempted === 0` leaves BOTH untouched (nothing to do ≠ failure). Dry-run NEVER touches either counter.
- `isUnhealthy(consecutiveZeroCycles, threshold)` returns `consecutiveZeroCycles >= threshold`. Default threshold `unhealthyAfterZeroCycles = 2`.
- `follow-status` reads ONLY local files (no network, no env vars). State path is `path.join(process.cwd(), ".auth", "auto-follow-state.json")`; threshold read from `config/auto-follow.json` directly (default 2 if absent); recent cycles from `output/auto-follow-log.jsonl` (best-effort, tolerate missing).

## Type reference (defined across tasks, used throughout)

```ts
// FollowStore.ts (Task 1) — additions
getLastSuccessAt(): Date | null
setLastSuccessAt(date: Date): void
getConsecutiveZeroCycles(): number
setConsecutiveZeroCycles(n: number): void

// AutoFollowRunner.ts (Task 2)
// drainQueue now returns { followed: FollowedCandidate[]; attempted: number }
export function isUnhealthy(consecutiveZeroCycles: number, threshold: number): boolean;
// CycleSummary gains: attempted, followFailures, consecutiveZeroCycles (all number)
```

---

### Task 1: FollowStore health fields (backward-compatible)

**Files:**
- Modify: `src/services/FollowStore.ts`
- Test: `src/services/__tests__/FollowStore.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getLastSuccessAt()`, `setLastSuccessAt(date)`, `getConsecutiveZeroCycles()`, `setConsecutiveZeroCycles(n)`; persisted fields `lastSuccessAt`, `consecutiveZeroCycles`.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/__tests__/FollowStore.test.ts`:

```ts
test("health fields default when absent from an old file", () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({ followed: [], queue: [], lastRun: null })
  );
  const store = new FollowStore(file);
  store.load();
  assert.equal(store.getLastSuccessAt(), null);
  assert.equal(store.getConsecutiveZeroCycles(), 0);
});

test("health fields round-trip through save/load", () => {
  const file = tmpFile();
  const store = new FollowStore(file);
  store.load();
  const when = new Date("2026-07-06T12:00:00.000Z");
  store.setLastSuccessAt(when);
  store.setConsecutiveZeroCycles(3);
  store.save();

  const reloaded = new FollowStore(file);
  reloaded.load();
  assert.equal(reloaded.getConsecutiveZeroCycles(), 3);
  assert.equal(reloaded.getLastSuccessAt()?.toISOString(), when.toISOString());
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `getLastSuccessAt`/`getConsecutiveZeroCycles` not defined.

- [ ] **Step 3: Implement the changes**

In `src/services/FollowStore.ts`:

Extend the `FollowStoreData` interface:

```ts
interface FollowStoreData {
  followed: string[];
  queue: Array<string | Candidate>;
  lastRun: string | null;
  lastSuccessAt?: string | null;
  consecutiveZeroCycles?: number;
}
```

Add private fields next to `lastRun`:

```ts
  private lastSuccessAt: Date | null = null;
  private consecutiveZeroCycles = 0;
```

In `load()`, inside the `try` block after `this.lastRun = ...`, add:

```ts
      this.lastSuccessAt = data.lastSuccessAt ? new Date(data.lastSuccessAt) : null;
      this.consecutiveZeroCycles = data.consecutiveZeroCycles ?? 0;
```

In the `catch` block, after `this.lastRun = null;`, add:

```ts
      this.lastSuccessAt = null;
      this.consecutiveZeroCycles = 0;
```

Add accessor methods (near `getLastRun`/`setLastRun`):

```ts
  getLastSuccessAt(): Date | null {
    return this.lastSuccessAt;
  }

  setLastSuccessAt(date: Date): void {
    this.lastSuccessAt = date;
  }

  getConsecutiveZeroCycles(): number {
    return this.consecutiveZeroCycles;
  }

  setConsecutiveZeroCycles(n: number): void {
    this.consecutiveZeroCycles = n;
  }
```

In `save()`, add the two fields to the written `data` object:

```ts
    const data: FollowStoreData = {
      followed: [...this.followed],
      queue: [...this.queue],
      lastRun: this.lastRun ? this.lastRun.toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? this.lastSuccessAt.toISOString() : null,
      consecutiveZeroCycles: this.consecutiveZeroCycles,
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — the 2 new tests pass, all existing tests still pass. Note: `AutoFollowRunner` tests still pass here because Task 1 doesn't change `drainQueue` yet.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/FollowStore.ts src/services/__tests__/FollowStore.test.ts
git commit -m "feat: persist auto-follow health fields in FollowStore

Add lastSuccessAt and consecutiveZeroCycles to the state file (with
accessors), so the runner can track whether cycles are actually landing
follows. Both default (null / 0) when absent, so existing state files
keep loading unchanged."
```

---

### Task 2: AutoFollowRunner self-assessment + isUnhealthy

**Files:**
- Modify: `src/services/AutoFollowRunner.ts`
- Test: `src/services/__tests__/AutoFollowRunner.test.ts`

**Interfaces:**
- Consumes: Task 1's `FollowStore` health accessors.
- Produces: `isUnhealthy(consecutiveZeroCycles, threshold): boolean`; `CycleSummary` gains `attempted`, `followFailures`, `consecutiveZeroCycles`.

- [ ] **Step 1: Add the failing tests**

The existing tests build a `recordingFollower()` whose `follow` always succeeds. Add a failing-follower helper and new tests. Append to `src/services/__tests__/AutoFollowRunner.test.ts`:

```ts
import { isUnhealthy } from "../AutoFollowRunner";

function failingFollower(): IFollower {
  return {
    async follow(_username: string) {
      throw new Error("blocked");
    },
  };
}

test("attempted-but-followed-0 increments consecutiveZeroCycles", async () => {
  const store = tmpStore();
  store.enqueue("alice");
  store.enqueue("bob");
  const search = fakeSearch({}); // no new candidates; drain the pre-queued ones
  const runner = new AutoFollowRunner(search, store, failingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]), // empty batch → no search, just drain
  });

  const summary = await runner.runCycle();

  assert.equal(summary.attempted, 2);
  assert.equal(summary.addedCount, 0);
  assert.equal(summary.followFailures, 2);
  assert.equal(summary.consecutiveZeroCycles, 1);
  assert.equal(store.getConsecutiveZeroCycles(), 1);
});

test("a successful cycle resets the counter and sets lastSuccessAt", async () => {
  const store = tmpStore();
  store.setConsecutiveZeroCycles(5);
  store.enqueue("alice");
  const search = fakeSearch({});
  let t = 1000;
  const runner = new AutoFollowRunner(search, store, recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    now: () => new Date(t++),
    pickKeywords: scriptedPicker([[]]),
  });

  const summary = await runner.runCycle();

  assert.equal(summary.addedCount, 1);
  assert.equal(summary.consecutiveZeroCycles, 0);
  assert.equal(store.getConsecutiveZeroCycles(), 0);
  assert.ok(store.getLastSuccessAt() !== null);
});

test("a cycle with nothing to attempt leaves the counter untouched", async () => {
  const store = tmpStore();
  store.setConsecutiveZeroCycles(3);
  const search = fakeSearch({}); // empty queue + empty search = nothing to drain
  const runner = new AutoFollowRunner(search, store, failingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
  });

  const summary = await runner.runCycle();

  assert.equal(summary.attempted, 0);
  assert.equal(summary.consecutiveZeroCycles, 3); // unchanged
  assert.equal(store.getConsecutiveZeroCycles(), 3);
});

test("dry-run never touches the health counter", async () => {
  const store = tmpStore();
  store.setConsecutiveZeroCycles(4);
  store.enqueue("alice");
  const search = fakeSearch({});
  const runner = new AutoFollowRunner(search, store, failingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([[]]),
  });

  const summary = await runner.runCycle();

  assert.equal(summary.attempted, 0); // dry-run attempts nothing
  assert.equal(summary.consecutiveZeroCycles, 4); // unchanged
  assert.equal(store.getConsecutiveZeroCycles(), 4);
});

test("isUnhealthy compares against threshold", () => {
  assert.equal(isUnhealthy(2, 2), true);
  assert.equal(isUnhealthy(3, 2), true);
  assert.equal(isUnhealthy(1, 2), false);
  assert.equal(isUnhealthy(0, 2), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `isUnhealthy` not exported; `summary.attempted`/`followFailures`/`consecutiveZeroCycles` undefined.

- [ ] **Step 3: Implement the changes**

In `src/services/AutoFollowRunner.ts`:

Add the exported helper near the top (after imports, before the class or with the other module functions):

```ts
export function isUnhealthy(consecutiveZeroCycles: number, threshold: number): boolean {
  return consecutiveZeroCycles >= threshold;
}
```

Extend `CycleSummary` with three fields (add after `addedCount`):

```ts
  /** Candidates this cycle tried to follow (0 in dry-run). */
  attempted: number;
  /** attempted - addedCount for a real run; 0 in dry-run. */
  followFailures: number;
  /** consecutiveZeroCycles value AFTER this cycle. */
  consecutiveZeroCycles: number;
```

Change `drainQueue()` to return the attempted count. Update its signature and both return sites:

```ts
  private async drainQueue(): Promise<{ followed: FollowedCandidate[]; attempted: number }> {
    const toCandidate = (c: {
      userName: string;
      name?: string;
      keyword?: string;
    }): FollowedCandidate => ({
      userName: c.userName,
      name: c.name,
      url: `https://x.com/${c.userName}`,
      keyword: c.keyword,
    });

    if (this.options.dryRun) {
      const targets = this.store.peek(this.options.maxPerRun);
      for (const c of targets) console.log(`[dry-run] would follow @${c.userName}`);
      return { followed: targets.map(toCandidate), attempted: 0 };
    }

    const targets = this.store.dequeue(this.options.maxPerRun);
    const followed: FollowedCandidate[] = [];
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      try {
        if (i > 0) await sleep(this.delayMs());
        await this.follower.follow(c.userName);
        this.store.add(c.userName);
        followed.push(toCandidate(c));
        console.log(`Followed @${c.userName}`);
      } catch (err) {
        console.error(
          `Follow failed for @${c.userName}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    return { followed, attempted: targets.length };
  }
```

Rewrite `runCycle()` to consume the new shape and update health state:

```ts
  async runCycle(): Promise<CycleSummary> {
    const started = this.now();
    const followedCountBefore = this.store.followedCount();
    const fill = await this.fillQueue();
    const { followed, attempted } = await this.drainQueue();
    const followedCountAfter = this.store.followedCount();
    const finished = this.now();

    // Health assessment (real runs only). "Attempted but followed 0" is a
    // symptom; a cycle with nothing to attempt is not a failure.
    if (!this.options.dryRun) {
      if (followed.length > 0) {
        this.store.setConsecutiveZeroCycles(0);
        this.store.setLastSuccessAt(finished);
      } else if (attempted > 0) {
        this.store.setConsecutiveZeroCycles(this.store.getConsecutiveZeroCycles() + 1);
      }
      // attempted === 0 → leave counters untouched.
    }

    this.store.setLastRun(finished);
    this.store.save();

    return {
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      scanned: fill.scanned,
      queued: fill.queued,
      followedCountBefore,
      followedCountAfter,
      addedCount: this.options.dryRun ? 0 : followed.length,
      attempted,
      followFailures: this.options.dryRun ? 0 : attempted - followed.length,
      consecutiveZeroCycles: this.store.getConsecutiveZeroCycles(),
      followed,
      dryRun: this.options.dryRun,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all AutoFollowRunner tests (existing + 5 new) and all other tests pass.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/AutoFollowRunner.ts src/services/__tests__/AutoFollowRunner.test.ts
git commit -m "feat: track cycle health in the runner

drainQueue now reports how many follows it attempted, so runCycle can
tell 'tried and all failed' from 'nothing to do'. A real cycle that
attempts follows but lands none increments consecutiveZeroCycles; any
success resets it and stamps lastSuccessAt; a no-op cycle leaves both
alone; dry-run never touches them. CycleSummary gains attempted,
followFailures, and consecutiveZeroCycles, and an isUnhealthy() helper
is exported for the loop and status command to share the threshold rule."
```

---

### Task 3: Config threshold + loud warning + follow-status + docs

**Files:**
- Modify: `src/config.ts`
- Modify: `config/auto-follow.json`
- Modify: `src/examples/auto-follow.ts`
- Create: `src/examples/follow-status.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `isUnhealthy` and enriched `CycleSummary` (Task 2); `FollowStore` health accessors (Task 1).
- Produces: `pnpm follow-status`; `config.unhealthyAfterZeroCycles`.

- [ ] **Step 1: Add the config field**

In `src/config.ts`:

Add to the `AutoFollowConfig` interface (after `maxPerRun: number;`):

```ts
  unhealthyAfterZeroCycles: number;
```

Add to the `AutoFollowFile` interface (the JSON shape, after `maxPerRun?: number;`):

```ts
  unhealthyAfterZeroCycles?: number;
```

Add to the flags interface and parser. In the flags type (after `maxPerRun?: number;`):

```ts
  unhealthyAfterZeroCycles?: number;
```

In `parseAutoFollowFlags`, add a case alongside the others, mirroring the exact
`--max` handling (note the loop uses `args[i]` and guards on `args[i + 1]`):

```ts
    } else if (args[i] === "--unhealthy-after" && args[i + 1]) {
      flags.unhealthyAfterZeroCycles = parseInt(args[++i], 10);
```

Insert it as an `else if` branch before the `--dry-run` branch (so it sits with
the value-taking flags), keeping the existing `--dry-run` / `--no-dry-run`
branches after it.

In the returned config object (after the `maxPerRun:` line):

```ts
    unhealthyAfterZeroCycles: pick(file.unhealthyAfterZeroCycles, flags.unhealthyAfterZeroCycles, 2),
```

- [ ] **Step 2: Add the config value**

In `config/auto-follow.json`, add `"unhealthyAfterZeroCycles": 2` after the `"maxPerRun"` line (keep valid JSON — the preceding line needs a trailing comma). Do NOT change any other value (leave `dryRun` as it currently is).

- [ ] **Step 3: Add the loud warning to the loop**

In `src/examples/auto-follow.ts`, add `isUnhealthy` to the AutoFollowRunner import:

```ts
import { AutoFollowRunner, isUnhealthy } from "../services/AutoFollowRunner";
```

After the `appendLog({ type: "cycle", ...summary });` line, add:

```ts
      if (!summary.dryRun && isUnhealthy(summary.consecutiveZeroCycles, config.unhealthyAfterZeroCycles)) {
        console.error(
          `\n⚠️⚠️⚠️  UNHEALTHY: ${summary.consecutiveZeroCycles} consecutive cycles ` +
            `followed 0 of ${summary.attempted} attempted.\n` +
            `        Last success: ${store.getLastSuccessAt()?.toISOString() ?? "never"}.\n` +
            `        The account may be banned, the session may have expired, or X may\n` +
            `        be blocking follows. Check with: pnpm follow-status\n`
        );
      }
```

(`store` is already in scope in `main()`.)

- [ ] **Step 4: Create the follow-status command**

Create `src/examples/follow-status.ts`:

```ts
import { FollowStore } from "../services/FollowStore";
import { isUnhealthy } from "../services/AutoFollowRunner";
import * as fs from "fs";
import * as path from "path";

/**
 * At-a-glance health check for the auto-follow tool. Reads only local files
 * (state + config + JSONL log) — no API call, no env vars — so it's always safe
 * to run:  pnpm follow-status
 */
function ago(date: Date | null): string {
  if (!date) return "never";
  const ms = Date.now() - date.getTime();
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function readThreshold(): number {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "config", "auto-follow.json"), "utf8")
    );
    return typeof cfg.unhealthyAfterZeroCycles === "number" ? cfg.unhealthyAfterZeroCycles : 2;
  } catch {
    return 2;
  }
}

function recentAdded(n: number): number[] {
  try {
    const lines = fs
      .readFileSync(path.join(process.cwd(), "output", "auto-follow-log.jsonl"), "utf8")
      .trim()
      .split("\n");
    const cycles = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.type === "cycle");
    return cycles.slice(-n).map((r) => r.addedCount ?? 0);
  } catch {
    return [];
  }
}

function main() {
  const statePath = path.join(process.cwd(), ".auth", "auto-follow-state.json");
  if (!fs.existsSync(statePath)) {
    console.log("No state yet — has the tool run? (expected " + statePath + ")");
    return;
  }

  const store = new FollowStore(statePath);
  store.load();
  const threshold = readThreshold();
  const zero = store.getConsecutiveZeroCycles();
  const unhealthy = isUnhealthy(zero, threshold);

  const recent = recentAdded(6);
  const spark = recent.length ? recent.map((n) => `+${n}`).join(" ") : "(no log yet)";

  console.log(`Auto-follow status: ${unhealthy ? "⚠️ UNHEALTHY" : "✅ HEALTHY"}`);
  console.log(`  Last run:        ${store.getLastRun()?.toISOString() ?? "never"} (${ago(store.getLastRun())})`);
  console.log(`  Last success:    ${store.getLastSuccessAt()?.toISOString() ?? "never"} (${ago(store.getLastSuccessAt())})`);
  console.log(`  Consecutive zero-follow cycles: ${zero} (threshold ${threshold})`);
  console.log(`  Followed (local): ${store.followedCount()}    Queue: ${store.queueSize()}`);
  console.log(`  Recent cycles (added): ${spark}`);
}

main();
```

- [ ] **Step 5: Add the pnpm script**

In `package.json` `"scripts"`, after the `"follow-audit"` line, add:

```json
    "follow-status": "ts-node src/examples/follow-status.ts"
```

(Keep JSON valid — preceding line gets a trailing comma.)

- [ ] **Step 6: Update the README**

In `README.md`, after the `follow-audit` documentation block in the Auto-Follow
section, add:

````markdown
Because the tool runs unattended, it self-monitors. Each real cycle that tries
to follow people but lands none increments a counter; any successful cycle
resets it. After `unhealthyAfterZeroCycles` (default 2) consecutive zero-follow
cycles it logs a loud `⚠️ UNHEALTHY` warning — the account may be banned, the
session may have expired, or X may be blocking follows. Check anytime with:

```bash
pnpm follow-status
```

`follow-status` reads only local files (no API call, no env vars) and prints a
`✅ HEALTHY` / `⚠️ UNHEALTHY` verdict with the last run/success times, the
consecutive zero-follow count, and the last few cycles' follow counts.
````

- [ ] **Step 7: Type-check and run the suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; all tests pass (scripts have no tests but must compile).

- [ ] **Step 8: Smoke-check follow-status against the current state file**

Run: `pnpm follow-status`
Expected: prints an `Auto-follow status:` block (the repo has a real
`.auth/auto-follow-state.json` from earlier runs). If `.auth/auto-follow-state.json`
does not exist in the running environment, it prints the "No state yet" line and
exits 0 — either is acceptable; report which occurred.

- [ ] **Step 9: Commit**

```bash
git add src/config.ts config/auto-follow.json src/examples/auto-follow.ts src/examples/follow-status.ts package.json README.md
git commit -m "feat: warn on unhealthy auto-follow and add follow-status

The loop now prints a loud UNHEALTHY warning once consecutiveZeroCycles
reaches unhealthyAfterZeroCycles (config, default 2). New follow-status
command reports HEALTHY/UNHEALTHY plus last run/success and recent cycle
follow counts, reading only local files (no API, no env). Config gains
the threshold with a --unhealthy-after flag; README documents both."
```

---

## Self-Review

**1. Spec coverage:**
- Health fields `lastSuccessAt`/`consecutiveZeroCycles`, backward-compatible → Task 1 ✅
- `drainQueue` returns attempted count → Task 2 ✅
- Health rule (attempted-but-0 increments; success resets + lastSuccessAt; attempted==0 untouched; dry-run untouched) → Task 2 impl + 4 tests ✅
- `CycleSummary` gains attempted/followFailures/consecutiveZeroCycles → Task 2 ✅
- `isUnhealthy(zero, threshold)` shared helper → Task 2 ✅
- Config `unhealthyAfterZeroCycles` default 2 + flag → Task 3 ✅
- Loud warning in loop (real run + unhealthy) → Task 3 ✅
- `follow-status` local-only, no env/API, missing-state friendly, JSONL best-effort → Task 3 ✅
- package.json + README → Task 3 ✅

**2. Placeholder scan:** No TBD/TODO; all code shown in full. ✅

**3. Type consistency:** FollowStore accessors (`getLastSuccessAt`/`setLastSuccessAt`/`getConsecutiveZeroCycles`/`setConsecutiveZeroCycles`) are named identically in Task 1 definition, Task 2 usage, and Task 3 (`follow-status`). `drainQueue` returns `{ followed, attempted }` in Task 2 and is destructured as such in `runCycle`. `isUnhealthy(consecutiveZeroCycles, threshold)` signature matches across Task 2 (export), Task 3 loop, and Task 3 follow-status. `CycleSummary.consecutiveZeroCycles`/`attempted`/`followFailures` defined Task 2, consumed Task 3. `config.unhealthyAfterZeroCycles` defined Task 3 config, consumed Task 3 loop. ✅
