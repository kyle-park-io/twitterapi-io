import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
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

export function resolveStorageStatePath(): string {
  return path.join(process.cwd(), ".auth", "x-session.json");
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

export interface AutoFollowConfig {
  apiKey: string;
  xUser: string;
  xEmail: string;
  xPassword: string;
  xTotp?: string;
  keywords: string[];
  queryType: string;
  intervalMinutes: number;
  perKeyword: number;
  keywordsPerCycle: number;
  maxPerRun: number;
  dryRun: boolean;
  storageStatePath: string;
  statePath: string;
}

interface AutoFollowFile {
  keywords?: string[];
  queryType?: string;
  intervalMinutes?: number;
  perKeyword?: number;
  keywordsPerCycle?: number;
  maxPerRun?: number;
  dryRun?: boolean;
}

function parseAutoFollowFlags(argv: string[]): {
  intervalMinutes?: number;
  perKeyword?: number;
  keywordsPerCycle?: number;
  maxPerRun?: number;
  dryRun?: boolean;
} {
  const args = argv.slice(2);
  const flags: {
    intervalMinutes?: number;
    perKeyword?: number;
    keywordsPerCycle?: number;
    maxPerRun?: number;
    dryRun?: boolean;
  } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--interval" && args[i + 1]) {
      flags.intervalMinutes = parseInt(args[++i], 10);
    } else if (args[i] === "--per-keyword" && args[i + 1]) {
      flags.perKeyword = parseInt(args[++i], 10);
    } else if (args[i] === "--keywords-per-cycle" && args[i + 1]) {
      flags.keywordsPerCycle = parseInt(args[++i], 10);
    } else if (args[i] === "--max" && args[i + 1]) {
      flags.maxPerRun = parseInt(args[++i], 10);
    } else if (args[i] === "--dry-run") {
      flags.dryRun = true;
    } else if (args[i] === "--no-dry-run") {
      flags.dryRun = false;
    }
  }
  return flags;
}

export function loadAutoFollowConfig(argv: string[] = process.argv): AutoFollowConfig {
  const filePath = path.join(process.cwd(), "config", "auto-follow.json");
  const file: AutoFollowFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const flags = parseAutoFollowFlags(argv);

  if (!file.keywords || file.keywords.length === 0) {
    throw new Error("config/auto-follow.json must define a non-empty keywords array");
  }

  // Resolution order per field: JSON value → CLI flag → default.
  const pick = <T>(fromJson: T | undefined, fromFlag: T | undefined, dflt: T): T =>
    fromJson !== undefined ? fromJson : fromFlag !== undefined ? fromFlag : dflt;

  return {
    apiKey: requireEnv("TWITTERAPI_IO_KEY"),
    xUser: requireEnv("X_USER"),
    xEmail: requireEnv("X_EMAIL"),
    xPassword: requireEnv("X_PASSWORD"),
    xTotp: process.env["X_TOTP"],
    keywords: file.keywords,
    queryType: file.queryType ?? "Latest",
    intervalMinutes: pick(file.intervalMinutes, flags.intervalMinutes, 60),
    perKeyword: pick(file.perKeyword, flags.perKeyword, 30),
    keywordsPerCycle: pick(file.keywordsPerCycle, flags.keywordsPerCycle, 3),
    maxPerRun: pick(file.maxPerRun, flags.maxPerRun, 25),
    dryRun: pick(file.dryRun, flags.dryRun, true),
    storageStatePath: resolveStorageStatePath(),
    statePath: path.join(process.cwd(), ".auth", "auto-follow-state.json"),
  };
}
