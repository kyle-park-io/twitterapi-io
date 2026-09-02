// src/follow/scoring.ts

/**
 * A profile in the shape the scoring rules read. Both wire formats are converted
 * into this by the adapters below, so no rule has to know its input's origin.
 */
export interface ScorableProfile {
  userName: string;
  description: string;
  followersCount: number;
  followingCount: number;
  statusesCount: number;
  avatarUrl: string;
  bannerUrl: string | null;
}

export interface ScoredAccount {
  score: number;
  reasons: string[];
}

/** A record from `GET /twitter/user/followings` (snake_case). */
export interface FollowingsRecord {
  userName: string;
  description?: string | null;
  followers_count?: number;
  friends_count?: number;
  statuses_count?: number;
  profile_image_url_https?: string | null;
  profile_banner_url?: string | null;
}

/** A tweet author from `GET /twitter/tweet/advanced_search` (camelCase). */
export interface SearchAuthor {
  userName: string;
  description?: string | null;
  followers?: number;
  following?: number;
  statusesCount?: number;
  profilePicture?: string | null;
  coverPicture?: string | null;
}

export function fromFollowingsRecord(u: FollowingsRecord): ScorableProfile {
  return {
    userName: u.userName,
    description: u.description ?? "",
    followersCount: u.followers_count ?? 0,
    followingCount: u.friends_count ?? 0,
    statusesCount: u.statuses_count ?? 0,
    avatarUrl: u.profile_image_url_https ?? "",
    bannerUrl: u.profile_banner_url ?? null,
  };
}

export function fromSearchAuthor(a: SearchAuthor): ScorableProfile {
  return {
    userName: a.userName,
    description: a.description ?? "",
    followersCount: a.followers ?? 0,
    followingCount: a.following ?? 0,
    statusesCount: a.statusesCount ?? 0,
    avatarUrl: a.profilePicture ?? "",
    bannerUrl: a.coverPicture ?? null,
  };
}

/**
 * Score at or above which an account is unfollowed. Weighted scoring rather than
 * per-rule booleans exists because single rules produced unacceptable false
 * positives: a "<20 tweets" rule flags @JensenHuang, "hidden gems" flags a Seoul
 * builder feed, "ambassador" flags an AWS ambassador. The threshold is what buys
 * the precision — see the regression fixtures in the tests.
 */
export const UNFOLLOW_THRESHOLD = 3;

const PROMO_EMOJI = /[\u{1F680}\u{1F4B0}\u{1F525}\u{1F48E}\u{1F4C8}\u{2728}\u{1F91D}\u{1F4BC}]/gu;

interface Rule {
  weight: number;
  reason: string;
  test: (u: ScorableProfile) => boolean;
}

const RULES: Rule[] = [
  {
    weight: 3,
    reason: "pump-contract-in-bio",
    test: (u) => /[A-HJ-NP-Za-km-z1-9]{32,44}pump\b/.test(u.description),
  },
  {
    weight: 3,
    reason: "promo-solicitation",
    test: (u) =>
      /dm for (promo|collab|business|ads|pr\b)|\u{1F4E9} *for (ads|promo|pr)|paid (promo|collab)|for ads *& *pr|dm (is )?open for/iu.test(
        u.description
      ),
  },
  {
    weight: 3,
    reason: "self-declared-kol",
    test: (u) =>
      /\bKOL\b|key opinion leader|crypto (expert|influencer)|top ai voice|\binfluencer\b/i.test(
        u.description
      ),
  },
  {
    weight: 2,
    reason: "pump-language",
    test: (u) => /100x|1000x|moonshot|to the moon|next gem|\u{1F680} *(gem|moon)/iu.test(u.description),
  },
  {
    weight: 2,
    reason: "presale-solicitation",
    test: (u) => /giveaway|whitelist|presale|free mint|claim now/i.test(u.description),
  },
  {
    weight: 2,
    reason: "telegram-funnel",
    test: (u) => /t\.me\/|tg *(handle|:)/i.test(u.description),
  },
  {
    weight: 2,
    reason: "bot-ratio",
    test: (u) => u.followingCount / (u.followersCount || 1) > 3 && u.followingCount > 500,
  },
  {
    weight: 2,
    reason: "default-avatar",
    test: (u) => /default_profile/.test(u.avatarUrl),
  },
  {
    weight: 2,
    reason: "ghost-account",
    test: (u) => u.followersCount < 50 && u.statusesCount < 50,
  },
  {
    weight: 1,
    reason: "ambassador-or-collab",
    test: (u) => /ambassador|collab(oration)?s?\b/i.test(u.description),
  },
  {
    weight: 1,
    reason: "no-bio-no-banner",
    test: (u) => u.description.trim() === "" && !u.bannerUrl,
  },
  {
    weight: 1,
    reason: "promo-emoji-density",
    test: (u) => (u.description.match(PROMO_EMOJI) ?? []).length >= 3,
  },
];

export function scoreAccount(u: ScorableProfile): ScoredAccount {
  let score = 0;
  const reasons: string[] = [];
  for (const rule of RULES) {
    if (rule.test(u)) {
      score += rule.weight;
      reasons.push(rule.reason);
    }
  }
  return { score, reasons };
}
