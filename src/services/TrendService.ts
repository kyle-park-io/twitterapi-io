import { IHttpClient } from "../client/IHttpClient";

export interface Trend {
  name: string;
  tweetVolume?: number;
}

interface TrendItem {
  trend: { name: string; rank?: number };
  tweetCount?: number;
}

interface TrendsResponse {
  trends: TrendItem[];
}

export class TrendService {
  constructor(private readonly client: IHttpClient) {}

  async getTrends(woeid = 1, count = 30): Promise<Trend[]> {
    const res = await this.client.get<TrendsResponse>("/twitter/trends", {
      woeid: String(woeid),
      count: String(count),
    });
    return (res.trends ?? []).map((item) => ({
      name: item.trend.name,
      tweetVolume: item.tweetCount,
    }));
  }
}
