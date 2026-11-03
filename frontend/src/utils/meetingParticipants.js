export function getMeetingParticipantUserIds(meeting) {
  return [...new Set((meeting?.participant_user_ids || []).filter(Boolean).map(String))];
}

export function getMeetingMembers(meeting, roomMembers = []) {
  if (meeting?.source_type !== "lightning") return roomMembers;
  const participantIds = new Set(getMeetingParticipantUserIds(meeting));
  return roomMembers.filter((member) => participantIds.has(String(member.userid)));
}

export function scopeMeetingDiaryProgress(meeting, progress) {
  if (meeting?.source_type !== "lightning" || !progress) return progress;
  const participantIds = new Set(getMeetingParticipantUserIds(meeting));
  const publishedIds = [...new Set((progress.published_member_ids || []).map(String))]
    .filter((id) => participantIds.has(id));
  return { ...progress, target_count: participantIds.size,
    published_count: publishedIds.length, published_member_ids: publishedIds };
}
