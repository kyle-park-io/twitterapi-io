import { test } from "node:test";
import assert from "node:assert/strict";
import { assertUnfollowLanded } from "../BrowserFollowService";

test("a confirmed flip back to Follow is an unfollow", () => {
  assert.doesNotThrow(() => assertUnfollowLanded("spammer", true, true));
});

test("a slow flip after a confirmed dialog click is still an unfollow", () => {
  // The confirm button was found and clicked, so the unfollow was submitted;
  // only the UI confirmation was slow.
  assert.doesNotThrow(() => assertUnfollowLanded("spammer", true, false));
});

test("no dialog and no flip throws instead of reporting an unfollow", () => {
  // If the confirmationSheetConfirm test id ever drifts, nothing is clicked and
  // nothing changes. Reporting "unfollowed" would blocklist an account we still
  // follow — permanently, and the blocklist filters the cleanup target list, so
  // one selector change would make every remaining target un-cleanable.
  assert.throws(
    () => assertUnfollowLanded("spammer", false, false),
    /was not confirmed/
  );
});

test("a flip with no dialog is accepted (the UI variant needed no confirmation)", () => {
  assert.doesNotThrow(() => assertUnfollowLanded("spammer", false, true));
});
