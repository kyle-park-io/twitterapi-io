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
