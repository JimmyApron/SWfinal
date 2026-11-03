import { isMeetingVisibleInSharedCalendar as visible } from "./meetingCalendarVisibility";
const meeting = { source_type: "confirmed_schedule", source_schedule_id: null, lifecycle_status: "unknown", meeting_date: "2026-11-04", start_time: "15:00:00", updated_at: "2026-11-04T05:00:00Z" };
test("deleted future meetings stay hidden", () => { expect(visible(meeting)).toBe(false); });
test("deleted past meetings stay visible in Seoul time", () => { expect(visible({ ...meeting, start_time: "13:00:00" })).toBe(true); });
test("cancelled meetings follow deletion time", () => {
  expect(visible({ ...meeting, source_schedule_id: 1, lifecycle_status: "cancelled" })).toBe(false);
  expect(visible({ ...meeting, lifecycle_status: "cancelled", meeting_date: "2026-11-03" })).toBe(true);
});
test("active and lightning meetings remain visible", () => {
  expect(visible({ ...meeting, source_schedule_id: 1, lifecycle_status: "scheduled" })).toBe(true);
  expect(visible({ ...meeting, source_type: "lightning", lifecycle_status: "scheduled" })).toBe(true);
});
test("all-day meetings must have ended before deletion", () => {
  expect(visible({ ...meeting, is_all_day: true })).toBe(false);
  expect(visible({ ...meeting, is_all_day: true, meeting_date: "2026-11-03" })).toBe(true);
});
test("missing deletion timestamp stays hidden", () => { expect(visible({ ...meeting, updated_at: null })).toBe(false); });
