import { supabase } from "../lib/supabaseClient";
import { getFinalizedCourse, readResult } from "./courseFinalizationApi";
import { getCurrentRoomParticipantInfo } from "./courseApi";
import { orderedStops } from "../utils/courseRoadmapUtils";
import { createRoomMessage } from "./chatMessageApi";
import { getApiBaseUrl } from "./apiBaseUrl";

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

// 확정 코스 해제·수정은 브라우저에서 직접 쓸 수 없어 백엔드(/api/course)를 거친다.
async function postCourseApi(path, payload, fallbackMessage) {
  const headers = { "Content-Type": "application/json" };
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const guestId = localStorage.getItem("guest_id");
  if (guestId) headers["X-Guest-Id"] = guestId;

  const response = await fetch(`${getApiBaseUrl()}/course${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // JSON 본문이 없는 404는 서버가 이 API를 모르는 것(백엔드 미재시작)이다.
    if (response.status === 404 && !body) throw new Error("서버에 이 기능이 아직 반영되지 않았어요. 백엔드를 다시 시작해 주세요.");
    throw new Error(body?.message || fallbackMessage);
  }
  return body;
}

// 최종 확정을 해제해 코스를 다시 정할 수 있게 한다.
export function resetFinalizedCourse(scheduleId) {
  return postCourseApi("/reset-finalization", { scheduleId }, "코스 확정을 해제하지 못했습니다.");
}

// 확정된 코스의 방문 장소를 통째로 바꾼다. (course: buildCourseVoteDbRows 결과 모양)
export function updateFinalizedCourseStops(scheduleId, course) {
  return postCourseApi("/update-stops", { scheduleId, course }, "코스를 수정하지 못했습니다.");
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
