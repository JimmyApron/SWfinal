// controllers/roomController.js
const supabase = require("../supabaseClient");
//초대 코드 생성

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function createRoom(req, res) {
  console.log("POST /rooms 요청 들어옴");//
  console.log("req.body:", req.body);//
  const { roomName, description, userId } = req.body;

  if (!roomName) {
    return res.status(400).json({
      message: "방 이름은 필수입니다.",
    });
  }

  const newRoom = {
    roomname: roomName,
    description: description || "",
    invitecode: generateInviteCode(),
    createdby: userId || "guest",
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
      details: error.details,//
      hint: error.hint,//
      code: error.code,//
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