# twitterapi.io TypeScript Examples

TypeScript examples for the [twitterapi.io](https://twitterapi.io) REST API — query Twitter/X data and perform authenticated actions using a single API key, no OAuth required.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in TWITTERAPI_IO_KEY (and X_* vars for write operations)
```

## Running Examples

### User Profile

```bash
pnpm example:user                                        # default: 0xMantleKR
pnpm example:user -- <username>
pnpm example:user -- <username> --output output/profile.json
```

### Tweet Search

```bash
pnpm example:search                                      # default: from:0xMantleKR since:2025-01-01
pnpm example:search -- "<query>"
pnpm example:search -- "<query>" --sort Latest           # Twitter chronological (default)
pnpm example:search -- "<query>" --sort Top              # Twitter algorithm
pnpm example:search -- "<query>" --sort-by likes         # client-side sort: likes|views|retweets|replies|bookmarks
pnpm example:search -- "<query>" --max 100               # fetch up to 100 tweets (default: 20)
pnpm example:search -- "<query>" --max 100 --sort-by views --output output/tweets.json
```

### Trends

```bash
pnpm example:trends
pnpm example:trends -- --output output/trends.json
```

### Write Actions (requires X_* env vars)

```bash
pnpm example:write          # login → create tweet → delete it
```

### Auto-Follow (keyword search → browser follow via Playwright)

Each cycle samples a few keywords from `config/auto-follow.json` at random,
searches them, and queues the tweet authors as candidates; then it follows up
to `maxPerRun` of them through a real browser session (Playwright). Candidates
beyond the per-cycle cap stay queued for the next cycle, so search results are
never wasted and the search API is hit only enough to keep the queue full.

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

Run:

```bash
pnpm example:auto-follow                 # dry-run (default): reports targets, follows nobody
```

Config lives in `config/auto-follow.json`, and a value set there **wins over the
matching CLI flag** — flags only fill in fields the JSON omits. The shipped
config sets every tunable field, so tune behavior by editing the JSON:

| Field | Effect |
|---|---|
| `dryRun` | `true` (default) reports targets without following. **Set to `false` to actually follow.** |
| `intervalMinutes` | Minutes between cycles (default 60). |
| `keywordsPerCycle` | Keywords sampled per search batch (default 3). |
| `perKeyword` | Max tweets scanned per sampled keyword (default 30). |
| `maxPerRun` | Max follows per cycle, and the queue top-up target (default 25). |

CLI flags (`--interval <min>`, `--keywords-per-cycle <n>`, `--per-keyword <n>`,
`--max <n>`, `--dry-run` / `--no-dry-run`) take effect only for fields you
remove from the JSON. This means you can never *accidentally* leave dry-run with
a stray flag — disabling it is a deliberate edit to `config/auto-follow.json`.

Follow history and the pending-candidate queue are stored under `.auth/`
(git-ignored) alongside the browser session, so restarts resume the same queue
without re-following or re-searching.

Requires `X_AUTH_TOKEN` / `X_CT0` (see below) for the imported browser session.

## Interactive CLI

```bash
pnpm cli
```

Menus: User / Tweet (search, recent, sort, replies, trends) / Write (login, tweet, like, follow, DM)

## Output

Results can be saved as JSON via `--output <path>`. The `output/` directory is git-ignored.

## Project Structure

```
src/
  client/      — HTTP client layer (IHttpClient, HttpClient, TwitterClient)
  services/    — domain services (UserService, TweetService, WriteService, TrendService)
  examples/    — standalone runnable scripts
  cli/         — interactive menu + handlers
  config.ts    — environment variable loader
output/        — JSON output files (git-ignored)
```

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `TWITTERAPI_IO_KEY` | Always | twitterapi.io API key |
| `X_USER` | Write only | Twitter username |
| `X_EMAIL` | Write only | Twitter email |
| `X_PASSWORD` | Write only | Twitter password |
| `X_PROXY` | Write only | HTTP/SOCKS proxy URL |
| `X_TOTP` | Write only (optional) | 2FA secret |
| `X_AUTH_TOKEN` | Auto-follow | X `auth_token` cookie (from a logged-in Chrome) |
| `X_CT0` | Auto-follow | X `ct0` cookie (from a logged-in Chrome) |
