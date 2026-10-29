import { supabase } from "../lib/supabaseClient";
import { ensureScheduleExists, getCurrentRoomParticipantInfo } from "./courseApi";
import { assertCourseChangesAllowed } from "./courseFinalizationApi";

async function checked(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export function getParticipantKey(participant) {
  if (!["member", "guest"].includes(participant.participantType) || !participant.participantId) {
    throw new Error("참여자 정보가 올바르지 않습니다.");
  }
  return `${participant.participantType}:${participant.participantId}`;
}

// Resolve identity and all relationships from DB; never trust a supplied course ID.
export async function getCourseConfirmationContext(voteId, roomId) {
  const vote = await checked(supabase.from("votes").select("id, roomid, scheduleid, votetype")
    .eq("id", Number(voteId)).single());
  if (vote.votetype !== "course" || !vote.scheduleid || String(vote.roomid) !== String(roomId)) {
    throw new Error("해당 모임·일정의 코스 투표가 아닙니다.");
  }
  await ensureScheduleExists(vote.scheduleid, Number(roomId));
  const participant = await getCurrentRoomParticipantInfo(roomId);
  const participantKey = getParticipantKey(participant);
  const responses = await checked(supabase.from("voteresponses").select("id, optionid, userid")
    .eq("voteid", vote.id).eq("userid", participant.participantId));
  let course = null;
  let optionId = null;
  if (responses.length === 1) {
    optionId = responses[0].optionid;
    course = await resolveCourseOption(vote, optionId);
  }
  const confirmation = await checked(supabase.from("course_member_confirmations").select("*")
    .eq("schedule_id", vote.scheduleid).eq("participant_key", participantKey)
    .eq("is_active", true).maybeSingle());
  return { vote, participant, participantKey, responses, optionId, course, confirmation,
    isConfirmed: Boolean(course && confirmation && String(confirmation.course_id) === String(course.id)) };
}

export async function resolveCourseOption(vote, optionId) {
  await checked(supabase.from("voteoptions").select("id").eq("id", Number(optionId))
    .eq("voteid", vote.id).eq("optiontype", "course").single());
  const link = await checked(supabase.from("vote_course_links").select("course_id")
    .eq("vote_id", vote.id).eq("vote_option_id", Number(optionId)).single());
  const course = await checked(supabase.from("courses").select("id, room_id, schedule_id")
    .eq("id", link.course_id).single());
  if (String(course.room_id) !== String(vote.roomid) || String(course.schedule_id) !== String(vote.scheduleid)) {
    throw new Error("다른 모임·일정의 코스는 선택할 수 없습니다.");
  }
  return course;
}

export const getMyCourseConfirmation = getCourseConfirmationContext;

export async function confirmMyVotedCourse(voteId, roomId, expectedCourseId) {
  const context = await getCourseConfirmationContext(voteId, roomId);
  const { vote, participant, participantKey, course, confirmation } = context;
  await assertCourseChangesAllowed(vote.scheduleid);
  if (!course) throw new Error("먼저 코스 하나에 투표해 주세요.");
  if (expectedCourseId != null && String(expectedCourseId) !== String(course.id)) {
    throw new Error("본인이 투표한 코스만 확정할 수 있습니다.");
  }
  if (confirmation) {
    if (context.isConfirmed) return context;
    throw new Error("기존 활성 확정이 있습니다. 투표 상태를 다시 확인해 주세요.");
  }
  const { error } = await supabase.from("course_member_confirmations").insert([{
    schedule_id: vote.scheduleid, course_id: course.id,
    participant_type: participant.participantType, participant_key: participantKey,
    member_user_id: participant.participantType === "member" ? participant.participantId : null,
    guest_id: participant.participantType === "guest" ? participant.participantId : null,
    is_active: true,
  }]);
  // The existing partial UNIQUE index arbitrates concurrent duplicate clicks.
  if (error && error.code !== "23505") throw error;
  const saved = await getCourseConfirmationContext(voteId, roomId);
  if (!saved.isConfirmed) throw new Error("확정 상태가 변경되었습니다. 다시 확인해 주세요.");
  return saved;
}

export async function deactivateCourseConfirmation(context) {
  await assertCourseChangesAllowed(context.vote.scheduleid);
  if (!context.confirmation) return;
  const rows = await checked(supabase.from("course_member_confirmations")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", context.confirmation.id).eq("participant_key", context.participantKey)
    .eq("is_active", true).select("id"));
  if (rows.length !== 1) throw new Error("확정 해제 상태를 확인하지 못했습니다.");
}

export async function submitCourseVote(vote, optionIds, userId, nickname) {
  const context = await getCourseConfirmationContext(vote.id, vote.roomid);
  await assertCourseChangesAllowed(context.vote.scheduleid);
  if (String(context.participant.participantId) !== String(userId) || optionIds.length !== 1) {
    throw new Error("현재 참여자의 코스 하나만 투표할 수 있습니다.");
  }
  await resolveCourseOption(context.vote, optionIds[0]);
  if (context.responses.length > 1) throw new Error("기존 복수 응답을 확인해 주세요.");
  const previous = context.responses[0];
  if (previous && String(previous.optionid) === String(optionIds[0])) return context.responses;
  const payload = { voteid: vote.id, optionid: optionIds[0], userid: userId, nickname };
  const rows = await checked(previous
    ? supabase.from("voteresponses").update(payload).eq("id", previous.id).eq("userid", userId).select("id")
    : supabase.from("voteresponses").insert([payload]).select("id"));
  if (rows.length !== 1) throw new Error("투표 저장 상태를 확인하지 못했습니다.");
  try {
    await deactivateCourseConfirmation(context);
  } catch (error) {
    // Best-effort compensation only; a DB transaction is required for cross-tab atomicity.
    try {
      if (previous) await checked(supabase.from("voteresponses").update({ optionid: previous.optionid })
        .eq("id", rows[0].id).eq("optionid", optionIds[0]));
      else await checked(supabase.from("voteresponses").delete().eq("id", rows[0].id));
    } catch (rollbackError) {
      throw new Error("투표 변경 후 확정 해제와 응답 복구에 실패했습니다. 새로고침 후 상태를 확인해 주세요.");
    }
    throw error;
  }
  return [payload];
}
