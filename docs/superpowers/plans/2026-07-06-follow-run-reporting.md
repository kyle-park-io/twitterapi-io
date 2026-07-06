# Follow-Run Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the auto-follow tool a durable per-cycle JSONL report (timing, before/after follow counts, per-followed userName/name/url/keyword) plus a manual `follow-audit` command that records the account's actual following count as a reference cross-check.

**Architecture:** Queue candidates gain optional `{name, keyword}` metadata, stored backward-compatibly (old bare-string entries still load). `AutoFollowRunner.runCycle()` returns an enriched `CycleSummary`; the example loop appends it as one JSONL line to `output/auto-follow-log.jsonl`. A separate `follow-audit` script looks up the real following count via the existing `UserService` and appends an audit line to the same file.

**Tech Stack:** TypeScript (CommonJS, TS 6), ts-node, `node --test` via `ts-node/register/transpile-only`.

## Global Constraints

- Test runner: `pnpm test` (= `node --require ts-node/register/transpile-only --test "src/**/*.test.ts"`). Type-check separately: `pnpm exec tsc --noEmit`.
- Tests use `import { test } from "node:test"` and `import assert from "node:assert/strict"`; unit tests live in `src/services/__tests__/*.test.ts`, import via relative `../`.
- `examples/` scripts have no tests (I/O shells); they must compile and not break the suite.
- Commit convention: Conventional Commits, NO `Co-Authored-By` trailer, every commit has a body (what/why).
- Backward compat is mandatory: the current on-disk queue (`.auth/auto-follow-state.json`, 61 bare-string usernames) must keep loading. Normalize each queue entry: `typeof item === "string" ? { userName: item } : item`. Dedupe key is `userName.toLowerCase()`.
- Profile URL format: `https://x.com/${userName}` exactly.
- JSONL location: `output/auto-follow-log.jsonl` (git-ignored). Append one JSON object + `"\n"` per record. Cycle records carry `type: "cycle"`; audit records carry `type: "audit"`.
- JSONL append failure must NOT crash the follow loop (log and continue).
- Audit uses the READ API only: `apiKey` from `TWITTERAPI_IO_KEY` via `loadConfig()`, account handle from `process.env["X_USER"]` directly. No browser/login creds. Missing `X_USER` → exit 1 with a clear message.

## Type reference (defined in Task 1 and 2, used throughout)

```ts
// FollowStore.ts (Task 1)
export interface Candidate {
  userName: string;
  name?: string;
  keyword?: string;
}

// AutoFollowRunner.ts (Task 2)
export interface FollowedCandidate {
  userName: string;
  name?: string;
  url: string;        // `https://x.com/${userName}`
  keyword?: string;
}
export interface CycleSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scanned: number;
  queued: number;
  followedCountBefore: number;
  followedCountAfter: number;
  addedCount: number;
  followed: FollowedCandidate[];
  dryRun: boolean;
}
```

---

### Task 1: FollowStore candidate metadata (backward-compatible)

**Files:**
- Modify: `src/services/FollowStore.ts`
- Test: `src/services/__tests__/FollowStore.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export interface Candidate { userName: string; name?: string; keyword?: string; }`
  - `enqueue(userName: string, meta?: { name?: string; keyword?: string }): void`
  - `peek(n: number): Candidate[]`
  - `dequeue(n: number): Candidate[]`
  - `followedCount(): number`
  - `has`, `add`, `isQueued`, `queueSize`, `getLastRun`, `setLastRun`, `load`, `save` unchanged in signature.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/__tests__/FollowStore.test.ts`:

```ts
import { Candidate } from "../FollowStore";

test("loads a queue mixing bare strings and candidate objects", () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({
      followed: [],
      queue: ["alice", { userName: "bob", name: "Bob", keyword: "AI" }],
      lastRun: null,
    })
  );
  const store = new FollowStore(file);
  store.load();
  assert.equal(store.queueSize(), 2);
  const peeked = store.peek(2);
  assert.deepEqual(peeked[0], { userName: "alice" });
  assert.deepEqual(peeked[1], { userName: "bob", name: "Bob", keyword: "AI" });
});

test("enqueue stores metadata and round-trips through save/load", () => {
  const file = tmpFile();
  const store = new FollowStore(file);
  store.load();
  store.enqueue("carol", { name: "Carol", keyword: "crypto" });
  store.save();

  const reloaded = new FollowStore(file);
  reloaded.load();
  assert.deepEqual(reloaded.dequeue(1), [
    { userName: "carol", name: "Carol", keyword: "crypto" },
  ]);
});

test("dequeue returns candidate objects and removes them", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  store.enqueue("alice");
  store.enqueue("bob", { name: "Bob" });
  const taken = store.dequeue(1);
  assert.deepEqual(taken, [{ userName: "alice" }]);
  assert.equal(store.queueSize(), 1);
});

test("dedupe is by lowercased userName across string and object forms", () => {
  const file = tmpFile();
  fs.writeFileSync(
    file,
    JSON.stringify({ followed: [], queue: ["Alice"], lastRun: null })
  );
  const store = new FollowStore(file);
  store.load();
  store.enqueue("alice", { name: "A" }); // already queued as "Alice"
  assert.equal(store.queueSize(), 1);
});

test("followedCount reflects adds", () => {
  const store = new FollowStore(tmpFile());
  store.load();
  assert.equal(store.followedCount(), 0);
  store.add("alice");
  store.add("Alice"); // case-insensitive, same person
  store.add("bob");
  assert.equal(store.followedCount(), 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Candidate` not exported / `peek` returns strings not objects / `followedCount` undefined.

- [ ] **Step 3: Implement the changes**

Rewrite `src/services/FollowStore.ts` to:

```ts
import * as fs from "fs";
import * as path from "path";

export interface Candidate {
  userName: string;
  name?: string;
  keyword?: string;
}

interface FollowStoreData {
  followed: string[];
  queue: Array<string | Candidate>;
  lastRun: string | null;
}

function normalizeCandidate(item: string | Candidate): Candidate | null {
  if (typeof item === "string") return { userName: item };
  if (item && typeof item.userName === "string") return item;
  return null; // malformed entry — skip, don't crash
}

export class FollowStore {
  private followed = new Set<string>();
  /** Pending candidates to follow, in FIFO order. Deduped via queuedKeys. */
  private queue: Candidate[] = [];
  private queuedKeys = new Set<string>();
  private lastRun: Date | null = null;

  constructor(private readonly filePath: string) {}

  load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as FollowStoreData;
      this.followed = new Set((data.followed ?? []).map((u) => u.toLowerCase()));
      this.queue = (data.queue ?? [])
        .map(normalizeCandidate)
        .filter((c): c is Candidate => c !== null);
      this.queuedKeys = new Set(this.queue.map((c) => c.userName.toLowerCase()));
      this.lastRun = data.lastRun ? new Date(data.lastRun) : null;
    } catch {
      this.followed = new Set();
      this.queue = [];
      this.queuedKeys = new Set();
      this.lastRun = null;
    }
  }

  has(username: string): boolean {
    return this.followed.has(username.toLowerCase());
  }

  add(username: string): void {
    this.followed.add(username.toLowerCase());
  }

  followedCount(): number {
    return this.followed.size;
  }

  /** Queue a candidate to follow later. Skips users already followed or already queued. */
  enqueue(username: string, meta?: { name?: string; keyword?: string }): void {
    const key = username.toLowerCase();
    if (this.followed.has(key) || this.queuedKeys.has(key)) return;
    this.queue.push({ userName: username, ...meta });
    this.queuedKeys.add(key);
  }

  isQueued(username: string): boolean {
    return this.queuedKeys.has(username.toLowerCase());
  }

  queueSize(): number {
    return this.queue.length;
  }

  /** Return up to `n` queued candidates in FIFO order WITHOUT removing them. */
  peek(n: number): Candidate[] {
    return this.queue.slice(0, n);
  }

  /** Remove and return up to `n` queued candidates in FIFO order. */
  dequeue(n: number): Candidate[] {
    const taken = this.queue.splice(0, n);
    for (const c of taken) this.queuedKeys.delete(c.userName.toLowerCase());
    return taken;
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
      queue: [...this.queue],
      lastRun: this.lastRun ? this.lastRun.toISOString() : null,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: The 5 new FollowStore tests pass. NOTE: existing `AutoFollowRunner` tests will now FAIL to compile/pass because `peek`/`dequeue` return `Candidate[]` (Task 2 fixes those). If the runner tests fail here, that is expected and Task 2 resolves it — but the FollowStore tests themselves must pass and `FollowStore.ts` must type-check. Confirm the 5 FollowStore tests pass by name.

Run the FollowStore tests in isolation to confirm:
`node --require ts-node/register/transpile-only --test src/services/__tests__/FollowStore.test.ts`
Expected: all FollowStore tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/FollowStore.ts src/services/__tests__/FollowStore.test.ts
git commit -m "feat: carry name/keyword metadata on queue candidates

Queue entries become {userName, name?, keyword?} instead of bare strings,
so a later run can report who was followed and which keyword surfaced
them. Load normalizes old bare-string entries to candidates, so the
existing on-disk queue keeps working. peek/dequeue now return Candidate
objects and a followedCount() accessor is added for cycle reporting."
```

---

### Task 2: AutoFollowRunner enriched summary

**Files:**
- Modify: `src/services/AutoFollowRunner.ts`
- Test: `src/services/__tests__/AutoFollowRunner.test.ts`

**Interfaces:**
- Consumes: `FollowStore` with `Candidate`, `peek/dequeue: Candidate[]`, `followedCount()`, `enqueue(userName, meta?)` (Task 1).
- Produces: `FollowedCandidate`, enriched `CycleSummary` (see Type reference). `runCycle(): Promise<CycleSummary>`.

- [ ] **Step 1: Update existing tests + add new ones**

The existing tests assert `summary.followed.length` and
`follower.followed` (usernames the fake follower recorded). `follower.followed`
stays a `string[]` (the follower still takes a username). But `summary.followed`
is now `FollowedCandidate[]`, so assertions reading `summary.followed` as
strings must change to read `.userName`.

In `src/services/__tests__/AutoFollowRunner.test.ts`, update the first test's
final assertions from any string-based checks on `summary.followed` to:

```ts
  assert.deepEqual(follower.followed.sort(), ["alice", "bob", "carol"]);
  assert.equal(summary.followed.length, 3);
  assert.deepEqual(
    summary.followed.map((f) => f.userName).sort(),
    ["alice", "bob", "carol"]
  );
```

Then append these new tests (put them after the existing tests):

```ts
test("summary carries timing, before/after counts, and per-followed metadata", async () => {
  const search = fakeSearch({
    kw1: [
      { author: { userName: "alice", name: "Alice A" } },
      { author: { userName: "bob", name: "Bob B" } },
    ],
  });
  const follower = recordingFollower();
  let t = 1000;
  const runner = new AutoFollowRunner(search, tmpStore(), follower, {
    keywords: ["kw1", "kw2"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: false,
    delayMs: () => 0,
    now: () => new Date(t++), // advances 1ms per call
    pickKeywords: scriptedPicker([["kw1"]]),
  });

  const summary = await runner.runCycle();

  assert.equal(summary.dryRun, false);
  assert.equal(summary.followedCountBefore, 0);
  assert.equal(summary.followedCountAfter, 2);
  assert.equal(summary.addedCount, 2);
  assert.ok(summary.durationMs >= 0);
  assert.equal(typeof summary.startedAt, "string");
  assert.equal(typeof summary.finishedAt, "string");
  const alice = summary.followed.find((f) => f.userName === "alice")!;
  assert.equal(alice.name, "Alice A");
  assert.equal(alice.url, "https://x.com/alice");
  assert.equal(alice.keyword, "kw1");
});

test("dry-run reports would-follow candidates with addedCount 0 and no queue consumption", async () => {
  const store = tmpStore();
  const search = fakeSearch({
    kw1: [{ author: { userName: "alice", name: "Alice" } }],
  });
  const follower = recordingFollower();
  const runner = new AutoFollowRunner(search, store, follower, {
    keywords: ["kw1", "kw2"],
    queryType: "Latest",
    perKeyword: 30,
    keywordsPerCycle: 1,
    maxPerRun: 10,
    dryRun: true,
    delayMs: () => 0,
    pickKeywords: scriptedPicker([["kw1"]]),
  });

  const summary = await runner.runCycle();

  assert.equal(summary.dryRun, true);
  assert.equal(summary.addedCount, 0);
  assert.equal(summary.followedCountBefore, 0);
  assert.equal(summary.followedCountAfter, 0);
  assert.equal(follower.followed.length, 0); // nobody actually followed
  assert.equal(store.queueSize(), 1); // candidate still queued (peek, not dequeue)
  assert.equal(summary.followed[0].userName, "alice");
  assert.equal(summary.followed[0].url, "https://x.com/alice");
  assert.equal(summary.followed[0].keyword, "kw1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — new summary fields (`followedCountBefore`, `addedCount`, `startedAt`, per-followed `.url`/`.keyword`) don't exist yet; `summary.followed` isn't `FollowedCandidate[]`.

- [ ] **Step 3: Implement the changes**

In `src/services/AutoFollowRunner.ts`:

Replace the `CycleSummary` interface with:

```ts
export interface FollowedCandidate {
  userName: string;
  name?: string;
  url: string;
  keyword?: string;
}

export interface CycleSummary {
  /** ISO timestamp when the cycle started. */
  startedAt: string;
  /** ISO timestamp when the cycle finished. */
  finishedAt: string;
  /** Wall-clock cycle duration in ms. */
  durationMs: number;
  /** Tweets scanned across all searches this cycle. */
  scanned: number;
  /** Candidates queued this cycle (newly enqueued). */
  queued: number;
  /** followed-set size before draining. */
  followedCountBefore: number;
  /** followed-set size after draining. */
  followedCountAfter: number;
  /** Newly followed this cycle (real follows only; 0 in dry-run). */
  addedCount: number;
  /** Followed (or, in dry-run, would-follow) candidates with metadata. */
  followed: FollowedCandidate[];
  dryRun: boolean;
}
```

Replace `runCycle()` with:

```ts
  async runCycle(): Promise<CycleSummary> {
    const started = this.now();
    const followedCountBefore = this.store.followedCount();
    const fill = await this.fillQueue();
    const followed = await this.drainQueue();
    const followedCountAfter = this.store.followedCount();
    const finished = this.now();
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
      followed,
      dryRun: this.options.dryRun,
    };
  }
```

In `fillQueue()`, change the enqueue call to pass metadata. Find:

```ts
            const before = this.store.queueSize();
            this.store.enqueue(userName); // skips already-followed / already-queued
            if (this.store.queueSize() > before) queued++;
```

Replace with:

```ts
            const before = this.store.queueSize();
            this.store.enqueue(userName, { name: tweet.author?.name, keyword });
            if (this.store.queueSize() > before) queued++;
```

Replace `drainQueue()`'s signature and body to return `FollowedCandidate[]`:

```ts
  private async drainQueue(): Promise<FollowedCandidate[]> {
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
      return targets.map(toCandidate);
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
    return followed;
  }
```

Note: `fillQueue()` already has `keyword` in scope (the `for (const keyword of batch)` loop). The `AuthoredTweet` interface already has `author?: { userName: string; name: string }`, so `tweet.author?.name` is available.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all AutoFollowRunner tests (updated + 2 new) and all FollowStore tests pass. Full suite green.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/AutoFollowRunner.ts src/services/__tests__/AutoFollowRunner.test.ts
git commit -m "feat: enrich cycle summary with timing, counts, and metadata

runCycle() now returns startedAt/finishedAt/durationMs, followed-count
before/after, addedCount, and a followed[] of {userName,name,url,keyword}
so a run can be reported in full. Metadata flows from the search tweet
(author name) and the sampled keyword through enqueue into the summary.
Dry-run reports would-follow candidates with addedCount 0 and unchanged
counts."
```

---

### Task 3: JSONL logging in the loop + follow-audit command + docs

**Files:**
- Modify: `src/examples/auto-follow.ts`
- Create: `src/examples/follow-audit.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `CycleSummary` from `AutoFollowRunner` (Task 2); `FollowStore.followedCount()` (Task 1); `UserService.getUserInfo(userName).following` (existing); `loadConfig()` (existing, returns `{ apiKey }`); `TwitterClient` (existing).
- Produces: `pnpm follow-audit`; JSONL at `output/auto-follow-log.jsonl`.

- [ ] **Step 1: Add JSONL append to the loop**

In `src/examples/auto-follow.ts`, add imports at the top (after the existing imports):

```ts
import * as fs from "fs";
import * as path from "path";
```

Add this helper above `main()`:

```ts
const LOG_PATH = path.join(process.cwd(), "output", "auto-follow-log.jsonl");

function appendLog(record: unknown): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    // A lost log line must never stop the follow loop.
    console.error("Failed to write log:", err instanceof Error ? err.message : String(err));
  }
}
```

In the cycle loop, after the `console.log("Cycle done — ...")` line, add:

```ts
      appendLog({ type: "cycle", ...summary });
```

so the block reads:

```ts
      const summary = await runner.runCycle();
      console.log(
        `Cycle done — scanned ${summary.scanned}, ` +
          `queued ${summary.queued}, followed ${summary.followed.length}`
      );
      appendLog({ type: "cycle", ...summary });
```

- [ ] **Step 2: Create the follow-audit script**

Create `src/examples/follow-audit.ts`:

```ts
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { UserService } from "../services/UserService";
import { FollowStore } from "../services/FollowStore";
import * as fs from "fs";
import * as path from "path";

/**
 * Manual reference check: look up the account's ACTUAL following count via the
 * read API and append it, next to the tool's local followed-count, to the
 * auto-follow JSONL log. The two won't match exactly (you also follow/unfollow
 * by hand) — an approximate match confirms follows are landing.
 *
 * Run occasionally (e.g. once or twice a day):  pnpm follow-audit
 */
async function main() {
  const xUser = process.env["X_USER"];
  if (!xUser) {
    console.error("Missing X_USER — set it in .env to audit that account's following count.");
    process.exit(1);
  }

  const { apiKey } = loadConfig();
  const users = new UserService(new TwitterClient(apiKey));
  const info = await users.getUserInfo(xUser);

  const statePath = path.join(process.cwd(), ".auth", "auto-follow-state.json");
  const store = new FollowStore(statePath);
  store.load();

  const record = {
    type: "audit",
    at: new Date().toISOString(),
    account: xUser,
    localFollowedCount: store.followedCount(),
    actualFollowingCount: info.following,
    note: "reference only — includes manual follows/unfollows",
  };

  const logPath = path.join(process.cwd(), "output", "auto-follow-log.jsonl");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(record) + "\n", "utf8");

  console.log(
    `Audit for @${xUser}: local=${record.localFollowedCount} ` +
      `actual=${record.actualFollowingCount} (appended to ${logPath})`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

Note: `TwitterClient` implements the read client `UserService` needs. Confirm the constructor is `new TwitterClient(apiKey)` by checking `src/examples/user-profile.ts` (the existing user example) and mirror exactly how it builds the client + `UserService`.

- [ ] **Step 3: Add the pnpm script**

In `package.json` `"scripts"`, add after the `"import-session"` line:

```json
    "follow-audit": "ts-node src/examples/follow-audit.ts"
```

(Keep JSON valid — preceding line gets a trailing comma.)

- [ ] **Step 4: Update the README**

In `README.md`, at the end of the Auto-Follow section (after the "Follow
history and the pending-candidate queue..." paragraph), add:

````markdown
Each cycle appends a JSON line to `output/auto-follow-log.jsonl` (git-ignored)
recording start/end time, duration, tweets scanned, candidates queued, the
followed-count before and after, how many were newly followed, and for each
followed account its `userName`, display `name`, profile `url`, and the
`keyword` that surfaced them. Dry-run cycles are logged too (`addedCount` 0).

To cross-check that follows are actually landing, run occasionally:

```bash
pnpm follow-audit
```

It looks up the account's real following count via the read API and appends an
`{"type":"audit",...}` line with both that number and the tool's local tally.
The two won't match exactly (you also follow/unfollow by hand); an approximate
match means it's working. Requires `X_USER` and `TWITTERAPI_IO_KEY`.
````

- [ ] **Step 5: Type-check and run the suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; all tests pass (the scripts have no tests but must compile).

- [ ] **Step 6: Smoke-check the audit guard path**

Run: `env -u X_USER pnpm follow-audit`
Expected: exits non-zero with "Missing X_USER — ..." and no API call / no file write.

- [ ] **Step 7: Commit**

```bash
git add src/examples/auto-follow.ts src/examples/follow-audit.ts package.json README.md
git commit -m "feat: log each cycle to JSONL and add follow-audit command

The auto-follow loop now appends a {type:'cycle',...} line per cycle to
output/auto-follow-log.jsonl with timing, before/after follow counts, and
per-followed userName/name/url/keyword; a failed write is logged but never
stops the loop. New follow-audit command appends a {type:'audit',...} line
with the account's actual following count (read API) next to the local
tally, as a reference cross-check. README documents both."
```

---

## Self-Review

**1. Spec coverage:**
- Queue candidate metadata, backward-compatible normalization → Task 1 ✅
- `Candidate` type, `enqueue(userName, meta?)`, `peek/dequeue: Candidate[]`, `followedCount()` → Task 1 ✅
- Enriched `CycleSummary` (timing, before/after, addedCount, followed metadata) → Task 2 ✅
- `FollowedCandidate` with `url: https://x.com/${userName}` → Task 2 ✅
- Metadata flows search author name + keyword → enqueue → summary → Task 2 ✅
- Dry-run: addedCount 0, equal counts, no queue consumption → Task 2 test ✅
- JSONL append in loop, `type:"cycle"`, non-fatal on failure → Task 3 ✅
- `follow-audit` script, read-only (loadConfig apiKey + X_USER env), `type:"audit"` record, missing X_USER exit 1 → Task 3 ✅
- package.json script + README → Task 3 ✅

**2. Placeholder scan:** No TBD/TODO; all code shown in full. The one directive to "check user-profile.ts and mirror the client construction" is a concrete verification against an existing file, not a placeholder — the client construction is `new TwitterClient(apiKey)` and `new UserService(client)` per the spec's known API. ✅

**3. Type consistency:** `Candidate {userName,name?,keyword?}` (Task 1) and `FollowedCandidate {userName,name?,url,keyword?}` (Task 2) are distinct and used consistently. `peek`/`dequeue` return `Candidate[]` in Task 1 and are consumed as such in Task 2's `drainQueue`. `followedCount()` defined in Task 1, used in Task 2 and Task 3. `CycleSummary` fields match between Task 2 definition and Task 3's `appendLog({type:"cycle", ...summary})`. `UserInfo.following` (existing) used in Task 3. ✅
