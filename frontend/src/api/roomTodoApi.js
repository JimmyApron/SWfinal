import { supabase } from "../lib/supabaseClient";

// lastDay 이전에 시작한 방 공동 할 일 (반복 할 일은 시작일 이후 계속되므로 기간 하한 없음)
export async function getRoomTodos(roomId, lastDay) {
  const { data, error } = await supabase.from("room_todos").select("*").eq("roomid", Number(roomId)).lte("date", lastDay).order("date", { ascending: true });
  if (error) throw new Error("공동 할 일을 불러오지 못했습니다.");
  return data || [];
}

export async function getRoomTodoCompletions(todoIds, firstDay, lastDay) {
  if (!todoIds.length) return [];
  const { data, error } = await supabase.from("room_todo_completions").select("todoid, occurrencedate, userid").in("todoid", todoIds).gte("occurrencedate", firstDay).lte("occurrencedate", lastDay);
  if (error) throw new Error("완료 현황을 불러오지 못했습니다.");
  return data || [];
}

export async function createRoomTodo(todo) {
  const { error } = await supabase.from("room_todos").insert([todo]);
  if (error) throw new Error("공동 할 일을 추가하지 못했습니다.");
}

export async function updateRoomTodo(id, updates) {
  const { error } = await supabase.from("room_todos").update(updates).eq("id", id);
  if (error) throw new Error("공동 할 일을 수정하지 못했습니다.");
}

export async function deleteRoomTodo(id) {
  const { error } = await supabase.from("room_todos").delete().eq("id", id);
  if (error) throw new Error("공동 할 일을 삭제하지 못했습니다.");
}

export async function setRoomTodoDone({ todoId, date, userId, done }) {
  const query = done
    ? supabase.from("room_todo_completions").upsert([{ todoid: todoId, occurrencedate: date, userid: userId }], { onConflict: "todoid,occurrencedate,userid", ignoreDuplicates: true })
    : supabase.from("room_todo_completions").delete().eq("todoid", todoId).eq("occurrencedate", date).eq("userid", userId);
  const { error } = await query;
  if (error) throw new Error("완료 상태를 저장하지 못했습니다.");
}

// 알림용: 내가 속한 모든 방의 알림 설정된 할 일 (RLS로 내 방만 조회됨)
export async function getReminderRoomTodos() {
  const { data, error } = await supabase.from("room_todos").select("*").neq("reminder", "none");
  if (error) throw new Error("방 할 일 조회 실패");
  return data || [];
}

// 홈 캘린더용: 내가 속한 모든 방의 공동 할 일 (RLS로 내 방만 조회됨)
export async function getMyRoomTodos(lastDay) {
  const { data, error } = await supabase.from("room_todos").select("*").lte("date", lastDay).order("date", { ascending: true });
  if (error) throw new Error("방 공동 할 일을 불러오지 못했습니다.");
  return data || [];
}

export async function hasCompletedRoomTodo(todoId, date, userId) {
  const { data } = await supabase.from("room_todo_completions").select("todoid").eq("todoid", todoId).eq("occurrencedate", date).eq("userid", userId).maybeSingle();
  return Boolean(data);
}
