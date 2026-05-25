import { supabase } from "../lib/supabaseClient";

export async function getScheduleCandidates(roomId) {
  const { data, error } = await supabase
    .from("schedule_candidates")
    .select("*")
    .eq("roomid", Number(roomId))
    .order("date", { ascending: true });

  if (error) throw new Error("후보 일정 조회 실패");

  return data;
}

export async function getRoomMembers(roomId) {
  const { data, error } = await supabase
    .from("room_members")
    .select("*")
    .eq("roomid", Number(roomId));

  if (error) throw new Error("멤버 조회 실패");

  return data;
}

export async function getMemberAvailabilities(roomId) {
  const { data, error } = await supabase
    .from("member_availabilities")
    .select("*")
    .eq("roomid", Number(roomId));

  if (error) throw new Error("멤버 일정 조회 실패");

  return data;
}

export async function saveMemberAvailabilities(roomId, userId, rows) {
  const { error: deleteError } = await supabase
    .from("member_availabilities")
    .delete()
    .eq("roomid", Number(roomId))
    .eq("userid", userId);

  if (deleteError) throw new Error("기존 일정 삭제 실패");

  const { error: insertError } = await supabase
    .from("member_availabilities")
    .insert(rows);

  if (insertError) throw new Error("가능 일정 저장 실패");
}
export async function updateRoomLastActivity(roomId) {
  const { error } = await supabase
    .from("rooms")
    .update({
      lastactivityat: new Date().toISOString(),
    })
    .eq("id", Number(roomId));

  if (error) {
    console.error("방 활동 시간 갱신 실패:", error);
  }
}
export async function addScheduleCandidate(candidate) {
  const { error } = await supabase
    .from("schedule_candidates")
    .insert([candidate]);

  if (error) {
    console.error("후보 일정 추가 실패:", error);
    throw new Error("후보 일정 추가 실패");
  }
}

export async function updateScheduleCandidate(candidateId, updateData) {
  const { error: updateError } = await supabase
    .from("schedule_candidates")
    .update(updateData)
    .eq("id", candidateId);

  if (updateError) {
    console.error("후보 일정 수정 실패:", updateError);
    throw new Error("후보 일정 수정 실패");
  }

  // 수정된 시간 범위 밖의 멤버 일정 삭제
  if (!updateData.isallday) {
    const { error: deleteError } = await supabase
      .from("member_availabilities")
      .delete()
      .eq("candidateid", candidateId)
      .or(
        `starttime.lt.${updateData.starttime},endtime.gt.${updateData.endtime}`
      );

    if (deleteError) {
      console.error("범위 밖 멤버 일정 삭제 실패:", deleteError);
      throw new Error("범위 밖 멤버 일정 삭제 실패");
    }
  }
}

export async function deleteScheduleCandidate(candidateId) {
  const { error } = await supabase
    .from("schedule_candidates")
    .delete()
    .eq("id", candidateId);

  if (error) {
    console.error("후보 일정 삭제 실패:", error);
    throw new Error("후보 일정 삭제 실패");
  }
}