import { supabase } from "../lib/supabaseClient";

export async function getPersonalEvents(userId) {
  const { data, error } = await supabase
    .from("personal_events")
    .select("*")
    .eq("userid", userId)
    .order("date", { ascending: true });

  if (error) throw new Error("개인 일정 조회 실패");
  return data;
}

export async function createPersonalEvent(event) {
  const { error } = await supabase.from("personal_events").insert([event]);
  if (error) throw new Error("개인 일정 추가 실패");
}

export async function updatePersonalEvent(id, updates) {
  const { error } = await supabase
    .from("personal_events")
    .update(updates)
    .eq("id", id);
  if (error) throw new Error("개인 일정 수정 실패");
}

export async function deletePersonalEvent(id) {
  const { error } = await supabase
    .from("personal_events")
    .delete()
    .eq("id", id);
  if (error) throw new Error("개인 일정 삭제 실패");
}

// 방 공용 캘린더용: 내 개인 일정 전체 + 이 방에 등록된 팀원 일정 (기간 겹침 기준)
export async function getRoomSharedEvents(roomId, userId, firstDay, lastDay) {
  // 방 일정의 반복은 시작일 이후 계속되므로 기간 조건 없이 repeat 일정도 함께 가져온다
  const overlap = `repeat.neq.none,enddate.gte.${firstDay},and(enddate.is.null,date.gte.${firstDay})`;
  const [mine, shared] = await Promise.all([
    supabase.from("personal_events").select("*").eq("userid", userId).lte("date", lastDay).or(overlap),
    supabase.from("personal_events").select("*").contains("roomids", [Number(roomId)]).neq("userid", userId).lte("date", lastDay).or(overlap),
  ]);
  if (mine.error || shared.error) throw new Error("공용 캘린더 일정 조회 실패");
  return [...(mine.data || []), ...(shared.data || [])].sort((a, b) => `${a.date}${a.starttime || ""}`.localeCompare(`${b.date}${b.starttime || ""}`));
}

// 알림용: 내가 속한 방에 다른 팀원이 등록한 일정 (RLS로 내 방 일정만 조회됨)
export async function getTeammateRoomEvents(userId) {
  const { data, error } = await supabase.from("personal_events").select("*").not("roomids", "eq", "{}").neq("userid", userId);
  if (error) throw new Error("방 일정 조회 실패");
  return data || [];
}
