function createRoom(req, res) {
  const { roomName } = req.body;

  console.log(roomName);

  res.json({
    message: "방 생성 완료",
    roomName,
  });
}

module.exports = {
  createRoom,
}; 