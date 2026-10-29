const test = require("node:test");
const assert = require("node:assert/strict");
const { getReminderTargets, getShareProgress, isSettlementSchemaError, isShareConfirmed } = require("./settlementRules");

test("sent status alone is not settlement completion", () => {
  const shares = [
    { amount: 300, sentat: "2026-10-29T08:00:00Z", sentamount: 300 },
    { amount: 700, sentat: null, confirmedat: null },
  ];
  assert.deepEqual(getShareProgress(shares), { total: 2, settled: 0, confirmed: 0 });
});

test("legacy rows remain readable before the snapshot migration is applied", () => {
  assert.equal(isShareConfirmed({ amount: 100, confirmedat: "2026-10-29T08:00:00Z" }), true);
  assert.deepEqual(
    getShareProgress([{ amount: 100, sentat: "2026-10-29T08:00:00Z" }, { amount: 50, confirmedat: "2026-10-29T08:00:00Z" }]),
    { total: 2, settled: 1, confirmed: 1 }
  );
});

test("missing settlement RPCs and columns are identified as unapplied schema", () => {
  assert.equal(isSettlementSchemaError({ code: "PGRST202" }), true);
  assert.equal(isSettlementSchemaError({ code: "PGRST204" }), true);
  assert.equal(isSettlementSchemaError({ code: "23505", message: "duplicate key" }), false);
});

test("completion uses only a confirmation for the current amount", () => {
  const shares = [
    { amount: 300, confirmedat: "2026-10-29T08:00:00Z", confirmedamount: 300 },
    { amount: 700, confirmedat: "2026-10-29T08:00:00Z", confirmedamount: 600, reconfirmrequired: true },
    { amount: 0, confirmedat: null },
  ];
  assert.deepEqual(getShareProgress(shares), { total: 2, settled: 1, confirmed: 1 });
  assert.equal(isShareConfirmed(shares[1]), false);
});

test("manual reminders include positive unpaid shares, dedupe identities, and exclude actor and payer", () => {
  const shares = [
    { memberid: "payer", membertype: "member", amount: 500 },
    { memberid: "u1", membertype: "member", amount: 200 },
    { memberid: "u1", membertype: "member", amount: 200 },
    { memberid: "u2", membertype: "member", amount: 300, sentat: "2026-10-29T08:00:00Z", sentamount: 300 },
    { memberid: "u3", membertype: "member", amount: 0 },
    { memberid: "u4", membertype: "member", amount: 400, sentat: "2026-10-29T08:00:00Z", sentamount: 300 },
    { memberid: "u5", membertype: "member", amount: 100, confirmedat: "2026-10-29T08:00:00Z", confirmedamount: 100 },
  ];
  const targets = getReminderTargets(shares, "member:payer", "member:u1");
  assert.deepEqual(targets.map(({ memberid }) => memberid), ["u4"]);
});
