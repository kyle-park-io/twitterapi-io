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
