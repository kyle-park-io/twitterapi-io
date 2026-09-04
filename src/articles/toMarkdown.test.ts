import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyInlineStyles,
  articleToMarkdown,
  imageFileName,
} from "./toMarkdown";

test("bold and italic ranges become Markdown markers", () => {
  const got = applyInlineStyles("첫째, RFQ는 만능이 아닙니다.", [
    { offset: 0, length: 3, style: "Bold" },
  ]);
  assert.equal(got, "**첫째,** RFQ는 만능이 아닙니다.");
});

test("several ranges in one line all survive", () => {
  // Applying ranges left to right shifts every offset after the first
  // insertion, so they are applied from the end backwards.
  const got = applyInlineStyles(
    "참여 자격 — 계좌 개설·심사 → 지갑만 있으면 됨",
    [
      { offset: 0, length: 5, style: "Bold" },
      { offset: 19, length: 9, style: "Bold" },
    ],
  );
  assert.equal(got, "**참여 자격** — 계좌 개설·심사 → **지갑만 있으면 됨**");
});

test("a range that swallows its trailing space still closes", () => {
  // `**bold ** text` closes nothing in Markdown; the space moves outside.
  const got = applyInlineStyles("bold text", [
    { offset: 0, length: 5, style: "Bold" },
  ]);
  assert.equal(got, "**bold** text");
});

test("an unknown style is left alone rather than dropped", () => {
  const got = applyInlineStyles("plain", [
    { offset: 0, length: 5, style: "Underline" },
  ]);
  assert.equal(got, "plain");
});

test("a range past the end of the text is ignored", () => {
  const got = applyInlineStyles("short", [
    { offset: 3, length: 99, style: "Bold" },
  ]);
  assert.equal(got, "short");
});

test("emoji outside the BMP do not shift the offsets", () => {
  // Draft.js counts UTF-16 code units and so does JavaScript string
  // indexing, so a surrogate pair costs two in both.
  const got = applyInlineStyles("🔥 hot take", [
    { offset: 3, length: 3, style: "Bold" },
  ]);
  assert.equal(got, "🔥 **hot** take");
});

test("headings, lists, quotes and rules convert", () => {
  const { markdown } = articleToMarkdown([
    { type: "header-two", text: "0. TL;DR" },
    { type: "unstyled", text: "본문 문단." },
    { type: "unordered-list-item", text: "첫 항목" },
    { type: "unordered-list-item", text: "둘째 항목" },
    { type: "ordered-list-item", text: "순서 하나" },
    { type: "blockquote", text: "인용" },
    { type: "divider" },
  ]);
  assert.equal(
    markdown,
    [
      "## 0. TL;DR",
      "",
      "본문 문단.",
      "",
      "- 첫 항목",
      "- 둘째 항목",
      "1. 순서 하나",
      "",
      "> 인용",
      "",
      "---",
      "",
    ].join("\n"),
  );
});

test("a top-level heading becomes h2, because the title is the page's h1", () => {
  // The blog's frontmatter check rejects a body containing an `# ` heading:
  // the title comes from the frontmatter and owns the only h1.
  const { markdown } = articleToMarkdown([
    { type: "header-one", text: "Overview" },
  ]);
  assert.equal(markdown, "## Overview\n");
  assert.ok(!/^# /m.test(markdown));
});

test("a markdown block passes through untouched", () => {
  // These carry fenced code. Styling them would corrupt the code.
  const code = "```shell\nTotal flip events:  30,670\n```";
  const { markdown } = articleToMarkdown([{ type: "markdown", text: code }]);
  assert.equal(markdown, code + "\n");
});

test("images are collected and referenced by a local file name", () => {
  const { markdown, images } = articleToMarkdown([
    {
      type: "image",
      url: "https://pbs.twimg.com/media/AAA.jpg",
      width: 4096,
      height: 3056,
    },
    { type: "unstyled", text: "사이" },
    { type: "image", url: "https://pbs.twimg.com/media/BBB.png" },
  ]);
  assert.deepEqual(
    images.map((i) => i.fileName),
    ["image-01.jpg", "image-02.png"],
  );
  assert.ok(markdown.includes("![](./image-01.jpg)"));
  assert.ok(markdown.includes("![](./image-02.png)"));
  assert.deepEqual(
    images.map((i) => i.url),
    [
      "https://pbs.twimg.com/media/AAA.jpg",
      "https://pbs.twimg.com/media/BBB.png",
    ],
  );
});

test("an image with no usable extension is saved as jpg", () => {
  assert.equal(
    imageFileName("https://pbs.twimg.com/media/AAA", 0),
    "image-01.jpg",
  );
  assert.equal(
    imageFileName("https://pbs.twimg.com/media/AAA.jpg?name=orig", 4),
    "image-05.jpg",
  );
  assert.equal(
    imageFileName("https://pbs.twimg.com/media/AAA.PNG", 1),
    "image-02.png",
  );
});

test("empty paragraphs do not become blank lines in the output", () => {
  const { markdown } = articleToMarkdown([
    { type: "unstyled", text: "첫 문단" },
    { type: "unstyled", text: "" },
    { type: "unstyled", text: "   " },
    { type: "unstyled", text: "둘째 문단" },
  ]);
  assert.equal(markdown, "첫 문단\n\n둘째 문단\n");
});

test("an unknown block type still contributes its text", () => {
  // Better a paragraph than a silently dropped sentence.
  const { markdown } = articleToMarkdown([
    { type: "code-block", text: "something new" },
  ]);
  assert.equal(markdown, "something new\n");
});

test("a heading drops its inline styles rather than showing the markers", () => {
  // The Polymarket article's own "**Abstract**" heading came through as
  // `## **Abstract**`, asterisks and all. A heading is already emphatic.
  const { markdown } = articleToMarkdown([
    {
      type: "header-two",
      text: "Abstract",
      inlineStyleRanges: [{ offset: 0, length: 8, style: "Bold" }],
    },
  ]);
  assert.equal(markdown, "## Abstract\n");
});

test("a range that runs into a letter uses HTML, because ** would not close", () => {
  // CommonMark will not close emphasis against a letter on both sides, and
  // Korean runs a word straight into its particle. Eighteen of these reached
  // a built page as literal asterisks.
  const got = applyInlineStyles("라우터 경유율 14.5%입니다", [
    { offset: 8, length: 5, style: "Bold" },
  ]);
  assert.equal(got, "라우터 경유율 <strong>14.5%</strong>입니다");
});

test("a range with punctuation or space on both sides keeps plain markers", () => {
  const got = applyInlineStyles("가격은 (중요) 합니다", [
    { offset: 4, length: 4, style: "Bold" },
  ]);
  assert.equal(got, "가격은 **(중요)** 합니다");
});

test("a tilde in prose is escaped, not read as strikethrough", () => {
  // An article wrote a range as "40~65%", and GFM rendered "40<del>65%</del>".
  assert.equal(
    applyInlineStyles("블루칩에서 40~65%", undefined),
    "블루칩에서 40\\~65%",
  );
});

test("markdown syntax in prose is escaped so it renders as written", () => {
  assert.equal(
    applyInlineStyles("a * b _ c ` d [e] <f>", undefined),
    "a \\* b \\_ c \\` d \\[e\\] \\<f\\>",
  );
});

test("escaping does not shift a style range", () => {
  // The ranges index the original text, so escaping happens after the
  // slicing, never before it.
  const got = applyInlineStyles("40~65% 입니다", [
    { offset: 0, length: 6, style: "Bold" },
  ]);
  assert.equal(got, "**40\\~65%** 입니다");
});

test("a code block is never escaped", () => {
  // markdown blocks carry real Markdown - fenced code - and bypass the
  // inline path entirely.
  const code = "```js\nconst a = b * c; // [note]\n```";
  const { markdown } = articleToMarkdown([{ type: "markdown", text: code }]);
  assert.equal(markdown, code + "\n");
});

test("a heading written by hand as a bold paragraph becomes a real heading", () => {
  // X's editor does not offer headings everywhere, so an article wrote all
  // twelve of its sections as `**# Introduction**`. Left as paragraphs they
  // render as literal hashes, and the post gets no table of contents.
  const { markdown } = articleToMarkdown([
    {
      type: "unstyled",
      text: "# Introduction",
      inlineStyleRanges: [{ offset: 0, length: 14, style: "Bold" }],
    },
    { type: "unstyled", text: "## Why it is hard" },
    { type: "unstyled", text: "Body text." },
  ]);
  assert.equal(
    markdown,
    "## Introduction\n\n### Why it is hard\n\nBody text.\n",
  );
});

test("a hash with no space after it stays prose", () => {
  // CommonMark needs a space after the hashes for an ATX heading, so `#1`
  // is not one and needs no escaping either.
  const { markdown } = articleToMarkdown([
    { type: "unstyled", text: "#1 우선순위는 성능입니다" },
  ]);
  assert.equal(markdown, "#1 우선순위는 성능입니다\n");
  assert.ok(!markdown.startsWith("## "));
});

test("markers the author typed inside a styled range are dropped", () => {
  // One article has `**fully on-chain orderbook**` as the text of a bold
  // range: a Markdown habit carried into a WYSIWYG editor. Kept, it renders
  // as bold text with literal asterisks around it.
  const got = applyInlineStyles("it is a **fully on-chain orderbook** here", [
    { offset: 8, length: 28, style: "Bold" },
  ]);
  assert.equal(got, "it is a **fully on-chain orderbook** here");
  assert.ok(!got.includes("****"));
});

test("asterisks that are not wrapping the whole range are kept and escaped", () => {
  // A lone asterisk in prose is a character, not a marker.
  const got = applyInlineStyles("rate * factor", undefined);
  assert.equal(got, "rate \\* factor");
});

test("a Markdown link the author wrote survives escaping", () => {
  // One article's "Learn More" section is a list of hand-written links.
  // Escaping their brackets turned each into literal text followed by a
  // naked URL in parentheses.
  const got = applyInlineStyles(
    "GitHub Repository: [injective-core](https://github.com/InjectiveFoundation/injective-core)",
    undefined,
  );
  assert.equal(
    got,
    "GitHub Repository: [injective-core](https://github.com/InjectiveFoundation/injective-core)",
  );
});

test("a bare URL keeps its underscores", () => {
  // `_` inside a URL would be escaped to `\_` and break the link.
  const got = applyInlineStyles(
    "see https://example.com/a_b_c for more",
    undefined,
  );
  assert.equal(got, "see https://example.com/a_b_c for more");
});

test("syntax outside a link is still escaped", () => {
  const got = applyInlineStyles(
    "40~65% at [docs](https://x.dev/a_b) and * more",
    undefined,
  );
  assert.equal(got, "40\\~65% at [docs](https://x.dev/a_b) and \\* more");
});
