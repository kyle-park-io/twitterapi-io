// src/follow/__tests__/scoring.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreAccount,
  fromFollowingsRecord,
  fromSearchAuthor,
  UNFOLLOW_THRESHOLD,
  ScorableProfile,
} from "../scoring";

function profile(over: Partial<ScorableProfile> = {}): ScorableProfile {
  return {
    userName: "someone",
    description: "",
    followersCount: 5000,
    followingCount: 500,
    statusesCount: 3000,
    avatarUrl: "https://pbs.twimg.com/profile_images/1/a_normal.jpg",
    bannerUrl: "https://pbs.twimg.com/profile_banners/1/2",
    ...over,
  };
}

test("threshold is 3", () => {
  assert.equal(UNFOLLOW_THRESHOLD, 3);
});

test("a plain profile scores 0", () => {
  assert.equal(scoreAccount(profile()).score, 0);
});

test("pump contract address in bio scores 3", () => {
  const r = scoreAccount(
    profile({ description: "The Life of a Chud EoP9nKZMtTFTWVjkJVJEQQXAgWoFZwgVgoKspkrVpump" })
  );
  assert.equal(r.score, 3);
  assert.ok(r.reasons.includes("pump-contract-in-bio"));
});

test("explicit promo solicitation reaches the threshold", () => {
  const r = scoreAccount(profile({ description: "AI & Tech | DM for promo and collabs" }));
  assert.ok(r.score >= UNFOLLOW_THRESHOLD, `scored ${r.score}`);
  assert.ok(r.reasons.includes("promo-solicitation"));
});

test("self-declared KOL scores 3", () => {
  assert.equal(scoreAccount(profile({ description: "Crypto OG | KOL" })).score, 3);
});

test("bot ratio scores 2 and does not reach the threshold alone", () => {
  const r = scoreAccount(profile({ followersCount: 100, followingCount: 900 }));
  assert.equal(r.score, 2);
  assert.ok(r.score < UNFOLLOW_THRESHOLD);
});

test("weak signals alone never reach the threshold", () => {
  const r = scoreAccount(
    profile({ description: "AWS Ambassador @aws ML and Applied Research Lead", bannerUrl: null })
  );
  assert.ok(r.score < UNFOLLOW_THRESHOLD, `expected <3, got ${r.score}`);
});

// Regression fixtures — real accounts a naive rule set misclassified.
test("known false positives stay below the threshold", () => {
  const cases: ScorableProfile[] = [
    // @JensenHuang — a huge account that simply does not tweet
    profile({
      userName: "JensenHuang",
      description: "Founder and CEO of NVIDIA.",
      followersCount: 1038966,
      followingCount: 53,
      statusesCount: 12,
    }),
    // @Ember_web3 — "Hidden gems" here is not pump language
    profile({
      userName: "Ember_web3",
      description:
        "What's being built in Seoul\nKorea Web3 • Builders • Startups\nShort clips • Hidden gems • NFA",
      followersCount: 17109,
    }),
    // @Shekswess — "Ambassador" is a real role
    profile({
      userName: "Shekswess",
      description: "AWS Ambassador @aws ML and Applied Research Lead @lokahq College Professor",
      followersCount: 1520,
    }),
  ];
  for (const c of cases) {
    assert.ok(
      scoreAccount(c).score < UNFOLLOW_THRESHOLD,
      `${c.userName} scored ${scoreAccount(c).score}`
    );
  }
});

test("known true positives reach the threshold", () => {
  const cases: ScorableProfile[] = [
    profile({
      userName: "CoreNews_2",
      description: "Fan Page & Parody | Crypto Expert| Crypto Enthusiast|DM For promotion| #sol",
      followersCount: 397849,
    }),
    profile({
      userName: "tylerrwayne",
      description: "Top AI Voice | Sharing insights on AI, No-Code, Tech Tools & prompts",
      followersCount: 407264,
    }),
    profile({
      userName: "Zillioncoins",
      description: "FEED CREATOR | CRYPTO KOL | COIN X",
      followersCount: 23139,
    }),
  ];
  for (const c of cases) {
    assert.ok(
      scoreAccount(c).score >= UNFOLLOW_THRESHOLD,
      `${c.userName} scored ${scoreAccount(c).score}`
    );
  }
});

test("fromFollowingsRecord maps the snake_case wire format", () => {
  const p = fromFollowingsRecord({
    userName: "jayc_BM",
    description: "Head of BD",
    followers_count: 2109,
    friends_count: 1862,
    statuses_count: 4200,
    profile_image_url_https: "https://pbs.twimg.com/profile_images/1/x_normal.jpg",
    profile_banner_url: null,
  });
  assert.deepEqual(p, {
    userName: "jayc_BM",
    description: "Head of BD",
    followersCount: 2109,
    followingCount: 1862,
    statusesCount: 4200,
    avatarUrl: "https://pbs.twimg.com/profile_images/1/x_normal.jpg",
    bannerUrl: null,
  });
});

test("fromSearchAuthor maps the camelCase wire format", () => {
  const p = fromSearchAuthor({
    userName: "BSCNews",
    description: "",
    followers: 1371990,
    following: 171,
    statusesCount: 91806,
    profilePicture: "https://pbs.twimg.com/profile_images/2/y_normal.jpg",
    coverPicture: null,
  });
  assert.deepEqual(p, {
    userName: "BSCNews",
    description: "",
    followersCount: 1371990,
    followingCount: 171,
    statusesCount: 91806,
    avatarUrl: "https://pbs.twimg.com/profile_images/2/y_normal.jpg",
    bannerUrl: null,
  });
});

test("adapters tolerate missing fields", () => {
  assert.equal(fromFollowingsRecord({ userName: "a" }).followersCount, 0);
  assert.equal(fromSearchAuthor({ userName: "b" }).description, "");
});
