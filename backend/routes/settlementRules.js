function isShareSent(share) {
  if (!share?.sentat) return false;
  if (!Object.prototype.hasOwnProperty.call(share, "sentamount")) return true;
  return Number(share.sentamount) === Number(share.amount);
}

function isShareConfirmed(share) {
  if (!share?.confirmedat || share.reconfirmrequired) return false;
  if (!Object.prototype.hasOwnProperty.call(share, "confirmedamount")) return true;
  return Number(share.confirmedamount) === Number(share.amount);
}

function getShareProgress(shares) {
  const eligible = (shares || []).filter((share) => Number(share.amount) > 0);
  const confirmed = eligible.filter(isShareConfirmed).length;
  return { total: eligible.length, settled: confirmed, confirmed };
}

function getReminderTargets(shares, payerKey, actorKey) {
  const unique = new Map();
  for (const share of shares || []) {
    const identity = `${share.membertype}:${share.memberid}`;
    const needsPayment = Number(share.amount) > 0 && !isShareConfirmed(share) && !isShareSent(share);
    if (!needsPayment || identity === payerKey || identity === actorKey) continue;
    unique.set(identity, share);
  }
  return [...unique.values()];
}

function isSettlementSchemaError(error) {
  return ["PGRST202", "PGRST204", "42883", "42703"].includes(error?.code)
    || /function .* does not exist|could not find the .* column|column .* does not exist/i.test(error?.message || "");
}

module.exports = { getReminderTargets, getShareProgress, isSettlementSchemaError, isShareConfirmed, isShareSent };
