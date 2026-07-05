# X Keyword-Driven Auto-Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a long-running example that periodically searches configured X keywords via twitterapi.io and follows the tweet authors through a Playwright browser session, safe by default (dry-run), with per-cycle caps, randomized delays, and persistent dedupe.

**Architecture:** Reuse the existing `TweetService.advancedSearch` (read-only, `x-api-key`) for discovery. Add three new focused units — `FollowStore` (persistence), `BrowserFollowService` (Playwright, implements a narrow `IFollower`), and `AutoFollowRunner` (one cycle of orchestration) — plus a `loadAutoFollowConfig` loader and an `examples/auto-follow.ts` loop. Services depend on interfaces (`IFollower`, `IHttpClient`), each owns one responsibility, matching the repo's existing SOLID layering.

**Tech Stack:** TypeScript (CommonJS, TS 6, `strict`), ts-node, Node's built-in `node --test` runner via `ts-node/register/transpile-only` (no new test framework dependency), Playwright (new runtime dependency).

## Global Constraints

- Node **v24+** (built-in `node --test` used for all tests). Tests run through `ts-node/register/transpile-only` — full type-checking of test files is skipped there (it chokes on `node:test` ambient types under TS 6); `npx tsc --noEmit` is the separate type-check gate.
- Module system is **CommonJS**; `tsconfig` has `rootDir: "src"`, `strict: true`, `resolveJsonModule: true`. All source and test files live under `src/`.
- Follow target is a **username** (browser navigates to `x.com/<username>`). Tweet authors expose `{ userName, name }` and **no numeric id**, so dedupe is by **lowercased `userName`**.
- Config resolution order per field: **JSON value → CLI flag → built-in default** (a value present in `config/auto-follow.json` wins over a flag).
- Persistent state (followed set + last-run timestamp) and the browser session live under **`.auth/`** (git-ignored), never `output/`.
- Safety: `dryRun` defaults to `true`; `maxPerRun` caps follows per cycle; randomized **30–90s** delay between real follows.
- Commit messages: Conventional Commits (`type: subject`, lowercase imperative), no `Co-Authored-By` trailer (globally disabled).
- Existing `WriteService.followUser` is left untouched and unused by this feature.

---

## File Structure

```
src/
  follow/
    IFollower.ts              ← interface { follow(username): Promise<void> }  (new)
  services/
    FollowStore.ts            ← persistence: followed set + last-run time       (new)
    BrowserFollowService.ts   ← Playwright login/session/follow, implements IFollower (new)
    AutoFollowRunner.ts       ← one cycle: search → dedupe → filter → follow    (new)
  config.ts                   ← add AutoFollowConfig + loadAutoFollowConfig      (modify)
  examples/
    auto-follow.ts            ← loads config, builds services, runs the loop     (new)
  services/__tests__/
    FollowStore.test.ts       ← unit tests (node --test)                         (new)
    AutoFollowRunner.test.ts  ← unit tests with fakes (node --test)              (new)
config/auto-follow.json       ← already committed
package.json                  ← add test script, example:auto-follow, playwright (modify)
.gitignore                    ← add .auth/                                       (modify)
README.md                     ← document the new example                         (modify)
```

Test files live under `src/services/__tests__/` so `ts-node` compiles them with the same `tsconfig`. Tests are run with `node --test` via a `--require ts-node/register/transpile-only` loader (see Task 1).

---

## Task 1: Test harness + gitignore + Playwright dependency

**Files:**
- Modify: `package.json` (scripts + dependencies)
- Modify: `.gitignore`
- Create: `src/services/__tests__/smoke.test.ts` (temporary, deleted at end of task)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `pnpm test` command that runs `node --test` over `src/**/*.test.ts` through ts-node; `.auth/` ignored; `playwright` installed.

- [ ] **Step 1: Add `.auth/` to `.gitignore`**

Append a line so the browser session and follow-state never get committed. Resulting `.gitignore`:

```
node_modules/
dist/
output/
.env
instruction.md
*.js.map
.auth/
```

- [ ] **Step 2: Add the test script and example script to `package.json`**

In the `"scripts"` block, add these two entries (keep all existing scripts):

```json
    "test": "node --require ts-node/register/transpile-only --test \"src/**/*.test.ts\"",
    "example:auto-follow": "ts-node src/examples/auto-follow.ts"
```

- [ ] **Step 3: Add Playwright as a dependency**

Run:

```bash
pnpm add playwright
```

Expected: `playwright` appears under `"dependencies"` in `package.json` and `pnpm-lock.yaml` updates.

- [ ] **Step 4: Install the Chromium browser binary**

Run:

```bash
npx playwright install chromium
```

Expected: Chromium downloads successfully (prints a resolved install path).

- [ ] **Step 5: Write a temporary smoke test to prove the harness runs**

Create `src/services/__tests__/smoke.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";

test("test harness runs", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 6: Run the test harness**

Run:

```bash
pnpm test
```

Expected: PASS — output includes `ℹ pass 1` and exit code 0. The quoted `"src/**/*.test.ts"` is expanded by Node's own `--test` glob support (not the shell), which is why the pattern is quoted in the script.

- [ ] **Step 7: Delete the smoke test**

Run:

```bash
rm src/services/__tests__/smoke.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore
git commit -m "chore: add node --test harness, playwright dep, and .auth ignore"
```

---

## Task 2: `IFollower` interface

**Files:**
- Create: `src/follow/IFollower.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface IFollower { follow(username: string): Promise<void>; }` — depended on by `AutoFollowRunner` (Task 4) and implemented by `BrowserFollowService` (Task 5).

- [ ] **Step 1: Create the interface file**

Create `src/follow/IFollower.ts`:

```typescript
/**
 * Follows a single X account by username. Implementations decide the mechanism
 * (browser automation, API, etc.). Idempotent: following an already-followed
 * account must not throw.
 */
export interface IFollower {
  follow(username: string): Promise<void>;
}
```

- [ ] **Step 2: Verify it compiles**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/follow/IFollower.ts
git commit -m "feat: add IFollower interface for the follow mechanism"
```

---

## Task 3: `FollowStore` — persistence

**Files:**
- Create: `src/services/FollowStore.ts`
- Test: `src/services/__tests__/FollowStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class FollowStore` constructed as `new FollowStore(filePath: string)`.
  - `load(): void` — reads the file if present; missing or malformed file → empty state (no throw).
  - `has(username: string): boolean` — case-insensitive membership.
  - `add(username: string): void` — records a followed username (stored lowercased).
  - `getLastRun(): Date | null` — last completed cycle time, or null if never run.
  - `setLastRun(date: Date): void`.
  - `save(): void` — writes the JSON file, creating parent dirs.
  - On-disk shape: `{ "followed": string[], "lastRun": string | null }`.

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/FollowStore.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FollowStore } from "../FollowStore";

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fs-")), "state.json");
}

test("missing file loads as empty state", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  assert.equal(store.has("alice"), false);
  assert.equal(store.getLastRun(), null);
});

test("add + has is case-insensitive", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.add("Alice");
  assert.equal(store.has("alice"), true);
  assert.equal(store.has("ALICE"), true);
});

test("save then load round-trips followed set and lastRun", () => {
  const file = tmpFile();
  const when = new Date("2026-07-06T00:00:00.000Z");
  const a = new FollowStore(file);
  a.load();
  a.add("bob");
  a.setLastRun(when);
  a.save();

  const b = new FollowStore(file);
  b.load();
  assert.equal(b.has("bob"), true);
  assert.deepEqual(b.getLastRun(), when);
});

test("malformed file loads as empty state without throwing", () => {
  const file = tmpFile();
  fs.writeFileSync(file, "{ not valid json", "utf8");
  const store = new FollowStore(file);
  store.load();
  assert.equal(store.has("anyone"), false);
  assert.equal(store.getLastRun(), null);
});

test("save creates parent directories", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fs-")), "nested", "deep", "state.json");
  const store = new FollowStore(file);
  store.load();
  store.add("carol");
  store.save();
  assert.equal(fs.existsSync(file), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --require ts-node/register/transpile-only --test src/services/__tests__/FollowStore.test.ts
```

Expected: FAIL — cannot find module `../FollowStore`.

- [ ] **Step 3: Implement `FollowStore`**

Create `src/services/FollowStore.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";

interface FollowStoreData {
  followed: string[];
  lastRun: string | null;
}

export class FollowStore {
  private followed = new Set<string>();
  private lastRun: Date | null = null;

  constructor(private readonly filePath: string) {}

  load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as FollowStoreData;
      this.followed = new Set((data.followed ?? []).map((u) => u.toLowerCase()));
      this.lastRun = data.lastRun ? new Date(data.lastRun) : null;
    } catch {
      this.followed = new Set();
      this.lastRun = null;
    }
  }

  has(username: string): boolean {
    return this.followed.has(username.toLowerCase());
  }

  add(username: string): void {
    this.followed.add(username.toLowerCase());
  }

  getLastRun(): Date | null {
    return this.lastRun;
  }

  setLastRun(date: Date): void {
    this.lastRun = date;
  }

  save(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data: FollowStoreData = {
      followed: [...this.followed],
      lastRun: this.lastRun ? this.lastRun.toISOString() : null,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
node --require ts-node/register/transpile-only --test src/services/__tests__/FollowStore.test.ts
```

Expected: PASS — `# pass 5`.

- [ ] **Step 5: Commit**

```bash
git add src/services/FollowStore.ts src/services/__tests__/FollowStore.test.ts
git commit -m "feat: add FollowStore for follow dedupe and last-run tracking"
```

---

## Task 4: `AutoFollowRunner` — one cycle

**Files:**
- Create: `src/services/AutoFollowRunner.ts`
- Test: `src/services/__tests__/AutoFollowRunner.test.ts`

**Interfaces:**
- Consumes:
  - `IFollower` from `src/follow/IFollower.ts` (`follow(username)`).
  - `FollowStore` from Task 3 (`has`, `add`, `getLastRun`, `setLastRun`).
  - A tweet source shaped like `TweetService.advancedSearch(query: string, queryType?: string): AsyncGenerator<Tweet>` where `Tweet` has `author?: { userName: string; name: string }`.
- Produces:
  - `interface AutoFollowRunnerOptions { keywords: string[]; queryType: string; perKeyword: number; maxPerRun: number; dryRun: boolean; delayMs?: () => number; now?: () => Date; }`
  - `interface CycleSummary { scanned: number; candidates: number; followed: string[]; }`
  - `class AutoFollowRunner` constructed as `new AutoFollowRunner(search, store, follower, options)` where `search` is an object with `advancedSearch`.
  - `runCycle(): Promise<CycleSummary>`.

Note: the runner appends `since:<ISO>` to each keyword query when `store.getLastRun()` is non-null. It dedupes candidate authors by lowercased `userName`, drops any already in the store, caps at `maxPerRun`, and (unless `dryRun`) calls `follower.follow` + `store.add` for each, sleeping `delayMs()` between real follows. `delayMs` and `now` are injectable so tests are deterministic (default `delayMs` returns a random 30000–90000; default `now` is `() => new Date()`).

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/AutoFollowRunner.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { AutoFollowRunner } from "../AutoFollowRunner";
import { FollowStore } from "../FollowStore";
import { IFollower } from "../../follow/IFollower";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface FakeTweet {
  author?: { userName: string; name: string };
}

function fakeSearch(byQuery: Record<string, FakeTweet[]>) {
  const queries: string[] = [];
  return {
    queries,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async *advancedSearch(query: string, _queryType?: string): AsyncGenerator<FakeTweet> {
      queries.push(query);
      for (const t of byQuery[query] ?? []) yield t;
    },
  };
}

function recordingFollower(): { followed: string[] } & IFollower {
  const followed: string[] = [];
  return {
    followed,
    async follow(username: string) {
      followed.push(username);
    },
  };
}

function tmpStore(): FollowStore {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "afr-")), "s.json");
  const s = new FollowStore(file);
  s.load();
  return s;
}

test("dedupes authors across keywords and caps at maxPerRun", async () => {
  const search = fakeSearch({
    kw1: [{ author: { userName: "alice", name: "A" } }, { author: { userName: "bob", name: "B" } }],
    kw2: [{ author: { userName: "Alice", name: "A" } }, { author: { userName: "carol", name: "C" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1", "kw2"],
    queryType: "Latest",
    perKeyword: 30,
    maxPerRun: 2,
    dryRun: false,
    delayMs: () => 0,
  });

  const summary = await runner.runCycle();

  // alice (once, case-insensitive), bob — carol dropped by maxPerRun=2
  assert.deepEqual(follower.followed, ["alice", "bob"]);
  assert.equal(summary.followed.length, 2);
});

test("excludes users already in the store", async () => {
  const store = tmpStore();
  store.add("bob");
  const search = fakeSearch({
    kw1: [{ author: { userName: "alice", name: "A" } }, { author: { userName: "bob", name: "B" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
  });

  await runner.runCycle();

  assert.deepEqual(follower.followed, ["alice"]);
});

test("dryRun follows nobody but still reports candidates", async () => {
  const search = fakeSearch({
    kw1: [{ author: { userName: "alice", name: "A" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
  });

  const summary = await runner.runCycle();

  assert.deepEqual(follower.followed, []);
  assert.deepEqual(summary.followed, ["alice"]);
});

test("respects perKeyword scan cap", async () => {
  const many: FakeTweet[] = Array.from({ length: 50 }, (_, i) => ({
    author: { userName: `u${i}`, name: "x" },
  }));
  const search = fakeSearch({ kw1: many });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 5,
    maxPerRun: 100,
    dryRun: false,
    delayMs: () => 0,
  });

  const summary = await runner.runCycle();

  assert.equal(summary.scanned, 5);
  assert.equal(follower.followed.length, 5);
});

test("appends since: filter when store has a last-run time", async () => {
  const store = tmpStore();
  store.setLastRun(new Date("2026-07-06T00:00:00.000Z"));
  const search = fakeSearch({});
  const runner = new AutoFollowRunner(search, store, recordingFollower(), {
    keywords: ["myword"],
    queryType: "Latest",
    perKeyword: 30,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
  });

  await runner.runCycle();

  assert.equal(search.queries.length, 1);
  assert.match(search.queries[0], /^myword since:2026-07-06/);
});

test("sets last-run after the cycle", async () => {
  const store = tmpStore();
  const fixedNow = new Date("2026-07-06T12:00:00.000Z");
  const runner = new AutoFollowRunner(fakeSearch({}), store, recordingFollower(), {
    keywords: ["kw1"],
    queryType: "Latest",
    perKeyword: 30,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    now: () => fixedNow,
  });

  await runner.runCycle();

  assert.deepEqual(store.getLastRun(), fixedNow);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --require ts-node/register/transpile-only --test src/services/__tests__/AutoFollowRunner.test.ts
```

Expected: FAIL — cannot find module `../AutoFollowRunner`.

- [ ] **Step 3: Implement `AutoFollowRunner`**

Create `src/services/AutoFollowRunner.ts`:

```typescript
import { IFollower } from "../follow/IFollower";
import { FollowStore } from "./FollowStore";

interface AuthoredTweet {
  author?: { userName: string; name: string };
}

interface TweetSource {
  advancedSearch(query: string, queryType?: string): AsyncGenerator<AuthoredTweet>;
}

export interface AutoFollowRunnerOptions {
  keywords: string[];
  queryType: string;
  perKeyword: number;
  maxPerRun: number;
  dryRun: boolean;
  /** Milliseconds to wait between real follows. Defaults to a random 30–90s. */
  delayMs?: () => number;
  /** Clock, injectable for tests. Defaults to `new Date()`. */
  now?: () => Date;
}

export interface CycleSummary {
  scanned: number;
  candidates: number;
  followed: string[];
}

function randomDelayMs(): number {
  return 30000 + Math.floor(Math.random() * 60001); // 30000–90000
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AutoFollowRunner {
  private readonly delayMs: () => number;
  private readonly now: () => Date;

  constructor(
    private readonly source: TweetSource,
    private readonly store: FollowStore,
    private readonly follower: IFollower,
    private readonly options: AutoFollowRunnerOptions
  ) {
    this.delayMs = options.delayMs ?? randomDelayMs;
    this.now = options.now ?? (() => new Date());
  }

  async runCycle(): Promise<CycleSummary> {
    const lastRun = this.store.getLastRun();
    const sinceSuffix = lastRun
      ? ` since:${lastRun.toISOString().slice(0, 19).replace("T", "_")}_UTC`
      : "";

    let scanned = 0;
    const seen = new Set<string>();
    const candidates: string[] = [];

    for (const keyword of this.options.keywords) {
      const query = `${keyword}${sinceSuffix}`;
      let perKeywordCount = 0;
      try {
        for await (const tweet of this.source.advancedSearch(query, this.options.queryType)) {
          if (perKeywordCount >= this.options.perKeyword) break;
          perKeywordCount++;
          scanned++;
          const userName = tweet.author?.userName;
          if (!userName) continue;
          const key = userName.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          if (this.store.has(userName)) continue;
          candidates.push(userName);
        }
      } catch (err) {
        console.error(
          `Search failed for "${query}":`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    const targets = candidates.slice(0, this.options.maxPerRun);
    const followed: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      const userName = targets[i];
      if (this.options.dryRun) {
        console.log(`[dry-run] would follow @${userName}`);
        followed.push(userName);
        continue;
      }
      try {
        if (i > 0) await sleep(this.delayMs());
        await this.follower.follow(userName);
        this.store.add(userName);
        followed.push(userName);
        console.log(`Followed @${userName}`);
      } catch (err) {
        console.error(
          `Follow failed for @${userName}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    this.store.setLastRun(this.now());
    this.store.save();

    return { scanned, candidates: candidates.length, followed };
  }
}
```

Note on the `since:` format: X advanced search accepts `since:YYYY-MM-DD_HH:MM:SS_UTC`. The test only asserts the prefix `myword since:2026-07-06`, so this exact format satisfies it while giving X a valid timestamp filter.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
node --require ts-node/register/transpile-only --test src/services/__tests__/AutoFollowRunner.test.ts
```

Expected: PASS — `# pass 6`.

- [ ] **Step 5: Commit**

```bash
git add src/services/AutoFollowRunner.ts src/services/__tests__/AutoFollowRunner.test.ts
git commit -m "feat: add AutoFollowRunner for one search-and-follow cycle"
```

---

## Task 5: `BrowserFollowService` — Playwright

**Files:**
- Create: `src/services/BrowserFollowService.ts`

**Interfaces:**
- Consumes: `IFollower` (implements it); `WriteConfig` from `config.ts` for `xUser`/`xEmail`/`xPassword`/`xTotp`.
- Produces:
  - `class BrowserFollowService implements IFollower`.
  - Constructed as `new BrowserFollowService(config: BrowserFollowConfig)` where
    `interface BrowserFollowConfig { xUser: string; xEmail: string; xPassword: string; xTotp?: string; storageStatePath: string; headless?: boolean; }`.
  - `login(): Promise<void>` — launches Chromium, reuses saved `storageState` if the file exists, else performs an automated login and saves `storageState`.
  - `follow(username: string): Promise<void>` — navigates to the profile and clicks Follow; no-op if already following.
  - `close(): Promise<void>` — closes the browser.

This task has no unit test (it drives a live browser). It is kept thin and verified manually in Task 7. Keep the implementation defensive but simple.

- [ ] **Step 1: Implement `BrowserFollowService`**

Create `src/services/BrowserFollowService.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { IFollower } from "../follow/IFollower";

export interface BrowserFollowConfig {
  xUser: string;
  xEmail: string;
  xPassword: string;
  xTotp?: string;
  storageStatePath: string;
  headless?: boolean;
}

export class BrowserFollowService implements IFollower {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(private readonly config: BrowserFollowConfig) {}

  async login(): Promise<void> {
    if (this.context) return;

    this.browser = await chromium.launch({
      headless: this.config.headless ?? false,
    });

    const hasSession = fs.existsSync(this.config.storageStatePath);
    this.context = await this.browser.newContext(
      hasSession ? { storageState: this.config.storageStatePath } : {}
    );

    if (hasSession) {
      // Verify the saved session is still valid.
      const page = await this.context.newPage();
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
      const loggedIn = await page
        .getByTestId("SideNav_AccountSwitcher_Button")
        .isVisible()
        .catch(() => false);
      await page.close();
      if (loggedIn) return;
    }

    // No valid session — perform an automated login.
    const page = await this.context.newPage();
    await this.performLogin(page);
    await page.close();

    fs.mkdirSync(path.dirname(this.config.storageStatePath), { recursive: true });
    await this.context.storageState({ path: this.config.storageStatePath });
  }

  private async performLogin(page: Page): Promise<void> {
    await page.goto("https://x.com/i/flow/login", { waitUntil: "domcontentloaded" });

    // Step 1: username
    await page.getByLabel("Phone, email, or username").fill(this.config.xUser);
    await page.getByRole("button", { name: "Next" }).click();

    // X sometimes asks for the email/username to confirm an unusual login.
    const confirm = page.getByTestId("ocfEnterTextTextInput");
    if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirm.fill(this.config.xEmail);
      await page.getByTestId("ocfEnterTextNextButton").click();
    }

    // Step 2: password
    await page.getByLabel("Password", { exact: true }).fill(this.config.xPassword);
    await page.getByTestId("LoginForm_Login_Button").click();

    // Step 3: optional TOTP 2FA
    if (this.config.xTotp) {
      const totpInput = page.getByTestId("ocfEnterTextTextInput");
      if (await totpInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        const { authenticator } = await import("otplib");
        await totpInput.fill(authenticator.generate(this.config.xTotp));
        await page.getByTestId("ocfEnterTextNextButton").click();
      }
    }

    await page.waitForURL("https://x.com/home", { timeout: 30000 });
  }

  async follow(username: string): Promise<void> {
    if (!this.context) throw new Error("Not logged in — call login() first");
    const page = await this.context.newPage();
    try {
      await page.goto(`https://x.com/${username}`, { waitUntil: "domcontentloaded" });

      const followButton = page.getByTestId("placementTracking").getByRole("button", {
        name: /^Follow$/,
      });

      if (await followButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await followButton.click();
        await page.getByRole("button", { name: /^Following$/ }).waitFor({ timeout: 5000 });
      }
      // If the Follow button is not visible, we are already following — no-op.
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = null;
    this.browser = null;
  }
}
```

- [ ] **Step 2: Add `otplib` dependency (only if TOTP is used)**

The optional 2FA path imports `otplib` lazily. Install it so the import resolves:

```bash
pnpm add otplib
```

Expected: `otplib` added under `"dependencies"`.

- [ ] **Step 3: Verify it compiles**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/BrowserFollowService.ts package.json pnpm-lock.yaml
git commit -m "feat: add BrowserFollowService for Playwright-driven follows"
```

---

## Task 6: `loadAutoFollowConfig` + config plumbing

**Files:**
- Modify: `src/config.ts`

**Interfaces:**
- Consumes: `config/auto-follow.json`; `process.env` (`TWITTERAPI_IO_KEY`, `X_*`); `process.argv`.
- Produces:
  - `interface AutoFollowConfig` with:
    `apiKey: string; xUser: string; xEmail: string; xPassword: string; xTotp?: string;`
    `keywords: string[]; queryType: string; intervalMinutes: number; perKeyword: number; maxPerRun: number; dryRun: boolean; storageStatePath: string; statePath: string;`
  - `function loadAutoFollowConfig(argv?: string[]): AutoFollowConfig`.

Resolution per tunable field: JSON value → CLI flag → default. Flags: `--interval <min>`, `--per-keyword <n>`, `--max <n>`, `--dry-run`, `--no-dry-run`.

- [ ] **Step 1: Add the loader to `config.ts`**

Append to `src/config.ts` (keep existing exports; add these imports at the top of the file alongside the existing `dotenv` import):

```typescript
import * as fs from "fs";
import * as path from "path";
```

Then append:

```typescript
export interface AutoFollowConfig {
  apiKey: string;
  xUser: string;
  xEmail: string;
  xPassword: string;
  xTotp?: string;
  keywords: string[];
  queryType: string;
  intervalMinutes: number;
  perKeyword: number;
  maxPerRun: number;
  dryRun: boolean;
  storageStatePath: string;
  statePath: string;
}

interface AutoFollowFile {
  keywords?: string[];
  queryType?: string;
  intervalMinutes?: number;
  perKeyword?: number;
  maxPerRun?: number;
  dryRun?: boolean;
}

function parseAutoFollowFlags(argv: string[]): {
  intervalMinutes?: number;
  perKeyword?: number;
  maxPerRun?: number;
  dryRun?: boolean;
} {
  const args = argv.slice(2);
  const flags: {
    intervalMinutes?: number;
    perKeyword?: number;
    maxPerRun?: number;
    dryRun?: boolean;
  } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--interval" && args[i + 1]) {
      flags.intervalMinutes = parseInt(args[++i], 10);
    } else if (args[i] === "--per-keyword" && args[i + 1]) {
      flags.perKeyword = parseInt(args[++i], 10);
    } else if (args[i] === "--max" && args[i + 1]) {
      flags.maxPerRun = parseInt(args[++i], 10);
    } else if (args[i] === "--dry-run") {
      flags.dryRun = true;
    } else if (args[i] === "--no-dry-run") {
      flags.dryRun = false;
    }
  }
  return flags;
}

export function loadAutoFollowConfig(argv: string[] = process.argv): AutoFollowConfig {
  const filePath = path.join(process.cwd(), "config", "auto-follow.json");
  const file: AutoFollowFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const flags = parseAutoFollowFlags(argv);

  if (!file.keywords || file.keywords.length === 0) {
    throw new Error("config/auto-follow.json must define a non-empty keywords array");
  }

  // Resolution order per field: JSON value → CLI flag → default.
  const pick = <T>(fromJson: T | undefined, fromFlag: T | undefined, dflt: T): T =>
    fromJson !== undefined ? fromJson : fromFlag !== undefined ? fromFlag : dflt;

  return {
    apiKey: requireEnv("TWITTERAPI_IO_KEY"),
    xUser: requireEnv("X_USER"),
    xEmail: requireEnv("X_EMAIL"),
    xPassword: requireEnv("X_PASSWORD"),
    xTotp: process.env["X_TOTP"],
    keywords: file.keywords,
    queryType: file.queryType ?? "Latest",
    intervalMinutes: pick(file.intervalMinutes, flags.intervalMinutes, 60),
    perKeyword: pick(file.perKeyword, flags.perKeyword, 30),
    maxPerRun: pick(file.maxPerRun, flags.maxPerRun, 25),
    dryRun: pick(file.dryRun, flags.dryRun, true),
    storageStatePath: path.join(process.cwd(), ".auth", "x-session.json"),
    statePath: path.join(process.cwd(), ".auth", "auto-follow-state.json"),
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-test the loader reads the committed config**

Run:

```bash
TWITTERAPI_IO_KEY=x X_USER=x X_EMAIL=x X_PASSWORD=x npx ts-node -e "import { loadAutoFollowConfig } from './src/config'; const c = loadAutoFollowConfig(['node','x']); console.log('keywords:', c.keywords.length, 'maxPerRun:', c.maxPerRun, 'dryRun:', c.dryRun);"
```

Expected: prints `keywords: 26 maxPerRun: 25 dryRun: true` (JSON values win over defaults).

- [ ] **Step 4: Verify a flag fills in an omitted JSON field**

Temporarily confirm override behavior (the JSON has `maxPerRun`, so `--max` should be ignored; `--interval` is present in JSON too). Test a field the JSON omits by checking the flag path with a quick inline scenario — since the committed JSON defines all tunables, this asserts JSON precedence:

```bash
TWITTERAPI_IO_KEY=x X_USER=x X_EMAIL=x X_PASSWORD=x npx ts-node -e "import { loadAutoFollowConfig } from './src/config'; const c = loadAutoFollowConfig(['node','x','--max','999']); console.log('maxPerRun:', c.maxPerRun);"
```

Expected: prints `maxPerRun: 25` (JSON value wins over the `--max 999` flag), confirming resolution order.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts
git commit -m "feat: add loadAutoFollowConfig with JSON-over-flag resolution"
```

---

## Task 7: `examples/auto-follow.ts` — loop + manual verification

**Files:**
- Create: `src/examples/auto-follow.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `loadAutoFollowConfig` (Task 6), `TwitterClient`, `TweetService`, `FollowStore` (Task 3), `BrowserFollowService` (Task 5), `AutoFollowRunner` (Task 4).
- Produces: a runnable `pnpm example:auto-follow`.

- [ ] **Step 1: Implement the example loop**

Create `src/examples/auto-follow.ts`:

```typescript
import { loadAutoFollowConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService } from "../services/TweetService";
import { FollowStore } from "../services/FollowStore";
import { BrowserFollowService } from "../services/BrowserFollowService";
import { AutoFollowRunner } from "../services/AutoFollowRunner";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = loadAutoFollowConfig();
  const client = new TwitterClient(config.apiKey);
  const tweets = new TweetService(client);

  const store = new FollowStore(config.statePath);
  store.load();

  const follower = new BrowserFollowService({
    xUser: config.xUser,
    xEmail: config.xEmail,
    xPassword: config.xPassword,
    xTotp: config.xTotp,
    storageStatePath: config.storageStatePath,
  });

  const runner = new AutoFollowRunner(tweets, store, follower, {
    keywords: config.keywords,
    queryType: config.queryType,
    perKeyword: config.perKeyword,
    maxPerRun: config.maxPerRun,
    dryRun: config.dryRun,
  });

  let stopping = false;
  const shutdown = async () => {
    stopping = true;
    console.log("\nShutting down...");
    await follower.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);

  console.log(
    `Auto-follow started — ${config.keywords.length} keywords, ` +
      `maxPerRun=${config.maxPerRun}, interval=${config.intervalMinutes}m, ` +
      `dryRun=${config.dryRun}`
  );

  if (!config.dryRun) {
    console.log("Logging in to X via browser...");
    await follower.login();
    console.log("Logged in.");
  }

  while (!stopping) {
    const started = new Date();
    console.log(`\n[${started.toISOString()}] Running cycle...`);
    try {
      const summary = await runner.runCycle();
      console.log(
        `Cycle done — scanned ${summary.scanned}, ` +
          `candidates ${summary.candidates}, followed ${summary.followed.length}`
      );
    } catch (err) {
      console.error("Cycle error:", err instanceof Error ? err.message : String(err));
    }
    if (stopping) break;
    console.log(`Sleeping ${config.intervalMinutes}m until next cycle...`);
    await sleep(config.intervalMinutes * 60_000);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run one dry-run cycle against the real search API**

This exercises config load → real `advancedSearch` → dedupe → dry-run reporting, without a browser and without following anyone. Requires a valid `TWITTERAPI_IO_KEY` in `.env`.

Run:

```bash
pnpm example:auto-follow
```

Expected: prints `Auto-follow started ... dryRun=true`, then a cycle that prints `[dry-run] would follow @<username>` lines (up to 25) and `Cycle done — scanned N, candidates M, followed K`. Press Ctrl+C to stop; it should print `Shutting down...` and exit. Confirm `.auth/auto-follow-state.json` was written with a `lastRun` timestamp.

- [ ] **Step 4: (Manual, optional) Verify one real follow**

Only if the user wants to confirm the browser path. Temporarily lower risk by editing `config/auto-follow.json` to a single keyword and `maxPerRun: 1`, then run with `--no-dry-run`:

```bash
pnpm example:auto-follow -- --no-dry-run
```

Expected: a Chromium window opens, logs in (or reuses `.auth/x-session.json`), navigates to one profile, clicks Follow, prints `Followed @<username>`. Stop with Ctrl+C. Revert the temporary config edit afterward. (Skip this step if the user prefers to verify follows themselves.)

- [ ] **Step 5: Update the README**

Add this section to `README.md` after the "Write Actions" section:

````markdown
### Auto-Follow (keyword search → browser follow via Playwright)

Continuously searches the keywords in `config/auto-follow.json` and follows the
authors of matching tweets through a real browser session (Playwright).

One-time setup:

```bash
npx playwright install chromium
```

Run:

```bash
pnpm example:auto-follow                 # dry-run (default): reports targets, follows nobody
pnpm example:auto-follow -- --no-dry-run # actually follow
pnpm example:auto-follow -- --interval 30 --max 15
```

Config lives in `config/auto-follow.json`. A value set there wins over the CLI
flag; flags fill in only omitted fields. Follow history and the browser session
are stored under `.auth/` (git-ignored) so restarts don't re-follow or re-login.

Requires the `X_*` env vars (see below) for the browser login.
````

- [ ] **Step 6: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: PASS — all FollowStore and AutoFollowRunner tests green (`# pass 11`).

- [ ] **Step 7: Commit**

```bash
git add src/examples/auto-follow.ts README.md
git commit -m "feat: add auto-follow example loop with dry-run default"
```

---

## Self-Review Notes

- **Spec coverage:** config loader (Task 6), FollowStore incl. last-run (Task 3), BrowserFollowService login/session/follow (Task 5), AutoFollowRunner cycle with dedupe/exclude/cap/dry-run/delay/since (Task 4), example loop + SIGINT (Task 7), IFollower for OCP/DIP (Task 2), playwright dep + `.auth/` ignore + README (Tasks 1, 7). All spec sections map to a task.
- **Dedupe key:** spec said "by user ID," but tweet authors carry no id and the browser follows by username — plan dedupes by lowercased `userName`, documented in Global Constraints.
- **Testing boundary:** matches spec — FollowStore and AutoFollowRunner unit-tested with fakes; BrowserFollowService verified manually (Task 7 steps 3–4).
- **Type consistency:** `IFollower.follow(username)`, `FollowStore.{has,add,getLastRun,setLastRun,load,save}`, `AutoFollowRunner(source, store, follower, options)`, `loadAutoFollowConfig(argv)` used consistently across tasks.
