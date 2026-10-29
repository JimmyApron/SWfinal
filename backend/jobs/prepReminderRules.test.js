const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getPrepReminderIdempotencyKey,
  getSharedShortages,
  isWithinPrepReminderRecoveryWindow,
} = require("./prepReminderRules");

test("shortage counts only unique confirmed assignments, not pending requests", () => {
  const items = [{ id: 10, kind: "shared", name: "텐트", neededcount: 3 }];
  const assignments = [
    { itemid: 10, memberid: "u1", membertype: "member", status: "assigned" },
    { itemid: 10, memberid: "u1", membertype: "member", status: "assigned" },
    { itemid: 10, memberid: "u2", membertype: "member", status: "requested" },
  ];

  assert.deepEqual(getSharedShortages(items, assignments), [
    { ...items[0], confirmedCount: 1, shortageCount: 2 },
  ]);
});

test("fully staffed shared items do not produce a shortage", () => {
  const items = [{ id: 11, kind: "shared", name: "돗자리", neededcount: 2 }];
  const assignments = [
    { itemid: 11, memberid: "u1", membertype: "member", status: "assigned" },
    { itemid: 11, memberid: "g1", membertype: "guest", status: "assigned" },
  ];

  assert.deepEqual(getSharedShortages(items, assignments), []);
});

test("the reminder key is stable per schedule, attendee, and travel date", () => {
  const person = { id: "u1", type: "member" };
  assert.equal(
    getPrepReminderIdempotencyKey(25, person, "2026-11-01"),
    getPrepReminderIdempotencyKey(25, person, "2026-11-01")
  );
  assert.notEqual(
    getPrepReminderIdempotencyKey(25, person, "2026-11-01"),
    getPrepReminderIdempotencyKey(26, person, "2026-11-01")
  );
  assert.notEqual(
    getPrepReminderIdempotencyKey(25, person, "2026-11-01"),
    getPrepReminderIdempotencyKey(25, { id: "u2", type: "member" }, "2026-11-01")
  );
});

test("KST reminder recovery covers 20:00 through 23:59 only", () => {
  assert.equal(isWithinPrepReminderRecoveryWindow(new Date("2026-10-29T11:00:00Z")), true);
  assert.equal(isWithinPrepReminderRecoveryWindow(new Date("2026-10-29T14:59:00Z")), true);
  assert.equal(isWithinPrepReminderRecoveryWindow(new Date("2026-10-29T10:59:00Z")), false);
  assert.equal(isWithinPrepReminderRecoveryWindow(new Date("2026-10-29T15:00:00Z")), false);
});
