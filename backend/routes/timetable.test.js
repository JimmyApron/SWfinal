const assert = require("node:assert/strict");
const timetableRouter = require("./timetable");

const normalized = timetableRouter.normalizeClasses({
  classes: [
    { weekday: 2, start: "10:10", end: "11:05" },
    { weekday: 9, start: "13:00", end: "14:00" },
  ],
});

assert.deepEqual(normalized, {
  classes: [{ weekday: 2, starttime: "10:00", endtime: "11:30" }],
  partial: true,
});
assert.deepEqual(timetableRouter.normalizeClasses({ classes: [{ weekday: 1, start: "12:00", end: "12:00" }] }), {
  classes: [],
  partial: false,
});
console.log("timetable OCR normalization tests passed");
