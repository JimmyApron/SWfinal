import { supabase } from "../lib/supabaseClient";
import { getApiBaseUrl } from "./apiBaseUrl";
import { getRoomParticipants } from "./mapApi";

function throwOnError(error, message) {
  if (error) {
    console.error(message, error);
    throw new Error(message);
  }
}

async function requestPrepBackend(path, options = {}) {
  const response = await fetch(`${getApiBaseUrl()}/prep${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || "준비물 서비스를 사용할 수 없습니다.");
  }
  return data;
}

// userLocation({ lat, lng })은 확정/함께 가고 싶은 장소가 없을 때만 서버가 날씨 기준으로 쓴다.
export async function getPrepWeather(scheduleId, userLocation = null) {
  const query = userLocation
    ? `?lat=${encodeURIComponent(userLocation.lat)}&lng=${encodeURIComponent(userLocation.lng)}`
    : "";
  return requestPrepBackend(`/weather/${encodeURIComponent(scheduleId)}${query}`);
}

export async function recommendPrepItems(scheduleId, regenerate = false, userLocation = null, createdBy = null) {
  return requestPrepBackend("/recommend", {
    method: "POST",
    body: JSON.stringify({
      scheduleId,
      regenerate,
      ...(createdBy ? { createdBy } : {}),
      ...(userLocation ? { userLocation: { lat: userLocation.lat, lng: userLocation.lng } } : {}),
    }),
  });
}

export const PREP_EVENT_CATEGORIES = [
  { value: "meal", label: "🍽️ 식사·카페" },
  { value: "drink", label: "🍻 술자리" },
  { value: "birthday", label: "🎂 생일·기념일" },
  { value: "concert", label: "🎤 콘서트·공연" },
  { value: "sports", label: "⚾ 스포츠·관람" },
  { value: "trip", label: "🧳 여행·MT" },
  { value: "picnic", label: "🧺 피크닉·야외" },
  { value: "study", label: "📚 스터디·회의" },
  { value: "etc", label: "기타" },
];

export async function getPrepContext(scheduleId) {
  const { data, error } = await supabase
    .from("prep_contexts")
    .select("category, note")
    .eq("scheduleid", Number(scheduleId))
    .maybeSingle();

  throwOnError(error, "약속 종류를 불러오지 못했습니다.");
  return { category: data?.category || null, note: data?.note || "" };
}

export async function savePrepContext(scheduleId, { category, note }, participant) {
  const { error } = await supabase.from("prep_contexts").upsert(
    {
      scheduleid: Number(scheduleId),
      category: category || null,
      note: note?.trim() || null,
      updatedby: participant.id,
      updatedbytype: participant.type,
      updatedat: new Date().toISOString(),
    },
    { onConflict: "scheduleid" }
  );

  throwOnError(error, "약속 종류를 저장하지 못했습니다.");
}

export async function getPrepSchedule(scheduleId) {
  const { data: schedule, error } = await supabase
    .from("confirmed_schedules")
    .select("*")
    .eq("id", Number(scheduleId))
    .maybeSingle();

  throwOnError(error, "일정 정보를 불러오지 못했습니다.");
  if (!schedule) throw new Error("일정을 찾을 수 없습니다.");

  const participants = await getRoomParticipants(schedule.roomid);
  const attendees = participants.map((participant) => {
    const isGuest = participant.participantType === "guest";
    const id = isGuest ? participant.guestid : participant.userid;
    const profile = participant.profiles || {};

    return {
      id: String(id),
      type: isGuest ? "guest" : "member",
      nickname:
        profile.nickname || participant.nickname || (isGuest ? "비회원" : String(id)),
      profileimageurl: profile.profileimageurl || null,
    };
  });

  return {
    schedule,
    attendees,
    absentees: (schedule.absentees || []).map(String),
  };
}

export async function getPrepData(scheduleId, participant) {
  const { data: items, error: itemError } = await supabase
    .from("prep_items")
    .select("*")
    .eq("scheduleid", Number(scheduleId))
    .order("sortorder", { ascending: true })
    .order("id", { ascending: true });

  throwOnError(itemError, "준비물 목록을 불러오지 못했습니다.");

  const itemIds = (items || []).map((item) => item.id);
  if (itemIds.length === 0) {
    return { items: [], assignments: [], checks: [] };
  }

  const [{ data: assignments, error: assignmentError }, { data: checks, error: checkError }] =
    await Promise.all([
      supabase.from("prep_assignments").select("*").in("itemid", itemIds),
      participant
        ? supabase
            .from("prep_checks")
            .select("*")
            .in("itemid", itemIds)
            .eq("memberid", participant.id)
            .eq("membertype", participant.type)
        : Promise.resolve({ data: [], error: null }),
    ]);

  throwOnError(assignmentError, "준비 담당자를 불러오지 못했습니다.");
  throwOnError(checkError, "준비 체크 상태를 불러오지 못했습니다.");

  return {
    items: items || [],
    assignments: assignments || [],
    checks: checks || [],
  };
}

export async function addPrepItem({
  scheduleId,
  roomId,
  name,
  kind,
  neededCount,
  memo,
  createdBy,
}) {
  const { data, error } = await supabase
    .from("prep_items")
    .insert({
      scheduleid: Number(scheduleId),
      roomid: Number(roomId),
      name: name.trim(),
      kind,
      neededcount: kind === "shared" ? Number(neededCount) : 1,
      memo: memo.trim() || null,
      source: "manual",
      createdby: createdBy.id,
      createdbytype: createdBy.type,
      sortorder: Math.floor(Date.now() / 1000),
    })
    .select("*")
    .single();

  throwOnError(error, "준비물을 추가하지 못했습니다.");
  return data;
}

export async function updatePrepItem(itemId, { name, memo }) {
  const { error } = await supabase
    .from("prep_items")
    .update({
      name: name.trim(),
      memo: memo.trim() || null,
    })
    .eq("id", itemId);

  throwOnError(error, "준비물을 수정하지 못했습니다.");
}

export async function deletePrepItem(itemId) {
  const { error } = await supabase.from("prep_items").delete().eq("id", itemId);
  throwOnError(error, "준비물을 삭제하지 못했습니다.");
}

export async function setPrepCheck(itemId, participant, checked) {
  const { error } = await supabase.from("prep_checks").upsert(
    {
      itemid: itemId,
      memberid: participant.id,
      membertype: participant.type,
      checked,
      updatedat: new Date().toISOString(),
    },
    { onConflict: "itemid,membertype,memberid" }
  );

  throwOnError(error, "체크 상태를 저장하지 못했습니다.");
}

export async function getPrepAssignmentCount(itemId) {
  const { count, error } = await supabase
    .from("prep_assignments")
    .select("id", { count: "exact", head: true })
    .eq("itemid", itemId)
    .in("status", ["assigned", "requested"]);

  throwOnError(error, "담당 현황을 확인하지 못했습니다.");
  return count || 0;
}

export async function claimPrepItem(itemId, participant, note = null) {
  const { count, error: countError } = await supabase
    .from("prep_assignments")
    .select("id", { count: "exact", head: true })
    .eq("itemid", itemId)
    .in("status", ["assigned", "requested"]);

  throwOnError(countError, "담당 현황을 확인하지 못했습니다.");
  if ((count || 0) > 0) {
    const { data: item, error: itemError } = await supabase
      .from("prep_items")
      .select("neededcount")
      .eq("id", itemId)
      .single();
    throwOnError(itemError, "준비물 정보를 확인하지 못했습니다.");
    if ((count || 0) >= item.neededcount) {
      throw new Error("담당 자리가 모두 찼습니다.");
    }
  }

  const { data, error } = await supabase
    .from("prep_assignments")
    .insert({
      itemid: itemId,
      memberid: participant.id,
      membertype: participant.type,
      note: note?.trim() || null,
      status: "assigned",
      isdone: false,
    })
    .select("*")
    .single();

  throwOnError(error, "담당을 확정하지 못했습니다.");
  return data;
}

export async function requestPrepAssignment(itemId, participant, requester, note) {
  const { count, error: countError } = await supabase
    .from("prep_assignments")
    .select("id", { count: "exact", head: true })
    .eq("itemid", itemId)
    .in("status", ["assigned", "requested"]);

  throwOnError(countError, "담당 현황을 확인하지 못했습니다.");

  const { data: item, error: itemError } = await supabase
    .from("prep_items")
    .select("neededcount")
    .eq("id", itemId)
    .single();

  throwOnError(itemError, "준비물 정보를 확인하지 못했습니다.");
  if ((count || 0) >= item.neededcount) {
    throw new Error("담당 자리가 모두 찼습니다.");
  }

  const { data, error } = await supabase
    .from("prep_assignments")
    .insert({
      itemid: itemId,
      memberid: participant.id,
      membertype: participant.type,
      note: note?.trim() || null,
      status: "requested",
      requestedby: requester.id,
      requestedbytype: requester.type,
      isdone: false,
    })
    .select("*")
    .single();

  throwOnError(error, "부탁을 보내지 못했습니다.");
  return data;
}

export async function removePrepAssignment(assignmentId, participant) {
  const { data, error } = await supabase
    .from("prep_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("memberid", participant.id)
    .eq("membertype", participant.type)
    .select("id, itemid, status")
    .maybeSingle();

  throwOnError(error, "담당을 취소하지 못했습니다.");
  if (!data) throw new Error("담당 상태가 이미 변경되었습니다.");
  return data;
}

export async function updatePrepAssignment(assignmentId, participant, changes) {
  const { error } = await supabase
    .from("prep_assignments")
    .update(changes)
    .eq("id", assignmentId)
    .eq("memberid", participant.id)
    .eq("membertype", participant.type);

  throwOnError(error, "담당 정보를 저장하지 못했습니다.");
}

export async function addPrepSeat(itemId, neededCount) {
  const { error } = await supabase
    .from("prep_items")
    .update({ neededcount: neededCount + 1 })
    .eq("id", itemId);

  throwOnError(error, "담당 자리를 추가하지 못했습니다.");
}

export async function handlePrepRequest(assignmentId, participant, accepted) {
  let query = supabase
    .from("prep_assignments")
    .select("*, prep_items(name, scheduleid, roomid)")
    .eq("id", assignmentId)
    .eq("memberid", participant.id)
    .eq("membertype", participant.type)
    .eq("status", "requested");

  const { data: assignment, error: readError } = await query.maybeSingle();
  throwOnError(readError, "부탁 내용을 불러오지 못했습니다.");
  if (!assignment) throw new Error("이미 처리된 부탁입니다.");

  if (accepted) {
    const { data: updated, error } = await supabase
      .from("prep_assignments")
      .update({ status: "assigned" })
      .eq("id", assignmentId)
      .eq("status", "requested")
      .select("id")
      .maybeSingle();
    throwOnError(error, "부탁을 수락하지 못했습니다.");
    if (!updated) throw new Error("이미 처리되었거나 담당 자리가 모두 찼습니다.");
  } else {
    const { data: deleted, error } = await supabase
      .from("prep_assignments")
      .delete()
      .eq("id", assignmentId)
      .eq("status", "requested")
      .select("id")
      .maybeSingle();
    throwOnError(error, "부탁을 거절하지 못했습니다.");
    if (!deleted) throw new Error("이미 처리되었거나 취소된 부탁입니다.");
  }

  return assignment;
}

export async function cancelPrepRequest(assignmentId, requester) {
  const { data, error } = await supabase
    .from("prep_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("requestedby", requester.id)
    .eq("requestedbytype", requester.type)
    .eq("status", "requested")
    .select("id, memberid, membertype, itemid")
    .maybeSingle();

  throwOnError(error, "부탁을 취소하지 못했습니다.");
  if (!data) throw new Error("이미 처리되었거나 취소된 부탁입니다.");
  return data;
}
