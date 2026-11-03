import { getMeetingMembers, scopeMeetingDiaryProgress } from "./meetingParticipants";
const members = [{ userid: "me" }, { userid: "friend" }, { userid: "other" }];

test("solo lightning meeting shows only its creator", () => {
  expect(getMeetingMembers({ source_type: "lightning", participant_user_ids: ["me"] }, members)).toEqual([members[0]]);
});
test("selected companions are included without adding the rest of the room", () => {
  expect(getMeetingMembers({ source_type: "lightning", participant_user_ids: ["me", "friend"] }, members)).toEqual(members.slice(0, 2));
});
test("confirmed schedules keep the room-member behavior", () => {
  expect(getMeetingMembers({ source_type: "confirmed_schedule" }, members)).toBe(members);
});
test("lightning diary counts include only actual participants", () => {
  const progress = { target_count: 3, published_count: 2, published_member_ids: ["me", "other"] };
  expect(scopeMeetingDiaryProgress({ source_type: "lightning", participant_user_ids: ["me", "friend"] }, progress))
    .toEqual({ target_count: 2, published_count: 1, published_member_ids: ["me"] });
  expect(scopeMeetingDiaryProgress({ source_type: "confirmed_schedule" }, progress)).toBe(progress);
});
