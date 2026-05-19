require('dotenv').config()

const express = require('express')
const cors = require('cors')
const kakaoRouteRouter = require('./routes/kakaoRoute')
const googlePlaceRouter = require("./routes/googlePlace");

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/kakao', kakaoRouteRouter)
app.use("/api/google", googlePlaceRouter);

let myLocation = null

app.get('/', (req, res) => {
  res.send('서버 실행 중')
})

app.post('/api/locations/me', (req, res) => {
  const { latitude, longitude, accuracy } = req.body

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      message: 'latitude와 longitude가 필요합니다.',
    })
  }

  myLocation = {
    latitude,
    longitude,
    accuracy,
    savedAt: new Date().toISOString(),
  }

  return res.status(201).json({
    message: '내 위치 저장 성공',
    location: myLocation,
  })
})

app.get('/api/locations/me', (req, res) => {
  if (!myLocation) {
    return res.status(404).json({
      message: '저장된 위치가 없습니다.',
    })
  }

  return res.json({
    location: myLocation,
  })
})

app.get('/api/rooms/:roomId/locations', (req, res) => {
  const { roomId } = req.params

  return res.json({
    roomId,
    locations: myLocation ? [myLocation] : [],
  })
})

app.listen(5000, () => {
  console.log('서버 실행 완료: http://localhost:5000')
})