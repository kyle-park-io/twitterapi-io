import { IHttpClient } from "../client/IHttpClient";

export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  author?: { userName: string; name: string };
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
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

  async *getListTweets(listId: string): AsyncGenerator<Tweet> {
    let cursor = "";
    while (true) {
      const res = await this.client.get<TweetSearchResponse>(
        "/twitter/list/tweets",
        { listId, cursor }
      );
      for (const t of res.tweets ?? []) yield t;
      if (!res.has_next_page) break;
      cursor = res.next_cursor ?? "";
    }
  }
}
