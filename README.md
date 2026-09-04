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

### X Article → blog post

Turns one of my X long-form articles into a post for the blog at jungho.dev,
ready to commit to the content repo.

```bash
pnpm example:x-article -- <tweet-id-or-url> --list          # preview: title, summary, first 40 lines
pnpm example:x-article -- <tweet-id-or-url> --slug rfq-deep-dive
pnpm example:x-article -- <tweet-id-or-url> --slug rfq-deep-dive --out ~/code/blog/content/posts
```

The id is the **tweet carrying the article**, not the article id — that is what
`/twitter/article` takes. Output is `<out>/<slug>/index.md` plus the article's
images downloaded alongside it, because the blog colocates a post's images with
the post. `tags:` is left empty on purpose: fill it in before committing.

Two things the conversion handles that a naive one does not:

- Emphasis next to Korean text. CommonMark will not close `**` against a letter
  on both sides, and Korean runs a word straight into its particle, so
  `**14.5%**입니다` renders the asterisks literally. Those ranges become
  `<strong>` instead.
- Markdown syntax inside prose. An article wrote a range as `40~65%`, which GFM
  read as strikethrough. Block text is escaped before styling.

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
| `unhealthyAfterZeroCycles` | Consecutive attempted-but-followed-nothing cycles before a loud UNHEALTHY warning (default 2). |
| `allowedVerified` | Verification tiers to follow: any of `blue` (X Premium), `legacy`, `business`, `government`. Default all four (follow any verified account, skip unverified). Empty array `[]` turns the filter off (follow everyone). |

The tool reads each search author's verification signals and follows only
accounts whose tier is in `allowedVerified`. Set it to `["blue"]` to follow only
X Premium accounts, or `[]` to disable the filter. Each cycle's JSONL record
includes a `skippedUnverified` count and the matched tiers on every followed
account.

For the full config-field reference (including `queryType`, `perKeyword`, and
`dryRun` semantics) and everything about running it unattended — systemd
services, keeping the WSL VM alive, candidate-depletion handling, log formats,
and troubleshooting — see the **[Auto-Follow Operations Guide](docs/auto-follow-operations.md)**.

CLI flags (`--interval <min>`, `--keywords-per-cycle <n>`, `--per-keyword <n>`,
`--max <n>`, `--dry-run` / `--no-dry-run`) take effect only for fields you
remove from the JSON. This means you can never *accidentally* leave dry-run with
a stray flag — disabling it is a deliberate edit to `config/auto-follow.json`.

Follow history and the pending-candidate queue are stored under `.auth/`
(git-ignored) alongside the browser session, so restarts resume the same queue
without re-following or re-searching.

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
