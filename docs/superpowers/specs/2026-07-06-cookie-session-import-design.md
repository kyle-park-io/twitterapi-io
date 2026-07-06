# Cookie-based X session import — design

**Date:** 2026-07-06
**Status:** Approved

## Problem

The auto-follow feature drives a real Playwright (Chromium) browser to follow X
users. Following itself works — `BrowserFollowService.follow()` was verified
end-to-end via a real follow. The blocker is **login**: X detects the automated
Chromium and refuses to sign in, showing either "We've temporarily limited your
login" or **"Couldn't sign you in — This browser or app may not be secure."**
The same credentials log in fine from the user's normal Chrome. So the barrier
is automation detection at the login step, not the credentials and not the
follow logic.

Key observation: only the *login* is blocked. Once a valid session exists,
Playwright drives x.com normally (proven by the successful MCP follow). So the
fix is to skip automated login entirely and reuse a session obtained from a real
browser.

## Approach

Extract the two cookies that constitute an X session from the user's real,
already-logged-in Chrome, and write them into the Playwright `storageState`
file that `BrowserFollowService` already knows how to load. No automated login
ever runs.

- `auth_token` — the authentication cookie
- `ct0` — the CSRF token cookie

`BrowserFollowService.login()` **already** supports this: if
`config.storageStatePath` exists, it loads the context with `storageState`,
opens `x.com/home`, and confirms login via the `SideNav_AccountSwitcher_Button`
testid; only if that check fails does it fall back to `performLogin()`. So a
valid session file makes the automated-login path unreachable. **No change to
`BrowserFollowService` is needed.**

### Rejected alternatives

- **Stealth-patched automated login** (`navigator.webdriver` hiding, etc.): X's
  detection also uses TLS fingerprinting and behavioral analysis; brittle and
  raises account-ban risk. Rejected.
- **CDP attach to the user's real Chrome** (`connectOverCDP`): works, but
  requires launching Chrome in debug mode on every run. More operational
  friction than a one-time cookie import. Rejected as the default.

## Components

### `src/examples/import-session.ts` (new)

Single-purpose script:

1. Read `auth_token` and `ct0` from env (`X_AUTH_TOKEN`, `X_CT0`) or CLI args
   (`--auth-token <v> --ct0 <v>`). Fail with a clear message if either is
   missing.
2. Assemble a Playwright `storageState` object:
   ```json
   {
     "cookies": [
       { "name": "auth_token", "value": "…", "domain": ".x.com", "path": "/",
         "httpOnly": true, "secure": true, "sameSite": "None",
         "expires": <now + ~1y> },
       { "name": "ct0", "value": "…", "domain": ".x.com", "path": "/",
         "httpOnly": false, "secure": true, "sameSite": "Lax",
         "expires": <now + ~1y> }
     ],
     "origins": []
   }
   ```
3. Write it to `config.storageStatePath` (`.auth/x-session.json`), creating
   `.auth/` if needed.
4. **Self-verify:** launch a headless context with the saved `storageState`,
   go to `x.com/home`, and check the `SideNav_AccountSwitcher_Button` testid.
   Print `✅ Session valid` or `❌ Session not valid — re-copy the cookies`.

The verification reuses the exact same signal `BrowserFollowService` uses, so a
pass here guarantees the follow run will accept the session.

### Getting the cookies (documented, manual, one-time)

In the user's normal Chrome, logged in to X:
1. Open x.com, press F12.
2. Application → Cookies → `https://x.com`.
3. Copy the `auth_token` value and the `ct0` value.
4. Put them in `.env` as `X_AUTH_TOKEN=` / `X_CT0=`, or pass as CLI args.

### Changed files

- `package.json` — add `"import-session": "ts-node src/examples/import-session.ts"`.
- `README.md` — make `import-session` the recommended session-setup path;
  demote `save-session` (automated-browser login is blocked by X); document
  `X_AUTH_TOKEN` / `X_CT0`.
- `.env.example` — add `X_AUTH_TOKEN` / `X_CT0` entries.
- `BrowserFollowService.ts` — **no change**.

## Data flow

```
user's Chrome (logged in)
   └─ copy auth_token, ct0
        └─ .env (X_AUTH_TOKEN, X_CT0)
             └─ pnpm import-session
                  ├─ writes .auth/x-session.json (Playwright storageState)
                  └─ self-verify: headless x.com/home → account-switcher visible?
                       └─ ✅ → pnpm example:auto-follow (dryRun:false)
                                └─ BrowserFollowService.login() loads storageState,
                                   skips performLogin, follow() runs
```

## Error handling

- Missing `X_AUTH_TOKEN` or `X_CT0` → exit 1 with a message pointing at the
  copy-cookie instructions.
- Self-verify fails (account switcher not visible) → print `❌`, explain the
  cookies are likely stale/wrong, exit 1. The (bad) file is still written so the
  user can inspect it, but the non-zero exit signals failure.
- All existing `follow()` / queue error handling is unchanged.

## Testing

- The script is thin I/O glue over Playwright; its core logic is "assemble the
  storageState object from two values." Extract that assembly into a pure
  function `buildStorageState(authToken, ct0, now)` and unit-test it: correct
  cookie names, `.x.com` domain, `httpOnly`/`secure`/`sameSite` flags, and
  `origins: []`. Keep the file-write and browser-verify as the untested I/O
  shell (consistent with the other `examples/` scripts, which have no tests).
- End-to-end verification is manual and is the whole point of this change: run
  `import-session`, confirm `✅`, then one real follow with `dryRun:false`.

## Security notes

`auth_token` is a full session credential — anyone with it can act as the
account. It lives only in `.env` and `.auth/x-session.json`, both already
git-ignored. Never commit or log the values. `import-session` must not print the
cookie values (only a masked/length confirmation, if anything).
