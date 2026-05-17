const express = require("express");
const router = express.Router();

const {
  createRoom,
  joinRoom,
} = require("../controllers/roomController");

router.post("/", createRoom);
router.post("/join", joinRoom);

module.exports = router;