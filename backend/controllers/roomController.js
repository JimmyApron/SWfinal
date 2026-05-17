const supabase = require("../supabaseClient");

function makeInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function createRoom(req, res) {
  const { roomName, description, userId } = req.body;

  if (!roomName || !userId) {
    return res.status(400).json({
      message: "roomName과 userId가 필요합니다.",
    });
  }

  const inviteCode = makeInviteCode();

  const { data: room, error } = await supabase
    .from("rooms")
    .insert({
      roomName,
      description: description || "",
      inviteCode,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({
      message: "방 생성 실패",
      error,
    });
  }

  const { error: memberError } = await supabase
    .from("room_members")
    .insert({
      room_id: room.id,
      user_id: userId,
    });

  if (memberError) {
    return res.status(500).json({
      message: "방은 생성됐지만 멤버 저장 실패",
      error: memberError,
    });
  }

  return res.status(201).json({
    message: "방 생성 완료",
    room,
  });
}

async function joinRoom(req, res) {
  const { inviteCode, userId } = req.body;

  if (!inviteCode || !userId) {
    return res.status(400).json({
      message: "inviteCode와 userId가 필요합니다.",
    });
  }

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("inviteCode", inviteCode)
    .single();

  if (roomError || !room) {
    return res.status(404).json({
      message: "존재하지 않는 초대코드입니다.",
    });
  }

  const { error: memberError } = await supabase
    .from("room_members")
    .upsert({
      room_id: room.id,
      user_id: userId,
    });

  if (memberError) {
    return res.status(500).json({
      message: "방 참가 실패",
      error: memberError,
    });
  }

  return res.json({
    message: "방 참가 완료",
    room,
  });
}

module.exports = {
  createRoom,
  joinRoom,
};