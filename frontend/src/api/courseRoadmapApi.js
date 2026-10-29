import { supabase } from "../lib/supabaseClient";
import { getFinalizedCourse, readResult } from "./courseFinalizationApi";
import { getCurrentRoomParticipantInfo } from "./courseApi";
import { orderedStops } from "../utils/courseRoadmapUtils";
import { createRoomMessage } from "./chatMessageApi";

export async function getFinalizedRoadmap(roomId, scheduleId, expectedCourseId = null) {
  if (!/^[1-9]\d*$/.test(String(roomId)) || !/^[1-9]\d*$/.test(String(scheduleId))) throw new Error("유효하지 않은 모임 또는 일정입니다.");
  await getCurrentRoomParticipantInfo(roomId);
  const schedule = await readResult(supabase.from("confirmed_schedules").select("*")
    .eq("id", scheduleId).eq("roomid", Number(roomId)).single());
  if (!schedule) throw new Error("해당 모임의 일정을 조회할 수 없습니다.");
  const finalization = await getFinalizedCourse(scheduleId);
  if (!finalization) return null;
  if (String(finalization.course.room_id) !== String(roomId) || String(finalization.course.schedule_id) !== String(scheduleId) ||
      (expectedCourseId !== null && String(finalization.course_id) !== String(expectedCourseId))) {
    throw new Error("공유된 코스와 최종 확정 정보가 일치하지 않습니다.");
  }
  const room = await readResult(supabase.from("rooms").select("id, roomname").eq("id", Number(roomId)).single());
  return { ...finalization, schedule, room,
    course: { ...finalization.course, stops: orderedStops(finalization.course.stops) } };
}

export async function shareFinalizedCourse(roomId, scheduleId) {
  const roadmap = await getFinalizedRoadmap(roomId, scheduleId);
  if (!roadmap) throw new Error("최종 확정된 코스가 없습니다.");
  const participant = await getCurrentRoomParticipantInfo(roomId);
  const isMember = participant.participantType === "member";
  const profile = await readResult(isMember
    ? supabase.from("profiles").select("nickname, profileimageurl").eq("id", participant.participantId).single()
    : supabase.from("room_guests").select("nickname").eq("id", participant.participantId).eq("roomid", Number(roomId)).single());
  const content = JSON.stringify({ __type: "finalized_course", version: 1,
    roomId: String(roomId), scheduleId: String(roadmap.schedule_id), courseId: String(roadmap.course_id) });
  try {
    const { error } = await createRoomMessage({
      roomid: Number(roomId), userid: participant.participantId,
      nickname: profile?.nickname || (isMember ? "회원" : "게스트"),
      profileimageurl: profile?.profileimageurl || null, content, imageurl: null,
    });
    if (error) throw error;
    return { sent: true };
  } catch (error) {
    throw new Error("공유 전송 결과를 확인하지 못했습니다. 채팅방을 확인한 후 다시 시도해 주세요. 응답 유실 시 재시도로 중복 메시지가 전송될 수 있습니다.");
  }
}
