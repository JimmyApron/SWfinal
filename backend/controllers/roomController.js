const supabase = require("../supabaseClient");

// 랜덤 초대코드 생성
function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 방 생성
async function createRoom(req, res) {
  const { roomName, description } = req.body;

  if (!roomName) {
    return res.status(400).json({
      message: "방 이름은 필수입니다.",
    });
  }

  const newRoom = {
    roomName,
    description: description || "",
    inviteCode: generateInviteCode(),
  };

  const { data, error } = await supabase
    .from("rooms")
    .insert([newRoom])
    .select()
    .single();

  if (error) {
    return res.status(500).json({
      message: "방 생성 실패",
      error: error.message,
    });
  }

  return res.status(201).json({
    message: "방 생성 완료",
    room: data,
  });
}

// 초대코드로 방 입장
async function joinRoomByInviteCode(req, res) {
  const { inviteCode } = req.body;

  if (!inviteCode) {
    return res.status(400).json({
      message: "초대코드를 입력하세요.",
    });
  }

  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("inviteCode", inviteCode.toUpperCase())
    .single();

  if (error || !data) {
    return res.status(404).json({
      message: "해당 초대코드의 방을 찾을 수 없습니다.",
    });
  }

  return res.status(200).json({
    message: "방 입장 성공",
    room: data,
  });
}

module.exports = {
  createRoom,
  joinRoomByInviteCode,
};