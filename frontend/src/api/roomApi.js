import { supabase } from "../lib/supabaseClient";

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function createRoom(roomData) {
  const newRoom = {
    roomname: roomData.roomName,
    invitecode: generateInviteCode(),
    createdby: roomData.userId,
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

  const { error: memberError } = await supabase
    .from("room_members")
    .insert([
      {
        roomid: room.id,
        userid: roomData.userId,
        nickname: roomData.nickname,
      },
    ]);

  if (memberError) {
    console.error("방장 멤버 등록 실패:", memberError);
    throw new Error(memberError.message || "방장 멤버 등록 실패");
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

export async function joinRoomByInviteCode(inviteCode, userId, nickname) {
  const cleanInviteCode = inviteCode.trim().toUpperCase();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("invitecode", cleanInviteCode)
    .single();

  if (roomError || !room) {
    throw new Error("초대코드에 해당하는 방을 찾을 수 없습니다.");
  }

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
        nickname: nickname,
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