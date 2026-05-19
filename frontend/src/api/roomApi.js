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

export async function joinRoomByInviteCode(inviteCode, userId, nickname) {
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("invitecode", inviteCode)
    .single();

  if (roomError || !room) {
    throw new Error("초대코드에 해당하는 방을 찾을 수 없습니다.");
  }

  //이미 참가한 방인지 검사
  const { data: existingMember } = await supabase
    .from("room_members")
    .select("*")
    .eq("roomid", room.id)
    .eq("userid", userId)
    .maybeSingle();

  if (existingMember) {
    throw new Error("이미 참가한 방입니다.");
  }

  const { error: memberError } = await supabase
    .from("room_members")
    .insert([
      {
        roomid: room.id,
        userid: userId,
      },
    ]);

  if (memberError) {
    console.error(memberError);
    throw new Error("방 참가 실패");
  }

  return {
    message: "방 참가 완료",
    room,
  };
}