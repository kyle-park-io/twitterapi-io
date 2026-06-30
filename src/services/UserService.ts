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
