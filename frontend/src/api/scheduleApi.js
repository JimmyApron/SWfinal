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

export async function getMyConfirmedSchedules(userId) {
  const { data: memberships, error: memberError } = await supabase
    .from("room_members")
    .select("roomid, rooms(roomname)")
    .eq("userid", userId);

  if (memberError) throw new Error("방 목록 조회 실패");

  const roomIds = memberships.map((m) => m.roomid);
  if (roomIds.length === 0) return [];

  const [{ data, error }, { data: dismissed }, { data: myResponses }] = await Promise.all([
    supabase
      .from("confirmed_schedules")
      .select("*")
      .in("roomid", roomIds)
      .gte("date", new Date().toISOString().slice(0, 10))
      .order("date", { ascending: true }),
    supabase
      .from("dismissed_schedules")
      .select("scheduleid")
      .eq("userid", userId),
    supabase
      .from("voteresponses")
      .select("optionid")
      .eq("userid", userId),
  ]);

  if (error) throw new Error("확정 일정 조회 실패");

  const dismissedIds = new Set((dismissed || []).map((d) => d.scheduleid));
  const myOptionIds = new Set((myResponses || []).map((r) => r.optionid));

  // votes 테이블에서 confirmedoptionid 조회 (confirmed_schedules에는 없음)
  const voteIds = (data || []).filter((s) => s.voteid).map((s) => s.voteid);
  const voteConfirmedMap = {};
  if (voteIds.length > 0) {
    const { data: votes } = await supabase
      .from("votes")
      .select("id, confirmedoptionid")
      .in("id", voteIds);
    (votes || []).forEach((v) => { voteConfirmedMap[v.id] = v.confirmedoptionid; });
  }

  return data
    .filter((s) => {
      if (dismissedIds.has(s.id)) return false;
      if (!s.voteid) return true;
      const confirmedOptionId = voteConfirmedMap[s.voteid];
      return confirmedOptionId ? myOptionIds.has(confirmedOptionId) : false;
    })
    .map((s) => {
      const membership = memberships.find((m) => m.roomid === s.roomid);
      return { ...s, roomname: membership?.rooms?.roomname || "" };
    });
}

export async function dismissConfirmedSchedule(userId, scheduleId) {
  const { error } = await supabase
    .from("dismissed_schedules")
    .insert([{ userid: userId, scheduleid: scheduleId }]);

  if (error) throw new Error("숨기기 실패");
}

export async function updateConfirmedScheduleLocation(scheduleId, location, locationAddress) {
  const { error } = await supabase
    .from("confirmed_schedules")
    .update({ location, locationaddress: locationAddress || null })
    .eq("id", scheduleId);

  if (error) {
    console.error("위치 저장 실패 상세:", JSON.stringify(error));
    throw new Error("위치 저장 실패");
  }
}

export async function cancelConfirmedSchedule(scheduleId, voteid) {
  const { error: deleteError } = await supabase
    .from("confirmed_schedules")
    .delete()
    .eq("id", scheduleId);

  if (deleteError) throw new Error("확정 일정 취소 실패");

  if (voteid) {
    await supabase
      .from("votes")
      .update({ confirmedoptionid: null })
      .eq("id", voteid);
  }
}