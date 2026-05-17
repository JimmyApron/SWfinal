const rooms = [];

function createRoom(req, res) {
  const { roomName, description } = req.body;

  if (!roomName) {
    return res.status(400).json({
      message: "방 이름은 필수입니다.",
    });
  }

  const newRoom = {
    id: Date.now(),
    roomName,
    description: description || "",
    inviteCode: Math.random().toString(36).substring(2, 8),
  };

  rooms.push(newRoom);

  return res.status(201).json({
    message: "방 생성 완료",
    room: newRoom,
  });
}

function getRooms(req, res) {
  return res.json({
    rooms,
  });
}

module.exports = {
  createRoom,
  getRooms,
};