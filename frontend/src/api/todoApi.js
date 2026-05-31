import { supabase } from "../lib/supabaseClient";

export async function getTodos(userId) {
  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .eq("userid", userId)
    .order("createdat", { ascending: false });

  if (error) throw new Error("할일 조회 실패");
  return data || [];
}

export async function createTodo({ userId, title, duedate, duetime, reminder }) {
  const { data, error } = await supabase
    .from("todos")
    .insert([{
      userid: userId,
      title,
      duedate: duedate || null,
      duetime: duetime || null,
      reminder: reminder || "none",
      iscompleted: false,
    }])
    .select()
    .single();

  if (error) throw new Error("할일 추가 실패");
  return data;
}

export async function toggleTodo(id, iscompleted) {
  const { error } = await supabase
    .from("todos")
    .update({ iscompleted })
    .eq("id", id);

  if (error) throw new Error("할일 상태 변경 실패");
}

export async function updateTodo(id, { title, duedate, duetime, reminder }) {
  const { error } = await supabase
    .from("todos")
    .update({ title, duedate: duedate || null, duetime: duetime || null, reminder: reminder || "none" })
    .eq("id", id);
  if (error) throw new Error("할일 수정 실패");
}

export async function deleteTodo(id) {
  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) throw new Error("할일 삭제 실패");
}
