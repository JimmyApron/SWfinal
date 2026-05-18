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

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .insert([newRoom])
    .select()
    .single();

  if (roomError) {
    console.error("방 생성 실패 상세:", roomError);
    throw new Error(roomError.message || "방 생성 실패");
  }

  const candidateRows = roomData.candidates.map((candidate) => ({
    roomid: room.id,
    date: candidate.date,
    starttime: candidate.isAllDay ? null : candidate.startTime,
    endtime: candidate.isAllDay ? null : candidate.endTime,
    isallday: candidate.isAllDay,
  }));

  const { error: candidateError } = await supabase
    .from("schedule_candidates")
    .insert(candidateRows);

  if (candidateError) {
    console.error("후보 일정 저장 실패 상세:", candidateError);
    throw new Error(candidateError.message || "후보 일정 저장 실패");
  }

  return {
    message: "방 생성 완료",
    room,
  };
}