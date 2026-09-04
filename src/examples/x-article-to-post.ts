/*
  Turns one of my X long-form articles into a post for the blog at
  jungho.dev, ready to commit to the content repo (kyle-park-io/blog).

  Usage:
    pnpm example:x-article -- <tweet-id-or-url> --slug <slug> [--out <dir>]
    pnpm example:x-article -- <tweet-id-or-url> --slug <slug> --list

  The tweet is the one carrying the article, not the article id: that is what
  twitterapi.io's /twitter/article takes.

  It writes <out>/<slug>/index.md with the frontmatter the blog's schema
  requires, and downloads the article's images next to it, because the blog
  colocates a post's images with the post.
*/

import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config";
import { TwitterClient } from "../client/TwitterClient";
import { articleToMarkdown, type ArticleBlock } from "../articles/toMarkdown";

interface ArticleResponse {
  article?: {
    title?: string;
    preview_text?: string;
    cover_media_img_url?: string;
    createdAt?: string;
    contents?: ArticleBlock[];
  };
}

/** Accepts a bare id, a status URL, or anything ending in the id. */
function tweetId(input: string): string {
  const match = input.match(/(\d{10,})/);
  if (!match) throw new Error(`Could not find a tweet id in "${input}"`);
  return match[1];
}

/** `Mon Aug 10 07:30:24 +0000 2026` -> `2026-08-10`, the schema's format. */
function isoDate(twitterDate: string | undefined): string {
  const parsed = twitterDate ? new Date(twitterDate) : new Date();
  const usable = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return usable.toISOString().slice(0, 10);
}

/**
 * A summary for the frontmatter, from the article's own preview.
 *
 * The preview is the opening of the article, newlines and all, and often
 * starts with a greeting. Take the first sentence that carries something,
 * and keep it short enough to sit under a title in a list.
 */
function summarise(preview: string | undefined): string {
  if (!preview) return "";

  // The preview is the article's opening, newlines and all, and these
  // articles open with a greeting and a self-introduction. Neither says what
  // the piece is about, so skip past them to the first line that does.
  const GREETING = /^(안녕하세요|반갑습니다|hi[ ,!]|hello[ ,!])/i;
  const lines = preview
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 15 && !GREETING.test(line));

  const first = lines[0] ?? preview.trim().split("\n")[0] ?? "";
  return truncate(first, 160);
}

/**
 * Shortens to a whole sentence where one fits, and otherwise to a whole
 * word. Cutting on the character count alone ended a summary mid-word
 * ("We focus spe..."), which reads as a broken string rather than a summary.
 */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;

  const head = text.slice(0, limit);

  const sentenceEnd = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("다. "),
  );
  if (sentenceEnd > limit * 0.5) {
    return text.slice(0, sentenceEnd + 1);
  }

  const wordEnd = head.lastIndexOf(" ");
  const cut = wordEnd > limit * 0.5 ? wordEnd : limit - 1;
  return `${text.slice(0, cut).trimEnd()}...`;
}

/** YAML-safe: the schema reads these with a line-based parser. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function download(url: string, to: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} fetching ${url}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(to, body);
}

/** Flags that take a value, so a positional is not confused with one. */
const VALUE_FLAGS = ["--slug", "--out"];

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at !== -1 ? args[at + 1] : undefined;
}

/**
 * The first argument that is neither a flag nor a flag's value.
 *
 * `pnpm run x -- <args>` passes the `--` through verbatim, so it has to be
 * dropped here rather than assumed away.
 */
function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg.startsWith("--")) {
      if (VALUE_FLAGS.includes(arg)) i++;
      continue;
    }
    return arg;
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const target = positional(args);
  if (!target) {
    console.error(
      "Usage: pnpm example:x-article -- <tweet-id-or-url> --slug <slug> [--out <dir>] [--list]",
    );
    process.exit(1);
  }

  const client = new TwitterClient(loadConfig().apiKey);
  const response = await client.get<ArticleResponse>("/twitter/article", {
    tweet_id: tweetId(target),
  });

  const article = response.article;
  if (!article?.contents?.length) {
    throw new Error("That tweet carries no article body");
  }

  const { markdown, images } = articleToMarkdown(article.contents);

  if (args.includes("--list")) {
    console.log(`title   : ${article.title}`);
    console.log(`date    : ${isoDate(article.createdAt)}`);
    console.log(`summary : ${summarise(article.preview_text)}`);
    console.log(`images  : ${images.length}`);
    console.log(`words   : ${markdown.split(/\s+/).length}`);
    console.log(`\n--- first 40 lines ---\n`);
    console.log(markdown.split("\n").slice(0, 40).join("\n"));
    return;
  }

  const slug = flag(args, "--slug");
  if (!slug) throw new Error("--slug is required (it becomes the post's URL)");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`--slug must be lowercase kebab-case, got "${slug}"`);
  }

  const outRoot =
    flag(args, "--out") ?? path.join(process.cwd(), "output", "posts");
  const dir = path.join(outRoot, slug);
  fs.mkdirSync(dir, { recursive: true });

  // The cover, if there is one, leads the post: the blog's list page shows a
  // featured block only for a post that has one.
  let cover = "";
  if (article.cover_media_img_url) {
    cover = "cover.jpg";
    await download(article.cover_media_img_url, path.join(dir, cover));
  }

  for (const image of images) {
    await download(image.url, path.join(dir, image.fileName));
    console.log(`  image ${image.fileName}`);
  }

  const frontmatter = [
    "---",
    `title: ${quote(article.title ?? slug)}`,
    `date: ${isoDate(article.createdAt)}`,
    `summary: ${quote(summarise(article.preview_text))}`,
    "tags: []",
    "lang: ko",
    ...(cover ? [`cover: ./${cover}`] : []),
    "---",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(dir, "index.md"), frontmatter + markdown, "utf8");
  console.log(`\nWrote ${path.join(dir, "index.md")}`);
  console.log(
    `Fill in tags before committing: the schema requires lowercase kebab-case.`,
  );
}

// Only when run as a script. Without this, importing the module to test its
// helpers ran main(), which exits(1) on the missing arguments.
if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
