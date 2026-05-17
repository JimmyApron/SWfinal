const express = require("express");
const router = express.Router();

const {
  createRoom,
  joinRoomByInviteCode,
} = require("../controllers/roomController");

router.post("/", createRoom);

// 초대코드로 방 입장
router.post("/invite", joinRoomByInviteCode);

module.exports = router;