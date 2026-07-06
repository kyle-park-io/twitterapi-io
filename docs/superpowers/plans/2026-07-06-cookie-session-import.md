# Cookie Session Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the auto-follow feature reuse an X session imported from the user's real Chrome (via the `auth_token`/`ct0` cookies), so Playwright never runs the automated login that X blocks.

**Architecture:** A pure function `buildStorageState(authToken, ct0, now)` assembles a Playwright `storageState` object from the two cookies. A thin `examples/import-session.ts` script reads the cookies from env/CLI, writes the storageState to `.auth/x-session.json`, and self-verifies by loading it into a headless browser and checking the account-switcher testid. `BrowserFollowService` is unchanged — it already loads and validates `storageState` when the file exists.

**Tech Stack:** TypeScript (CommonJS, TS 6), ts-node, Playwright (chromium), `node --test` via `ts-node/register/transpile-only`.

## Global Constraints

- Test runner: `node --require ts-node/register/transpile-only --test "src/**/*.test.ts"` (i.e. `pnpm test`). Type-check separately with `pnpm exec tsc --noEmit`.
- Tests use `import { test } from "node:test"` and `import assert from "node:assert/strict"`; unit tests live in `src/services/__tests__/*.test.ts` and import modules with relative `../` paths.
- `examples/` scripts have no tests (I/O shells); only pure logic is unit-tested.
- Cookie values are session credentials: never commit, never log their values. `.env` and `.auth/` are already git-ignored.
- Commit convention: Conventional Commits, no `Co-Authored-By` trailer, and every commit has a body (what/why), not just a subject.
- Cookie facts (copied verbatim into `buildStorageState`): both cookies use `domain: ".x.com"`, `path: "/"`, `secure: true`. `auth_token`: `httpOnly: true`, `sameSite: "None"`. `ct0`: `httpOnly: false`, `sameSite: "Lax"`. Both get `expires` ≈ now + 1 year (in **seconds** since epoch, per Playwright's storageState format).
- Login-valid signal (must match `BrowserFollowService`): the `SideNav_AccountSwitcher_Button` testid is visible on `x.com/home`.

---

### Task 1: `buildStorageState` pure function + unit tests

**Files:**
- Create: `src/services/SessionState.ts`
- Test: `src/services/__tests__/SessionState.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface StorageStateCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }
  export interface StorageState {
    cookies: StorageStateCookie[];
    origins: never[];
  }
  export function buildStorageState(
    authToken: string,
    ct0: string,
    now?: Date
  ): StorageState;
  ```
  `now` defaults to `new Date()`; `expires` is `Math.floor(now.getTime() / 1000) + 31_536_000` (one year in seconds).

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/SessionState.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStorageState } from "../SessionState";

const FIXED = new Date("2026-07-06T00:00:00Z");
const EXPECTED_EXPIRES = Math.floor(FIXED.getTime() / 1000) + 31_536_000;

test("builds a storageState with both cookies", () => {
  const state = buildStorageState("AUTHVAL", "CT0VAL", FIXED);
  assert.equal(state.cookies.length, 2);
  assert.deepEqual(state.origins, []);
});

test("auth_token cookie has the right shape", () => {
  const state = buildStorageState("AUTHVAL", "CT0VAL", FIXED);
  const auth = state.cookies.find((c) => c.name === "auth_token");
  assert.ok(auth, "auth_token cookie present");
  assert.equal(auth!.value, "AUTHVAL");
  assert.equal(auth!.domain, ".x.com");
  assert.equal(auth!.path, "/");
  assert.equal(auth!.httpOnly, true);
  assert.equal(auth!.secure, true);
  assert.equal(auth!.sameSite, "None");
  assert.equal(auth!.expires, EXPECTED_EXPIRES);
});

test("ct0 cookie has the right shape", () => {
  const state = buildStorageState("AUTHVAL", "CT0VAL", FIXED);
  const ct0 = state.cookies.find((c) => c.name === "ct0");
  assert.ok(ct0, "ct0 cookie present");
  assert.equal(ct0!.value, "CT0VAL");
  assert.equal(ct0!.domain, ".x.com");
  assert.equal(ct0!.path, "/");
  assert.equal(ct0!.httpOnly, false);
  assert.equal(ct0!.secure, true);
  assert.equal(ct0!.sameSite, "Lax");
  assert.equal(ct0!.expires, EXPECTED_EXPIRES);
});

test("defaults now to the current time when omitted", () => {
  const before = Math.floor(Date.now() / 1000) + 31_536_000;
  const state = buildStorageState("A", "C");
  const after = Math.floor(Date.now() / 1000) + 31_536_000;
  const auth = state.cookies.find((c) => c.name === "auth_token")!;
  assert.ok(auth.expires >= before && auth.expires <= after);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find module `../SessionState` (module not yet created).

- [ ] **Step 3: Write minimal implementation**

Create `src/services/SessionState.ts`:

```ts
export interface StorageStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface StorageState {
  cookies: StorageStateCookie[];
  origins: never[];
}

const ONE_YEAR_SECONDS = 31_536_000;

/**
 * Assemble a Playwright `storageState` object from the two cookies that make up
 * an X session: `auth_token` (auth) and `ct0` (CSRF). Copied from a real,
 * logged-in Chrome so Playwright can skip the automated login X blocks.
 */
export function buildStorageState(
  authToken: string,
  ct0: string,
  now: Date = new Date()
): StorageState {
  const expires = Math.floor(now.getTime() / 1000) + ONE_YEAR_SECONDS;
  return {
    cookies: [
      {
        name: "auth_token",
        value: authToken,
        domain: ".x.com",
        path: "/",
        expires,
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
      {
        name: "ct0",
        value: ct0,
        domain: ".x.com",
        path: "/",
        expires,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all 4 new tests pass, existing 18 still pass (22 total).

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/SessionState.ts src/services/__tests__/SessionState.test.ts
git commit -m "feat: add buildStorageState for cookie-based X sessions

Assemble a Playwright storageState object from the auth_token/ct0
cookies of a real logged-in Chrome, so the auto-follow browser can
reuse that session instead of running the automated login X blocks.
Pure function, unit-tested for cookie names, domain, and flags."
```

---

### Task 2: `import-session` script + wiring + docs

**Files:**
- Create: `src/examples/import-session.ts`
- Modify: `package.json` (scripts block)
- Modify: `.env.example`
- Modify: `README.md` (Auto-Follow section + env-var table)

**Interfaces:**
- Consumes: `buildStorageState` from `../services/SessionState`; `loadAutoFollowConfig` from `../config` (for `storageStatePath`).
- Produces: a runnable `pnpm import-session` command. No exported symbols.

- [ ] **Step 1: Write the script**

Create `src/examples/import-session.ts`:

```ts
import { loadAutoFollowConfig } from "../config";
import { buildStorageState } from "../services/SessionState";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

/**
 * One-time helper: import an X session from your real Chrome into the Playwright
 * storageState file the auto-follow browser reuses. X blocks automated logins
 * ("This browser or app may not be secure"), so instead of logging in via
 * Playwright, copy the session cookies from a browser that's already logged in.
 *
 * Get the cookies (in your normal Chrome, logged in to X):
 *   1. Open x.com, press F12.
 *   2. Application -> Cookies -> https://x.com
 *   3. Copy the `auth_token` value and the `ct0` value.
 *
 * Provide them via env (X_AUTH_TOKEN, X_CT0) or CLI:
 *   pnpm import-session -- --auth-token <v> --ct0 <v>
 */
function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const authToken = argValue(argv, "--auth-token") ?? process.env["X_AUTH_TOKEN"];
  const ct0 = argValue(argv, "--ct0") ?? process.env["X_CT0"];

  if (!authToken || !ct0) {
    console.error(
      "Missing cookies. Provide X_AUTH_TOKEN and X_CT0 (env or --auth-token/--ct0).\n" +
        "Copy them from Chrome: F12 -> Application -> Cookies -> https://x.com " +
        "(auth_token, ct0)."
    );
    process.exit(1);
  }

  const config = loadAutoFollowConfig(argv);
  const state = buildStorageState(authToken, ct0);

  fs.mkdirSync(path.dirname(config.storageStatePath), { recursive: true });
  fs.writeFileSync(config.storageStatePath, JSON.stringify(state, null, 2));
  console.log(`Session written to ${config.storageStatePath}`);

  // Self-verify: load the session headless and confirm we're logged in, using
  // the same signal BrowserFollowService uses.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: config.storageStatePath,
    });
    const page = await context.newPage();
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
    const loggedIn = await page
      .getByTestId("SideNav_AccountSwitcher_Button")
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (loggedIn) {
      console.log("✅ Session valid — you can now run: pnpm example:auto-follow");
    } else {
      console.error(
        "❌ Session not valid — the account switcher did not appear. " +
          "Re-copy auth_token and ct0 from a browser that's currently logged in to X."
      );
      await browser.close();
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the pnpm script**

In `package.json`, inside `"scripts"`, add after the `"save-session"` line:

```json
    "import-session": "ts-node src/examples/import-session.ts",
```

(Ensure the preceding line keeps its trailing comma and JSON stays valid.)

- [ ] **Step 3: Add env-var placeholders**

Append to `.env.example`:

```
# Auto-follow browser session (copy from a logged-in Chrome:
# F12 -> Application -> Cookies -> https://x.com)
X_AUTH_TOKEN=
X_CT0=
```

- [ ] **Step 4: Update the README**

In `README.md`, replace the current "One-time setup" block of the Auto-Follow section (the `npx playwright install` + `pnpm save-session` fenced block and the two paragraphs describing `save-session`) with:

````markdown
One-time setup — import your X session:

```bash
npx playwright install chromium
# Copy auth_token and ct0 from a logged-in Chrome (F12 -> Application ->
# Cookies -> https://x.com), put them in .env as X_AUTH_TOKEN / X_CT0, then:
pnpm import-session
```

X blocks automated logins ("This browser or app may not be secure"), so the
tool does **not** log in through Playwright. Instead, copy your existing X
session from a browser you're already logged in to. `import-session` writes the
session to `.auth/x-session.json` and verifies it by loading it headless and
checking you're signed in. Every later run reuses that session.

> The older `pnpm save-session` (hand-login in a Playwright window) is kept but
> **not recommended** — X flags the automated browser and refuses the login.
````

Then in the Environment Variables table, add these rows after the `X_TOTP` row:

```markdown
| `X_AUTH_TOKEN` | Auto-follow | X `auth_token` cookie (from a logged-in Chrome) |
| `X_CT0` | Auto-follow | X `ct0` cookie (from a logged-in Chrome) |
```

Also change the "Requires the `X_*` env vars (see below) for the browser login."
line at the end of the Auto-Follow section to:

```markdown
Requires `X_AUTH_TOKEN` / `X_CT0` (see below) for the imported browser session.
```

- [ ] **Step 5: Type-check and run the test suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; all 22 tests pass (the script has no tests but must compile).

- [ ] **Step 6: Verify the script's arg parsing without cookies**

Run: `pnpm import-session`
Expected: exits non-zero with the "Missing cookies" message (no browser launched). This confirms the guard path.

- [ ] **Step 7: Commit**

```bash
git add src/examples/import-session.ts package.json .env.example README.md
git commit -m "feat: add import-session for cookie-based X login

X blocks Playwright's automated login, so add a one-time import-session
script: it reads the auth_token/ct0 cookies from env or CLI, writes them
as a Playwright storageState to .auth/x-session.json, and self-verifies
headless. README now documents cookie import as the recommended path and
demotes save-session. No change to BrowserFollowService, which already
loads and validates the session file."
```

---

### Task 3: End-to-end manual verification (no code)

**Files:** none — this is the manual gate the whole change exists to pass.

This task is run **by the user with the real cookies**; the agent stops before it and hands off, because it needs the user's live X session cookies and performs a real follow.

- [ ] **Step 1:** User copies `auth_token` and `ct0` from a logged-in Chrome into `.env` (`X_AUTH_TOKEN`, `X_CT0`).
- [ ] **Step 2:** Run `pnpm import-session`. Expected: `✅ Session valid`. If `❌`, cookies are stale — re-copy.
- [ ] **Step 3:** Set `"dryRun": false` in `config/auto-follow.json` and lower `"maxPerRun"` to `1` for a single-follow smoke test.
- [ ] **Step 4:** Run `pnpm example:auto-follow`. Expected: one real follow completes; `Cycle done — scanned N, queued M, followed 1`.
- [ ] **Step 5:** Restore `config/auto-follow.json` to safe defaults (`maxPerRun: 25`, `dryRun: true`).
- [ ] **Step 6:** Update the `auto-follow-login-status` memory to record login is now verified via cookie import.

---

## Self-Review

**1. Spec coverage:**
- New `import-session.ts` reading env/CLI cookies → Task 2 ✅
- `buildStorageState` pure function + unit tests → Task 1 ✅
- storageState cookie shape (domain/flags/sameSite/expires) → Task 1 tests ✅
- Self-verify via `SideNav_AccountSwitcher_Button` → Task 2 script ✅
- `package.json` script, `.env.example`, README changes → Task 2 ✅
- `BrowserFollowService` unchanged → no task touches it ✅
- Error handling (missing cookies exit 1; verify-fail exit 1) → Task 2 script + Step 6 ✅
- Security (no logging cookie values) → script prints only path + ✅/❌, never values ✅
- E2E manual follow with dryRun:false → Task 3 ✅

**2. Placeholder scan:** No TBD/TODO; all code shown in full. ✅

**3. Type consistency:** `buildStorageState(authToken, ct0, now?)` signature and `StorageState`/`StorageStateCookie` types are identical in Task 1's Produces block, implementation, and Task 2's consumer. `config.storageStatePath` matches `AutoFollowConfig`. ✅
