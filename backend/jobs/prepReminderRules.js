function getSharedShortages(items, assignments) {
  const assignedByItem = new Map();

  for (const assignment of assignments || []) {
    if (assignment.status !== "assigned") continue;
    const people = assignedByItem.get(assignment.itemid) || new Set();
    people.add(`${assignment.membertype}:${assignment.memberid}`);
    assignedByItem.set(assignment.itemid, people);
  }

  return (items || [])
    .filter((item) => item.kind === "shared")
    .map((item) => {
      const confirmedCount = assignedByItem.get(item.id)?.size || 0;
      return {
        ...item,
        confirmedCount,
        shortageCount: Math.max(0, Number(item.neededcount || 1) - confirmedCount),
      };
    })
    .filter((item) => item.shortageCount > 0);
}

function getPrepReminderIdempotencyKey(scheduleId, participant, scheduleDate) {
  return `prep_reminder:${scheduleId}:${participant.type}:${participant.id}:${scheduleDate}`;
}

function isWithinPrepReminderRecoveryWindow(now) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hour = shifted.getUTCHours();
  return hour >= 20 && hour < 24;
}

module.exports = {
  getPrepReminderIdempotencyKey,
  getSharedShortages,
  isWithinPrepReminderRecoveryWindow,
};
