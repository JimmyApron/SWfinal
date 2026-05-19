import { supabase } from "../lib/supabaseClient";

export async function getRooms() {
  const { data, error } = await supabase
    .from("rooms")
    .select(`
      *,
      room_members(count)
    `)
    .order("createdat", { ascending: false });

  if (error) {
    console.error(error);
    throw new Error("방 목록 조회 실패");
  }

  return {
    rooms: data,
  };
}