// Compare with deletion time so removed future meetings never reappear later.
export function isMeetingVisibleInSharedCalendar(meeting) {
  const removed = meeting.lifecycle_status === "cancelled"
    || (meeting.source_type === "confirmed_schedule" && !meeting.source_schedule_id);
  if (!removed) return true;
  const removedAt = Date.parse(meeting.updated_at);
  if (!Number.isFinite(removedAt) || !meeting.meeting_date) return false;
  // Dates and times are stored in Seoul time; all-day meetings end at midnight.
  const allDay = meeting.is_all_day || !meeting.start_time;
  const start = Date.parse(`${meeting.meeting_date}T${allDay ? "00:00:00" : meeting.start_time}+09:00`);
  const historyAt = allDay ? start + 86400000 : start;
  return Number.isFinite(historyAt) && historyAt < removedAt;
}
