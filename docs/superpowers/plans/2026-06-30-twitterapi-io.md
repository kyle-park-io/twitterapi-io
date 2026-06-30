# twitterapi.io TypeScript Example Project — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript example project that demonstrates the twitterapi.io REST API via a reusable client library, standalone example scripts, and an interactive CLI.

**Architecture:** Services depend on `IHttpClient` via constructor injection (DIP). `TwitterClient` wraps `HttpClient` adding auth. CLI and example scripts sit on top of services only — never touching HTTP directly.

**Tech Stack:** TypeScript (strict), Node.js 20+, native `fetch`, `dotenv`, `ts-node`, `readline` (built-in)

## Global Constraints

- TypeScript strict mode (`"strict": true`) — no `any` unless unavoidable
- Node.js 20+ only — use native `fetch`, no `node-fetch` or `axios`
- No external CLI framework — `readline` built-in only
- Env var for API key: `TWITTERAPI_IO_KEY`; write creds: `X_USER`, `X_EMAIL`, `X_PASSWORD`, `X_PROXY`, `X_TOTP`
- Never log or commit API keys, passwords, `login_cookies`, `totp_secret`, or proxy URLs
- All commit messages in English, conventional commits format (`feat:`, `chore:`, `fix:` etc.) — no "by Claude" suffix
- `instruction.md` must be in `.gitignore`
- `.env` must be in `.gitignore`

---

## File Map

| File | Responsibility |
|---|---|
| `package.json` | deps, scripts |
| `tsconfig.json` | TS strict config |
| `.gitignore` | ignore `.env`, `node_modules`, `instruction.md`, `dist` |
| `.env.example` | template with all env var names, empty values |
| `src/config.ts` | load + validate env vars |
| `src/client/IHttpClient.ts` | interface: `get`, `post`, `patch`, `delete` |
| `src/client/HttpClient.ts` | fetch wrapper, retry, error mapping |
| `src/client/TwitterClient.ts` | injects `x-api-key` header + base URL |
| `src/services/UserService.ts` | getUserInfo, getFollowers (async gen), getFollowings, searchUsers |
| `src/services/TweetService.ts` | advancedSearch (async gen), getLastTweets, getReplies, getQuotes |
| `src/services/WriteService.ts` | login, createTweet, deleteTweet, likeTweet, followUser, unfollowUser, sendDm |
| `src/services/TrendService.ts` | getTrends |
| `src/examples/user-profile.ts` | runnable: fetch profile + first page of followers |
| `src/examples/tweet-search.ts` | runnable: advanced search with pagination |
| `src/examples/write-actions.ts` | runnable: login → create tweet → delete it |
| `src/examples/trends.ts` | runnable: worldwide + US trends |
| `src/cli/handlers/userHandlers.ts` | readline prompts → UserService |
| `src/cli/handlers/tweetHandlers.ts` | readline prompts → TweetService + TrendService |
| `src/cli/handlers/writeHandlers.ts` | readline prompts → WriteService |
| `src/cli/menu.ts` | interactive menu entry point |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Produces: `npx ts-node src/foo.ts` works; `npm run build` compiles to `dist/`

- [ ] **Step 1: Init package.json**

```bash
cd /home/kyle/code/twitterapi-io
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install dotenv
npm install --save-dev typescript ts-node @types/node
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Write .gitignore**

```
node_modules/
dist/
.env
instruction.md
*.js.map
```

- [ ] **Step 5: Write .env.example**

```
# Required for all operations
TWITTERAPI_IO_KEY=

# Required for write operations only
X_USER=
X_EMAIL=
X_PASSWORD=
X_PROXY=
X_TOTP=
```

- [ ] **Step 6: Add scripts to package.json**

Open `package.json` and replace the `"scripts"` section with:

```json
"scripts": {
  "build": "tsc",
  "cli": "ts-node src/cli/menu.ts",
  "example:user": "ts-node src/examples/user-profile.ts",
  "example:search": "ts-node src/examples/tweet-search.ts",
  "example:write": "ts-node src/examples/write-actions.ts",
  "example:trends": "ts-node src/examples/trends.ts"
}
```

- [ ] **Step 7: Verify TS compiles (empty src)**

```bash
mkdir -p src && echo "export {};" > src/index.ts && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example src/index.ts
git commit -m "chore: init TypeScript project scaffold"
```

---

## Task 2: Config module

**Files:**
- Create: `src/config.ts`
- Remove: `src/index.ts` (placeholder)

**Interfaces:**
- Produces:
```ts
// src/config.ts
export interface Config {
  apiKey: string;
}
export interface WriteConfig extends Config {
  xUser: string;
  xEmail: string;
  xPassword: string;
  xProxy: string;
  xTotp?: string;
}
export function loadConfig(): Config;
export function loadWriteConfig(): WriteConfig;
```

- [ ] **Step 1: Write src/config.ts**

```ts
import * as dotenv from "dotenv";
dotenv.config();

export interface Config {
  apiKey: string;
}

export interface WriteConfig extends Config {
  xUser: string;
  xEmail: string;
  xPassword: string;
  xProxy: string;
  xTotp?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig(): Config {
  return { apiKey: requireEnv("TWITTERAPI_IO_KEY") };
}

export function loadWriteConfig(): WriteConfig {
  return {
    apiKey: requireEnv("TWITTERAPI_IO_KEY"),
    xUser: requireEnv("X_USER"),
    xEmail: requireEnv("X_EMAIL"),
    xPassword: requireEnv("X_PASSWORD"),
    xProxy: requireEnv("X_PROXY"),
    xTotp: process.env["X_TOTP"],
  };
}
```

- [ ] **Step 2: Remove placeholder**

```bash
rm src/index.ts
```

- [ ] **Step 3: Verify types**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/config.ts
git rm src/index.ts
git commit -m "feat: add config module with env validation"
```

---

## Task 3: HTTP client layer

**Files:**
- Create: `src/client/IHttpClient.ts`
- Create: `src/client/HttpClient.ts`
- Create: `src/client/TwitterClient.ts`

**Interfaces:**
- Produces:
```ts
// src/client/IHttpClient.ts
export interface IHttpClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
}

// src/client/TwitterClient.ts
export class TwitterClient implements IHttpClient { ... }
// Constructor: new TwitterClient(apiKey: string)
```

- [ ] **Step 1: Write src/client/IHttpClient.ts**

```ts
export interface IHttpClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
}
```

- [ ] **Step 2: Write src/client/HttpClient.ts**

```ts
import { IHttpClient } from "./IHttpClient";

export class HttpClient implements IHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly defaultHeaders: Record<string, string> = {}
  ) {}

  private async request<T>(
    method: string,
    path: string,
    options: { params?: Record<string, string>; body?: unknown } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.defaultHeaders,
    };

    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url.toString(), init);

      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }

      if (!res.ok) {
        let detail = res.statusText;
        try {
          const body = (await res.json()) as Record<string, unknown>;
          if (typeof body["detail"] === "string") detail = body["detail"];
          else if (typeof body["msg"] === "string") detail = body["msg"];
        } catch {
          // ignore parse error
        }

        if (res.status === 401)
          throw new Error("Invalid API key or expired login cookies");
        if (res.status === 402)
          throw new Error(
            "Insufficient credits — top up at twitterapi.io/dashboard"
          );
        throw new Error(`HTTP ${res.status}: ${detail}`);
      }

      return res.json() as Promise<T>;
    }

    throw new Error(`Request failed after 3 attempts: ${method} ${path}`);
  }

  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, { params });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("DELETE", path, { body });
  }
}
```

- [ ] **Step 3: Write src/client/TwitterClient.ts**

```ts
import { HttpClient } from "./HttpClient";
import { IHttpClient } from "./IHttpClient";

const BASE_URL = "https://api.twitterapi.io";

export class TwitterClient implements IHttpClient {
  private readonly client: HttpClient;

  constructor(apiKey: string) {
    this.client = new HttpClient(BASE_URL, { "x-api-key": apiKey });
  }

  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.client.get<T>(path, params);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.client.post<T>(path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.client.patch<T>(path, body);
  }

  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.client.delete<T>(path, body);
  }
}
```

- [ ] **Step 4: Verify types**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/client/
git commit -m "feat: add HTTP client layer with retry and error handling"
```

---

## Task 4: UserService

**Files:**
- Create: `src/services/UserService.ts`

**Interfaces:**
- Consumes: `TwitterClient` (`IHttpClient`)
- Produces:
```ts
export class UserService {
  constructor(client: IHttpClient);
  getUserInfo(userName: string): Promise<UserInfo>;
  getFollowers(userName: string, pageSize?: number): AsyncGenerator<Follower>;
  getFollowings(userName: string): AsyncGenerator<Following>;
  searchUsers(query: string): Promise<UserSearchResult[]>;
}
export interface UserInfo { id: string; name: string; userName: string; followers: number; following: number; }
export interface Follower { id: string; name: string; userName: string; }
export interface Following { id: string; name: string; userName: string; }
export interface UserSearchResult { id: string; name: string; userName: string; }
```

- [ ] **Step 1: Write src/services/UserService.ts**

```ts
import { IHttpClient } from "../client/IHttpClient";

export interface UserInfo {
  id: string;
  name: string;
  userName: string;
  followers: number;
  following: number;
  isBlueVerified: boolean;
  createdAt: string;
}

export interface Follower {
  id: string;
  name: string;
  userName: string;
}

export interface Following {
  id: string;
  name: string;
  userName: string;
}

export interface UserSearchResult {
  id: string;
  name: string;
  userName: string;
}

interface UserInfoResponse {
  data: UserInfo;
}

interface FollowersResponse {
  followers: Follower[];
  has_next_page: boolean;
  next_cursor: string;
}

interface FollowingsResponse {
  followings: Following[];
  has_next_page: boolean;
  next_cursor: string;
}

interface UserSearchResponse {
  users: UserSearchResult[];
  has_next_page: boolean;
  next_cursor: string;
}

export class UserService {
  constructor(private readonly client: IHttpClient) {}

  async getUserInfo(userName: string): Promise<UserInfo> {
    const res = await this.client.get<UserInfoResponse>(
      "/twitter/user/info",
      { userName }
    );
    return res.data;
  }

  async *getFollowers(
    userName: string,
    pageSize = 200
  ): AsyncGenerator<Follower> {
    let cursor = "";
    while (true) {
      const res = await this.client.get<FollowersResponse>(
        "/twitter/user/followers",
        { userName, cursor, pageSize: String(pageSize) }
      );
      for (const f of res.followers ?? []) yield f;
      if (!res.has_next_page) break;
      cursor = res.next_cursor ?? "";
    }
  }

  async *getFollowings(userName: string): AsyncGenerator<Following> {
    let cursor = "";
    while (true) {
      const res = await this.client.get<FollowingsResponse>(
        "/twitter/user/followings",
        { userName, cursor, pageSize: "200" }
      );
      for (const f of res.followings ?? []) yield f;
      if (!res.has_next_page) break;
      cursor = res.next_cursor ?? "";
    }
  }

  async searchUsers(query: string): Promise<UserSearchResult[]> {
    const res = await this.client.get<UserSearchResponse>(
      "/twitter/user/search",
      { query }
    );
    return res.users ?? [];
  }
}
```

- [ ] **Step 2: Verify types**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/services/UserService.ts
git commit -m "feat: add UserService"
```

---

## Task 5: TweetService and TrendService

**Files:**
- Create: `src/services/TweetService.ts`
- Create: `src/services/TrendService.ts`

**Interfaces:**
- Consumes: `IHttpClient`
- Produces:
```ts
export class TweetService {
  constructor(client: IHttpClient);
  advancedSearch(query: string, queryType?: string): AsyncGenerator<Tweet>;
  getLastTweets(userName: string): Promise<Tweet[]>;
  getReplies(tweetId: string): Promise<Tweet[]>;
  getQuotes(tweetId: string): Promise<Tweet[]>;
}
export interface Tweet { id: string; text: string; createdAt: string; author?: { userName: string }; }

export class TrendService {
  constructor(client: IHttpClient);
  getTrends(woeid?: number, count?: number): Promise<Trend[]>;
}
export interface Trend { name: string; tweetVolume?: number; }
```

- [ ] **Step 1: Write src/services/TweetService.ts**

```ts
import { IHttpClient } from "../client/IHttpClient";

export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  author?: { userName: string; name: string };
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
}

interface TweetSearchResponse {
  tweets: Tweet[];
  has_next_page: boolean;
  next_cursor: string;
}

interface LastTweetsResponse {
  data: { tweets: Tweet[] };
}

export class TweetService {
  constructor(private readonly client: IHttpClient) {}

  async *advancedSearch(
    query: string,
    queryType = "Latest"
  ): AsyncGenerator<Tweet> {
    let cursor = "";
    while (true) {
      const res = await this.client.get<TweetSearchResponse>(
        "/twitter/tweet/advanced_search",
        { query, queryType, cursor }
      );
      for (const t of res.tweets ?? []) yield t;
      if (!res.has_next_page) break;
      cursor = res.next_cursor ?? "";
    }
  }

  async getLastTweets(userName: string): Promise<Tweet[]> {
    const res = await this.client.get<LastTweetsResponse>(
      "/twitter/user/last_tweets",
      { userName }
    );
    return res.data?.tweets ?? [];
  }

  async getReplies(tweetId: string): Promise<Tweet[]> {
    const res = await this.client.get<TweetSearchResponse>(
      "/twitter/tweet/replies",
      { tweetId }
    );
    return res.tweets ?? [];
  }

  async getQuotes(tweetId: string): Promise<Tweet[]> {
    const res = await this.client.get<TweetSearchResponse>(
      "/twitter/tweet/quotes",
      { tweetId }
    );
    return res.tweets ?? [];
  }
}
```

- [ ] **Step 2: Write src/services/TrendService.ts**

```ts
import { IHttpClient } from "../client/IHttpClient";

export interface Trend {
  name: string;
  tweetVolume?: number;
}

interface TrendsResponse {
  data: { trends: Trend[] };
}

export class TrendService {
  constructor(private readonly client: IHttpClient) {}

  async getTrends(woeid = 1, count = 30): Promise<Trend[]> {
    const res = await this.client.get<TrendsResponse>("/twitter/trends", {
      woeid: String(woeid),
      count: String(count),
    });
    return res.data?.trends ?? [];
  }
}
```

- [ ] **Step 3: Verify types**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/services/TweetService.ts src/services/TrendService.ts
git commit -m "feat: add TweetService and TrendService"
```

---

## Task 6: WriteService

**Files:**
- Create: `src/services/WriteService.ts`

**Interfaces:**
- Consumes: `IHttpClient`, `WriteConfig`
- Produces:
```ts
export class WriteService {
  constructor(client: IHttpClient, config: WriteConfig);
  login(): Promise<void>;                      // caches login_cookies in memory
  createTweet(text: string, options?: CreateTweetOptions): Promise<TweetResult>;
  deleteTweet(tweetId: string): Promise<void>;
  likeTweet(tweetId: string): Promise<void>;
  followUser(userId: string): Promise<void>;
  unfollowUser(userId: string): Promise<void>;
  sendDm(userId: string, text: string): Promise<void>;
}
export interface CreateTweetOptions { replyToTweetId?: string; quoteTweetId?: string; mediaIds?: string[]; }
export interface TweetResult { tweetId: string; }
```

- [ ] **Step 1: Write src/services/WriteService.ts**

```ts
import { IHttpClient } from "../client/IHttpClient";
import { WriteConfig } from "../config";

export interface CreateTweetOptions {
  replyToTweetId?: string;
  quoteTweetId?: string;
  mediaIds?: string[];
}

export interface TweetResult {
  tweetId: string;
}

interface LoginResponse {
  login_cookies: string;
}

interface CreateTweetResponse {
  data?: { tweet_id?: string; id?: string };
  tweet_id?: string;
}

export class WriteService {
  private loginCookies: string | null = null;

  constructor(
    private readonly client: IHttpClient,
    private readonly config: WriteConfig
  ) {}

  async login(): Promise<void> {
    if (this.loginCookies) return;

    const body: Record<string, string> = {
      user_name: this.config.xUser,
      email: this.config.xEmail,
      password: this.config.xPassword,
      proxy: this.config.xProxy,
    };
    if (this.config.xTotp) body["totp_secret"] = this.config.xTotp;

    const res = await this.client.post<LoginResponse>(
      "/twitter/user_login_v2",
      body
    );
    this.loginCookies = res.login_cookies;
  }

  private async authBody(
    extra: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    await this.login();
    return {
      login_cookies: this.loginCookies,
      proxy: this.config.xProxy,
      ...extra,
    };
  }

  async createTweet(
    text: string,
    options: CreateTweetOptions = {}
  ): Promise<TweetResult> {
    const body: Record<string, unknown> = await this.authBody({
      tweet_text: text,
    });
    if (options.replyToTweetId)
      body["reply_to_tweet_id"] = options.replyToTweetId;
    if (options.quoteTweetId) body["quote_tweet_id"] = options.quoteTweetId;
    if (options.mediaIds) body["media_ids"] = options.mediaIds;

    const res = await this.client.post<CreateTweetResponse>(
      "/twitter/create_tweet_v2",
      body
    );
    const tweetId =
      res.data?.tweet_id ?? res.data?.id ?? res.tweet_id ?? "";
    return { tweetId };
  }

  async deleteTweet(tweetId: string): Promise<void> {
    await this.client.post("/twitter/delete_tweet_v2", await this.authBody({ tweet_id: tweetId }));
  }

  async likeTweet(tweetId: string): Promise<void> {
    await this.client.post("/twitter/like_tweet_v2", await this.authBody({ tweet_id: tweetId }));
  }

  async followUser(userId: string): Promise<void> {
    await this.client.post("/twitter/follow_user_v2", await this.authBody({ user_id: userId }));
  }

  async unfollowUser(userId: string): Promise<void> {
    await this.client.post("/twitter/unfollow_user_v2", await this.authBody({ user_id: userId }));
  }

  async sendDm(userId: string, text: string): Promise<void> {
    await this.client.post("/twitter/send_dm_to_user", await this.authBody({ user_id: userId, text }));
  }
}
```

- [ ] **Step 2: Verify types**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/services/WriteService.ts
git commit -m "feat: add WriteService with login cookie caching"
```

---

## Task 7: Example scripts

**Files:**
- Create: `src/examples/user-profile.ts`
- Create: `src/examples/tweet-search.ts`
- Create: `src/examples/write-actions.ts`
- Create: `src/examples/trends.ts`

**Interfaces:**
- Consumes: `loadConfig`, `loadWriteConfig`, `TwitterClient`, all services

- [ ] **Step 1: Write src/examples/user-profile.ts**

```ts
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { UserService } from "../services/UserService";

async function main() {
  const config = loadConfig();
  const client = new TwitterClient(config.apiKey);
  const users = new UserService(client);

  const TARGET = process.argv[2] ?? "elonmusk";

  const info = await users.getUserInfo(TARGET);
  console.log(`\n@${info.userName} (${info.name})`);
  console.log(`Followers : ${info.followers.toLocaleString()}`);
  console.log(`Following : ${info.following.toLocaleString()}`);
  console.log(`Verified  : ${info.isBlueVerified}`);
  console.log(`Joined    : ${info.createdAt}`);

  const FOLLOWER_LIMIT = 10;
  console.log(`\nFirst ${FOLLOWER_LIMIT} followers:`);
  let count = 0;
  for await (const f of users.getFollowers(TARGET)) {
    console.log(`  @${f.userName} — ${f.name}`);
    if (++count >= FOLLOWER_LIMIT) break;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Write src/examples/tweet-search.ts**

```ts
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TweetService } from "../services/TweetService";

async function main() {
  const config = loadConfig();
  const client = new TwitterClient(config.apiKey);
  const tweets = new TweetService(client);

  const query =
    process.argv[2] ?? "from:elonmusk since:2025-01-01 min_faves:1000";
  const MAX = 20;

  console.log(`\nSearching: ${query}`);
  console.log(`(showing up to ${MAX} results)\n`);

  let count = 0;
  for await (const t of tweets.advancedSearch(query)) {
    console.log(`[${t.createdAt}] ${t.text.slice(0, 120).replace(/\n/g, " ")}`);
    if (++count >= MAX) break;
  }

  console.log(`\nTotal shown: ${count}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Write src/examples/write-actions.ts**

```ts
import { loadWriteConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { WriteService } from "../services/WriteService";

async function main() {
  const config = loadWriteConfig();
  const client = new TwitterClient(config.apiKey);
  const writer = new WriteService(client, config);

  console.log("Logging in...");
  await writer.login();
  console.log("Logged in successfully.");

  const text = `Hello from twitterapi.io example! [${new Date().toISOString()}]`;
  console.log(`\nCreating tweet: "${text}"`);
  const result = await writer.createTweet(text);
  console.log(`Tweet created — id: ${result.tweetId}`);

  console.log("\nDeleting tweet...");
  await writer.deleteTweet(result.tweetId);
  console.log("Tweet deleted.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 4: Write src/examples/trends.ts**

```ts
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { TrendService } from "../services/TrendService";

async function main() {
  const config = loadConfig();
  const client = new TwitterClient(config.apiKey);
  const trender = new TrendService(client);

  console.log("\n=== Worldwide Trends ===");
  const worldwide = await trender.getTrends(1, 10);
  worldwide.forEach((t, i) => {
    const vol = t.tweetVolume ? ` (${t.tweetVolume.toLocaleString()} tweets)` : "";
    console.log(`  ${i + 1}. ${t.name}${vol}`);
  });

  console.log("\n=== US Trends ===");
  const us = await trender.getTrends(23424977, 10);
  us.forEach((t, i) => {
    const vol = t.tweetVolume ? ` (${t.tweetVolume.toLocaleString()} tweets)` : "";
    console.log(`  ${i + 1}. ${t.name}${vol}`);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 5: Verify types**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/examples/
git commit -m "feat: add example scripts for user, tweet, write, and trends"
```

---

## Task 8: CLI handlers

**Files:**
- Create: `src/cli/handlers/userHandlers.ts`
- Create: `src/cli/handlers/tweetHandlers.ts`
- Create: `src/cli/handlers/writeHandlers.ts`

**Interfaces:**
- Consumes: all services, `readline.Interface`
- Produces:
```ts
// each handler file exports a single function
export async function handleUserMenu(rl: readline.Interface, client: IHttpClient): Promise<void>;
export async function handleTweetMenu(rl: readline.Interface, client: IHttpClient): Promise<void>;
export async function handleWriteMenu(rl: readline.Interface, client: IHttpClient, config: WriteConfig): Promise<void>;
```

- [ ] **Step 1: Write src/cli/handlers/userHandlers.ts**

```ts
import * as readline from "readline";
import { IHttpClient } from "../../client/IHttpClient";
import { UserService } from "../../services/UserService";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function handleUserMenu(
  rl: readline.Interface,
  client: IHttpClient
): Promise<void> {
  const svc = new UserService(client);

  console.log("\n--- User Menu ---");
  console.log("  1. Get user profile");
  console.log("  2. List followers");
  console.log("  3. List followings");
  console.log("  4. Search users");
  console.log("  0. Back");

  const choice = await ask(rl, "\nChoice: ");

  switch (choice.trim()) {
    case "1": {
      const userName = await ask(rl, "Username: ");
      const info = await svc.getUserInfo(userName.trim());
      console.log(`\n@${info.userName} (${info.name})`);
      console.log(`Followers: ${info.followers.toLocaleString()}`);
      console.log(`Following: ${info.following.toLocaleString()}`);
      console.log(`Verified: ${info.isBlueVerified}`);
      break;
    }
    case "2": {
      const userName = await ask(rl, "Username: ");
      const limitStr = await ask(rl, "How many followers to show? (default 20): ");
      const limit = parseInt(limitStr.trim()) || 20;
      let count = 0;
      console.log("");
      for await (const f of svc.getFollowers(userName.trim())) {
        console.log(`  @${f.userName} — ${f.name}`);
        if (++count >= limit) break;
      }
      console.log(`\nShowed ${count} followers.`);
      break;
    }
    case "3": {
      const userName = await ask(rl, "Username: ");
      const limitStr = await ask(rl, "How many followings to show? (default 20): ");
      const limit = parseInt(limitStr.trim()) || 20;
      let count = 0;
      console.log("");
      for await (const f of svc.getFollowings(userName.trim())) {
        console.log(`  @${f.userName} — ${f.name}`);
        if (++count >= limit) break;
      }
      console.log(`\nShowed ${count} followings.`);
      break;
    }
    case "4": {
      const query = await ask(rl, "Search query: ");
      const results = await svc.searchUsers(query.trim());
      console.log("");
      results.forEach((u) => console.log(`  @${u.userName} — ${u.name}`));
      console.log(`\n${results.length} result(s).`);
      break;
    }
    case "0":
      break;
    default:
      console.log("Invalid choice.");
  }
}
```

- [ ] **Step 2: Write src/cli/handlers/tweetHandlers.ts**

```ts
import * as readline from "readline";
import { IHttpClient } from "../../client/IHttpClient";
import { TweetService } from "../../services/TweetService";
import { TrendService } from "../../services/TrendService";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function handleTweetMenu(
  rl: readline.Interface,
  client: IHttpClient
): Promise<void> {
  const tweetSvc = new TweetService(client);
  const trendSvc = new TrendService(client);

  console.log("\n--- Tweet Menu ---");
  console.log("  1. Advanced tweet search");
  console.log("  2. User's recent tweets");
  console.log("  3. Tweet replies");
  console.log("  4. Trends");
  console.log("  0. Back");

  const choice = await ask(rl, "\nChoice: ");

  switch (choice.trim()) {
    case "1": {
      const query = await ask(rl, "Search query: ");
      const limitStr = await ask(rl, "Max results (default 10): ");
      const limit = parseInt(limitStr.trim()) || 10;
      let count = 0;
      console.log("");
      for await (const t of tweetSvc.advancedSearch(query.trim())) {
        console.log(`[${t.createdAt}] ${t.text.slice(0, 120).replace(/\n/g, " ")}`);
        if (++count >= limit) break;
      }
      console.log(`\nShowed ${count} tweet(s).`);
      break;
    }
    case "2": {
      const userName = await ask(rl, "Username: ");
      const results = await tweetSvc.getLastTweets(userName.trim());
      console.log("");
      results.slice(0, 10).forEach((t) =>
        console.log(`[${t.createdAt}] ${t.text.slice(0, 120).replace(/\n/g, " ")}`)
      );
      break;
    }
    case "3": {
      const tweetId = await ask(rl, "Tweet ID: ");
      const replies = await tweetSvc.getReplies(tweetId.trim());
      console.log("");
      replies.slice(0, 10).forEach((t) =>
        console.log(`  @${t.author?.userName ?? "?"}: ${t.text.slice(0, 100).replace(/\n/g, " ")}`)
      );
      console.log(`\n${replies.length} reply(ies).`);
      break;
    }
    case "4": {
      const woeidStr = await ask(rl, "WOEID (1=worldwide, 23424977=US, default 1): ");
      const woeid = parseInt(woeidStr.trim()) || 1;
      const trends = await trendSvc.getTrends(woeid, 20);
      console.log("");
      trends.forEach((t, i) => {
        const vol = t.tweetVolume ? ` (${t.tweetVolume.toLocaleString()})` : "";
        console.log(`  ${i + 1}. ${t.name}${vol}`);
      });
      break;
    }
    case "0":
      break;
    default:
      console.log("Invalid choice.");
  }
}
```

- [ ] **Step 3: Write src/cli/handlers/writeHandlers.ts**

```ts
import * as readline from "readline";
import { IHttpClient } from "../../client/IHttpClient";
import { WriteConfig } from "../../config";
import { WriteService } from "../../services/WriteService";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function handleWriteMenu(
  rl: readline.Interface,
  client: IHttpClient,
  config: WriteConfig,
  writer: WriteService
): Promise<void> {
  console.log("\n--- Write Menu (requires login) ---");
  console.log("  1. Create tweet");
  console.log("  2. Delete tweet");
  console.log("  3. Like tweet");
  console.log("  4. Follow user");
  console.log("  5. Unfollow user");
  console.log("  6. Send DM");
  console.log("  0. Back");

  const choice = await ask(rl, "\nChoice: ");

  switch (choice.trim()) {
    case "1": {
      const text = await ask(rl, "Tweet text: ");
      const result = await writer.createTweet(text.trim());
      console.log(`\nTweet created — id: ${result.tweetId}`);
      break;
    }
    case "2": {
      const tweetId = await ask(rl, "Tweet ID to delete: ");
      await writer.deleteTweet(tweetId.trim());
      console.log("\nTweet deleted.");
      break;
    }
    case "3": {
      const tweetId = await ask(rl, "Tweet ID to like: ");
      await writer.likeTweet(tweetId.trim());
      console.log("\nLiked.");
      break;
    }
    case "4": {
      const userId = await ask(rl, "User ID to follow: ");
      await writer.followUser(userId.trim());
      console.log("\nFollowed.");
      break;
    }
    case "5": {
      const userId = await ask(rl, "User ID to unfollow: ");
      await writer.unfollowUser(userId.trim());
      console.log("\nUnfollowed.");
      break;
    }
    case "6": {
      const userId = await ask(rl, "User ID: ");
      const text = await ask(rl, "Message: ");
      await writer.sendDm(userId.trim(), text.trim());
      console.log("\nDM sent.");
      break;
    }
    case "0":
      break;
    default:
      console.log("Invalid choice.");
  }
}
```

- [ ] **Step 4: Verify types**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/cli/handlers/
git commit -m "feat: add CLI menu handlers"
```

---

## Task 9: CLI menu entry point

**Files:**
- Create: `src/cli/menu.ts`

**Interfaces:**
- Consumes: all handlers, `loadConfig`, `loadWriteConfig`, `TwitterClient`, `WriteService`

- [ ] **Step 1: Write src/cli/menu.ts**

```ts
import * as readline from "readline";
import { loadConfig, loadWriteConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { WriteService } from "../services/WriteService";
import { handleUserMenu } from "./handlers/userHandlers";
import { handleTweetMenu } from "./handlers/tweetHandlers";
import { handleWriteMenu } from "./handlers/writeHandlers";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const config = loadConfig();
  const client = new TwitterClient(config.apiKey);

  let writer: WriteService | null = null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const cleanup = () => {
    rl.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);

  while (true) {
    console.log("\n=== twitterapi.io CLI ===");
    console.log("  1. User");
    console.log("  2. Tweet");
    console.log("  3. Write (requires login)");
    console.log("  0. Exit");

    const choice = await ask(rl, "\nChoice: ");

    try {
      switch (choice.trim()) {
        case "1":
          await handleUserMenu(rl, client);
          break;
        case "2":
          await handleTweetMenu(rl, client);
          break;
        case "3": {
          if (!writer) {
            const writeConfig = loadWriteConfig();
            writer = new WriteService(client, writeConfig);
            console.log("\nLogging in...");
            await writer.login();
            console.log("Logged in.");
          }
          await handleWriteMenu(rl, client, loadWriteConfig(), writer);
          break;
        }
        case "0":
          console.log("Goodbye!");
          cleanup();
          return;
        default:
          console.log("Invalid choice.");
      }
    } catch (err) {
      console.error(
        "\nError:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

main();
```

- [ ] **Step 2: Verify types**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Full build check**

```bash
npm run build
```

Expected: `dist/` populated, no errors

- [ ] **Step 4: Commit**

```bash
git add src/cli/menu.ts
git commit -m "feat: add interactive CLI menu"
```

---

## Task 10: README and final polish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
# twitterapi.io TypeScript Examples

TypeScript examples for the [twitterapi.io](https://twitterapi.io) REST API — query Twitter/X data and perform authenticated actions using a single API key, no OAuth required.

## Setup

```bash
npm install
cp .env.example .env
# Fill in TWITTERAPI_IO_KEY (and X_* vars for write operations)
```

## Running Examples

```bash
npm run example:user           # user profile + followers
npm run example:search         # advanced tweet search
npm run example:trends         # worldwide + US trends
npm run example:write          # login → create tweet → delete it (requires X_* vars)
```

## Interactive CLI

```bash
npm run cli
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```
