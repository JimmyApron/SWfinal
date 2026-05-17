require('dotenv').config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const roomRoutes = require("./routes/roomRoutes");

app.use("/rooms", roomRoutes);

app.get("/", (req, res) => {
  res.send("서버 실행 중");
});

app.listen(3000, () => {
  console.log("서버 실행 완료");
});