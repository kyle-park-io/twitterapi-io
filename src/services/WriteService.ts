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
    if (!res.login_cookies) {
      throw new Error("Login failed: no cookies returned from API");
    }
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
