# twitterapi.io TypeScript Examples

TypeScript examples for the [twitterapi.io](https://twitterapi.io) REST API — query Twitter/X data and perform authenticated actions using a single API key, no OAuth required.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in TWITTERAPI_IO_KEY (and X_* vars for write operations)
```

## Running Examples

```bash
pnpm example:user           # user profile + followers
pnpm example:search         # advanced tweet search
pnpm example:trends         # worldwide + US trends
pnpm example:write          # login → create tweet → delete it (requires X_* vars)
```

## Interactive CLI

```bash
pnpm cli
```

## Project Structure

```
src/
  client/      — HTTP client layer (IHttpClient, HttpClient, TwitterClient)
  services/    — domain services (UserService, TweetService, WriteService, TrendService)
  examples/    — standalone runnable scripts
  cli/         — interactive menu + handlers
  config.ts    — environment variable loader
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
