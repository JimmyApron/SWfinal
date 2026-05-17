// controllers/roomController.js
const supabase = require("../supabaseClient");

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

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

module.exports = {
  createRoom,
};