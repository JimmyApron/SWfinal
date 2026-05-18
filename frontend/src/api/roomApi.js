import { supabase } from "../lib/supabaseClient";

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function createRoom(roomData) {
  const newRoom = {
    roomname: roomData.roomName,
    description: roomData.description || "",
    invitecode: generateInviteCode(),
    createdby: roomData.userId || "test-user-1",
  };

  const { data, error } = await supabase
    .from("rooms")
    .insert([newRoom])
    .select()
    .single();

  if (error) {
    console.error("방 생성 실패 상세:", error);
    throw new Error(error.message || "방 생성 실패");
  }

  return {
    message: "방 생성 완료",
    room: data,
  };
}