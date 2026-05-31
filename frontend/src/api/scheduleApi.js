import { supabase } from "../lib/supabaseClient";
import { createRoomNotifications } from "./notificationApi";
import { updateRoomLastActivity } from "./roomApi";

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

export async function getRoomGuests(roomId) {
  const { data, error } = await supabase
    .from("room_guests")
    .select("*")
    .eq("roomid", Number(roomId));

  if (error) throw new Error("게스트 조회 실패");

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

export async function getMyConfirmedSchedules(userId, { includeLocationOnly = false } = {}) {
  const { data: memberships, error: memberError } = await supabase
    .from("room_members")
    .select("roomid, rooms(roomname)")
    .eq("userid", userId);

  if (memberError) throw new Error("방 목록 조회 실패");

  const roomIds = memberships.map((m) => m.roomid);
  if (roomIds.length === 0) return [];

  const [{ data, error }, { data: dismissed }] = await Promise.all([
    supabase
      .from("confirmed_schedules")
      .select("*")
      .in("roomid", roomIds)
      .or(`date.gte.${new Date().toISOString().slice(0, 10)},date.is.null`)
      .order("date", { ascending: true }),
    supabase
      .from("dismissed_schedules")
      .select("scheduleid")
      .eq("userid", userId),
  ]);
  if (error) throw new Error("확정 일정 조회 실패");

  const dismissedIds = new Set((dismissed || []).map((d) => d.scheduleid));
  const visibleSchedules = data
    .filter((s) => !dismissedIds.has(s.id))
    .map((s) => {
      const membership = memberships.find((m) => m.roomid === s.roomid);
      return { ...s, roomname: membership?.rooms?.roomname || "" };
    });

  if (!includeLocationOnly) return visibleSchedules;

  return visibleSchedules;
}

export async function createConfirmedScheduleForRoom(roomId, schedule) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  const { error } = await supabase.from("confirmed_schedules").insert([
    {
      roomid: Number(roomId),
      title: schedule.title?.trim() || null,
      date: schedule.date,
      starttime: schedule.starttime || null,
      endtime: schedule.endtime || null,
      isallday: !schedule.starttime,
      location: schedule.location || null,
      locationaddress: schedule.locationaddress || null,
    },
  ]);

  if (error) {
    console.error("확정 일정 저장 실패:", error);
    throw new Error("확정 일정 저장 실패");
  }

  // 알림 생성
  try {
    await createRoomNotifications({
      roomId,
      senderId: userId,
      type: "schedule_confirmed",
      title: "🗓️ 일정 확정",
      message: "확정된 일정이 추가되었습니다.",
      link: `/rooms/${roomId}?tab=schedule`,
    });
  } catch (notifError) {
    console.error("일정 확정 알림 생성 실패:", notifError);
  }
}

export async function getAdditionalConfirmedLocations(roomId, scheduleId = null) {
  let query = supabase
    .from("confirmed_locations")
    .select("id, placename, voteid, scheduleid")
    .eq("roomid", Number(roomId))
    .order("createdat", { ascending: true });

  if (scheduleId !== null) {
    query = query.eq("scheduleid", Number(scheduleId));
  }

  const { data, error } = await query;

  if (error) {
    console.error("추가 위치 조회 실패:", error);
    throw new Error("추가 위치 조회 실패");
  }

  const voteIds = (data || [])
    .map((location) => location.voteid)
    .filter(Boolean);
  const { data: votes, error: voteError } = voteIds.length > 0
    ? await supabase
        .from("votes")
        .select("id, title, votetype, locationkind")
        .in("id", voteIds)
    : { data: [], error: null };

  if (voteError) {
    console.error("추가 위치 투표 조회 실패:", voteError);
    throw new Error("추가 위치 조회 실패");
  }

  const voteMap = new Map((votes || []).map((vote) => [vote.id, vote]));

  return (data || []).filter((location) => {
    if (!location.voteid) return true;
    const vote = voteMap.get(location.voteid);
    if (vote?.locationkind === "middle") return false;
    if (vote?.locationkind === "additional") return true;
    return vote?.title?.replace(/\s/g, "") !== "중간장소투표";
  });
}

export async function addAdditionalConfirmedLocation(roomId, scheduleId, placeName) {
  const { data, error } = await supabase
    .from("confirmed_locations")
    .insert([{
      roomid: Number(roomId),
      scheduleid: Number(scheduleId),
      placename: placeName,
      voteid: null,
    }])
    .select("id, placename, scheduleid")
    .single();

  if (error) {
    console.error("추가 위치 저장 실패:", error);
    throw new Error("추가 위치 저장 실패");
  }

  return data;
}

export async function getRoomConfirmedSchedules(roomId) {
  const { data, error } = await supabase
    .from("confirmed_schedules")
    .select("*")
    .eq("roomid", Number(roomId))
    .order("date", { ascending: true, nullsFirst: true });

  if (error) throw new Error("확정 일정 조회 실패");
  return data || [];
}

export async function applyConfirmedLocationToSchedule(scheduleId, location, isMiddlePlace) {
  if (isMiddlePlace) {
    const { error } = await supabase
      .from("confirmed_schedules")
      .update({
        location: location.placename,
        locationaddress: location.placeaddress || null,
        locationlat: location.placelat ?? null,
        locationlng: location.placelng ?? null,
      })
      .eq("id", Number(scheduleId));

    if (error) throw new Error("일정 위치 저장 실패");
    return;
  }

  const { error } = await supabase.from("confirmed_locations").insert([{
    roomid: Number(location.roomid),
    scheduleid: Number(scheduleId),
    voteid: Number(location.voteid),
    placename: location.placename,
  }]);

  if (error) throw new Error("추가 장소 저장 실패");
}

export async function createLocationOnlyConfirmedSchedule(location, isMiddlePlace) {
  const { data, error } = await supabase
    .from("confirmed_schedules")
    .insert([{
      roomid: Number(location.roomid),
      title: null,
      date: null,
      starttime: null,
      endtime: null,
      isallday: false,
      location: isMiddlePlace ? location.placename : null,
      locationaddress: isMiddlePlace ? location.placeaddress || null : null,
      locationlat: isMiddlePlace ? location.placelat ?? null : null,
      locationlng: isMiddlePlace ? location.placelng ?? null : null,
    }])
    .select("id")
    .single();

  if (error) throw new Error("날짜 없는 일정 생성 실패");

  if (!isMiddlePlace) {
    await applyConfirmedLocationToSchedule(data.id, location, false);
  }

  // 알림 생성
  try {
    const { data: userData } = await supabase.auth.getUser();
    await createRoomNotifications({
      roomId: location.roomid,
      senderId: userData.user?.id,
      type: "schedule_confirmed",
      title: "🗓️ 일정 확정",
      message: "확정된 일정이 추가되었습니다.",
      link: `/rooms/${location.roomid}?tab=schedule`,
    });
  } catch (notifError) {
    console.error("일정 확정 알림 생성 실패:", notifError);
  }

  return data;
}

export async function dismissConfirmedSchedule(userId, scheduleId) {
  const { error } = await supabase
    .from("dismissed_schedules")
    .insert([{ userid: userId, scheduleid: scheduleId }]);

  if (error) throw new Error("숨기기 실패");
}

export async function updateConfirmedScheduleLocation(
  scheduleId,
  location,
  locationAddress,
  locationLat = null,
  locationLng = null
) {
  const { error } = await supabase
    .from("confirmed_schedules")
    .update({
      location,
      locationaddress: locationAddress || null,
      locationlat: locationLat,
      locationlng: locationLng,
    })
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
