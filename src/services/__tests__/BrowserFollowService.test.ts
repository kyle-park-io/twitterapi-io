import { test } from "node:test";
import assert from "node:assert/strict";
import { assertUnfollowLanded } from "../BrowserFollowService";

// `acted` = we clicked something that submits the unfollow (a confirmation
// dialog on a normal profile, or the dropdown menu item on a profile with
// creator Subscriptions enabled).
// `gone`  = the followed-state button disappeared afterwards.

test("acted and gone is an unfollow", () => {
  assert.doesNotThrow(() => assertUnfollowLanded("spammer", true, true));
});

test("acting without the button going away is a failure, not a slow success", () => {
  // Measured on @BossMon_02: the menu item was clicked, the button stayed, and
  // the account was still followed on X. Assuming success here blocklists an
  // account we still follow — permanently, since the blocklist filters the
  // cleanup list. Throwing costs one safe retry instead.
  assert.throws(() => assertUnfollowLanded("spammer", true, false), /was submitted/);
});

test("neither acted nor gone throws instead of reporting an unfollow", () => {
  // If both the confirmationSheetConfirm test id and the menu item drift,
  // nothing is clicked and nothing changes. Reporting "unfollowed" would
  // blocklist an account we still follow — permanently, and the blocklist
  // filters the cleanup target list, so one selector change would make every
  // remaining target un-cleanable.
  assert.throws(() => assertUnfollowLanded("spammer", false, false), /was not confirmed/);
});

test("the error names both interactions, so a drift is diagnosable", () => {
  // The subscription-menu variant was found only because the error said which
  // selector it had waited on. Keep both names in the message.
  assert.throws(
    () => assertUnfollowLanded("spammer", false, false),
    /confirmationSheetConfirm[\s\S]*Unfollow @spammer" menu item/
  );
});

test("gone without acting is accepted (the variant needed no second click)", () => {
  assert.doesNotThrow(() => assertUnfollowLanded("spammer", false, true));
});
