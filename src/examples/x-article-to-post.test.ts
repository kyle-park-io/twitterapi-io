import { test } from "node:test";
import assert from "node:assert/strict";
import { truncate } from "./x-article-to-post";

test("a short summary is left alone", () => {
  assert.equal(truncate("짧은 요약입니다.", 160), "짧은 요약입니다.");
});

test("a long summary is cut at a sentence when one fits", () => {
  const text =
    "This article demonstrates how to analyze real-time WebSocket stream data from Polymarket. " +
    "We focus specifically on Flip events, examining data quality and timing patterns.";
  const got = truncate(text, 160);
  assert.ok(got.endsWith("."), `should end on a sentence, got: ${got}`);
  assert.ok(!got.endsWith("..."), "a sentence cut needs no ellipsis");
  assert.ok(got.length <= 160);
});

test("a summary with no sentence break is cut at a word, never mid-word", () => {
  // What this replaces: "We focus spe..." - a cut on the character count
  // alone, which reads as a broken string rather than a summary.
  const text = "a".repeat(40) + " " + "b".repeat(200);
  const got = truncate(text, 160);
  assert.ok(got.endsWith("..."));
  assert.ok(
    !/[a-z]\.\.\.$/.test(got.replace(/b+\.\.\.$/, "")) ||
      got.startsWith("a".repeat(40)),
  );
  assert.ok(got.length <= 164);
});

test("Korean sentences are cut on their own terminator", () => {
  const text =
    "지난 7월 온라인 스트리밍에서 RFQ를 다뤘습니다. " +
    "리서칭 과정이 생각보다 재미있었고 그 내용을 아티클로 정리했습니다. " +
    "그리고 여기에 아주 긴 문장이 하나 더 이어집니다 " +
    "가".repeat(120);
  const got = truncate(text, 160);
  assert.ok(got.endsWith("."), `got: ${got}`);
  assert.ok(got.length <= 160);
});
