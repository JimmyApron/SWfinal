import { hasFixedTimetableConflict } from "./fixedTimetableUtils";

const thursdayBlock = [{ weekday: 4, starttime: "15:00", endtime: "16:00" }];

test("detects partial and full overlap on the same weekday", () => {
  expect(hasFixedTimetableConflict(thursdayBlock, "2026-10-29", "14:30", "15:30")).toBe(true);
  expect(hasFixedTimetableConflict(thursdayBlock, "2026-10-29", "15:00", "16:00")).toBe(true);
});

test("treats touching interval boundaries as available", () => {
  expect(hasFixedTimetableConflict(thursdayBlock, "2026-10-29", "14:00", "15:00")).toBe(false);
  expect(hasFixedTimetableConflict(thursdayBlock, "2026-10-29", "16:00", "17:00")).toBe(false);
});

test("checks weekday and all-day schedules correctly", () => {
  expect(hasFixedTimetableConflict(thursdayBlock, "2026-10-30", "15:00", "16:00")).toBe(false);
  expect(hasFixedTimetableConflict(thursdayBlock, "2026-10-29", "00:00", "24:00", true)).toBe(true);
});
