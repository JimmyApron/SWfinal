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
