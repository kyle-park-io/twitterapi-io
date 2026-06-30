# twitterapi.io TypeScript Example Project — Design Spec

**Date:** 2026-06-30

## Overview

A TypeScript project that demonstrates how to use the [twitterapi.io](https://twitterapi.io) REST API. It consists of three layers: a reusable client library, standalone example scripts, and an interactive CLI. All code follows SOLID principles.

---

## Project Structure

```
src/
  client/
    IHttpClient.ts          ← interface for HTTP operations (DIP)
    HttpClient.ts           ← fetch wrapper with retry + error handling
    TwitterClient.ts        ← sets x-api-key header and base URL
  services/
    UserService.ts          ← user profile, followers, following, search
    TweetService.ts         ← tweet lookup, advanced search, replies, quotes
    WriteService.ts         ← login, create/delete tweet, like, follow, DM
    TrendService.ts         ← trends by WOEID
  examples/
    user-profile.ts         ← fetch a user profile and follower list
    tweet-search.ts         ← advanced search with pagination
    write-actions.ts        ← login → create tweet → delete tweet
    trends.ts               ← global and US trends
  cli/
    menu.ts                 ← interactive menu entry point (readline)
    handlers/
      userHandlers.ts       ← CLI prompts + UserService calls
      tweetHandlers.ts      ← CLI prompts + TweetService calls
      writeHandlers.ts      ← CLI prompts + WriteService calls
  config.ts                 ← .env loader and validation
.env.example                ← environment variable template
```

---

## Architecture

### Dependency Direction

```
CLI (menu.ts / handlers)
Examples (examples/*.ts)
        ↓
Services (UserService, TweetService, WriteService, TrendService)
        ↓
TwitterClient → HttpClient
        ↓
twitterapi.io REST API
```

### SOLID Application

| Principle | How it is applied |
|---|---|
| **SRP** | `HttpClient` handles HTTP only; `TwitterClient` handles auth only; each Service owns one domain |
| **OCP** | New endpoints → new Service or new method; existing code untouched |
| **LSP** | `IHttpClient` interface lets any conforming implementation replace `HttpClient` |
| **ISP** | Read services (`UserService`, `TweetService`, `TrendService`) are separate from `WriteService`; callers depend only on what they use |
| **DIP** | Services receive `IHttpClient` via constructor injection; they never instantiate `HttpClient` directly |

---

## Key Components

### `IHttpClient` (interface)

```ts
interface IHttpClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
}
```

### `HttpClient`

- Wraps native `fetch`
- Exponential backoff retry on 429 and 5xx (max 3 attempts)
- On 401 → throws with message "Invalid API key or expired login cookies"
- On 402 → throws with message "Insufficient credits — top up at dashboard"
- On 400/422 → reads `detail` field from response body
- Never logs API keys, passwords, or `login_cookies`

### `TwitterClient`

- Extends / wraps `HttpClient`
- Injects `x-api-key` header from config
- Sets base URL `https://api.twitterapi.io`

### Services

**`UserService`**
- `getUserInfo(userName: string)`
- `getFollowers(userName: string, pageSize?: number)` — async generator, paginates via `has_next_page`
- `getFollowings(userName: string)`
- `searchUsers(query: string)`

**`TweetService`**
- `advancedSearch(query: string, queryType?: string)` — async generator
- `getLastTweets(userName: string)`
- `getReplies(tweetId: string)`
- `getQuotes(tweetId: string)`

**`WriteService`**
- `login()` — calls `/twitter/user_login_v2`, caches `login_cookies` in memory
- `createTweet(text: string, options?)` — `replyToTweetId`, `quoteTweetId`, `mediaIds`
- `deleteTweet(tweetId: string)`
- `likeTweet(tweetId: string)`
- `followUser(userId: string)`
- `unfollowUser(userId: string)`
- `sendDm(userId: string, text: string)`

**`TrendService`**
- `getTrends(woeid?: number, count?: number)`

### Cost Guard

Before paginating operations that could be expensive (e.g., `getFollowers` on a large account), the service prints an estimated cost and requires explicit confirmation if the estimate exceeds $1.00.

---

## Configuration

### `.env` variables

```env
# Required for all operations
TWITTERAPI_IO_KEY=

# Required for write operations only
X_USER=
X_EMAIL=
X_PASSWORD=
X_PROXY=
X_TOTP=          # optional — only if 2FA is enabled
```

### `config.ts` behavior

- Loads `.env` at startup via `dotenv`
- Validates `TWITTERAPI_IO_KEY` always
- Validates `X_USER`, `X_EMAIL`, `X_PASSWORD`, `X_PROXY` only when a write operation is attempted
- Throws a descriptive error if a required variable is missing
- Never exposes secret values in logs or error messages

---

## CLI Menu Structure

```
=== twitterapi.io CLI ===

1. User
   1-1. Get user profile
   1-2. List followers
   1-3. List followings
   1-4. Search users

2. Tweet
   2-1. Advanced tweet search
   2-2. User's recent tweets
   2-3. Tweet replies
   2-4. Trends

3. Write (requires login)
   3-1. Create tweet
   3-2. Delete tweet
   3-3. Like tweet
   3-4. Follow / Unfollow user
   3-5. Send DM

0. Exit
```

- Built with Node.js `readline` (no external CLI framework)
- Each menu item prompts for required parameters one at a time
- Write menu triggers `WriteService.login()` on first use; subsequent actions reuse cached `login_cookies`

---

## Example Scripts

Each file in `src/examples/` is self-contained and runnable with `npx ts-node`:

| File | What it demonstrates |
|---|---|
| `user-profile.ts` | Fetch profile, print follower count, list first page of followers |
| `tweet-search.ts` | Advanced search with date range + engagement filter, paginate all results |
| `write-actions.ts` | Full write flow: login → create tweet → delete it |
| `trends.ts` | Fetch worldwide and US trends |

---

## Error Handling Strategy

| Error | Behavior |
|---|---|
| 429 / 5xx | Retry with exponential backoff (1s, 2s, 4s), then throw |
| 401 | Throw with "Invalid API key or expired login cookies" |
| 402 | Throw with "Insufficient credits — top up at twitterapi.io/dashboard" |
| 400 / 422 | Throw with `detail` field from response |
| Missing env var | Throw at startup (or first write) with variable name |
| Cost > $1.00 | Print estimate and prompt user to confirm before proceeding |

---

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 20+
- **HTTP:** native `fetch` (Node 20 built-in)
- **Env:** `dotenv`
- **CLI input:** `readline` (built-in)
- **Package manager:** npm
- **Run examples:** `npx ts-node src/examples/user-profile.ts`
- **Run CLI:** `npx ts-node src/cli/menu.ts`

---

## Out of Scope

- Real-time monitoring (`/oapi/x_user_stream/*`) — requires a paid subscription, not covered in examples
- Webhook filter rules — server-side setup needed, out of scope for local examples
- Media upload — complex multipart flow, omitted to keep write examples focused
- Unit tests — examples project; not a production library
