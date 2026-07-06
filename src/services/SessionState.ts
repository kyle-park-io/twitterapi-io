export interface StorageStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface StorageState {
  cookies: StorageStateCookie[];
  origins: never[];
}

const ONE_YEAR_SECONDS = 31_536_000;

/**
 * Assemble a Playwright `storageState` object from the two cookies that make up
 * an X session: `auth_token` (auth) and `ct0` (CSRF). Copied from a real,
 * logged-in Chrome so Playwright can skip the automated login X blocks.
 */
export function buildStorageState(
  authToken: string,
  ct0: string,
  now: Date = new Date()
): StorageState {
  const expires = Math.floor(now.getTime() / 1000) + ONE_YEAR_SECONDS;
  return {
    cookies: [
      {
        name: "auth_token",
        value: authToken,
        domain: ".x.com",
        path: "/",
        expires,
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
      {
        name: "ct0",
        value: ct0,
        domain: ".x.com",
        path: "/",
        expires,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [],
  };
}
