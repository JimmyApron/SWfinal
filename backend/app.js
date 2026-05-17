const express = require('express');
const cors = require('cors');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors()); // 프론트엔드(React)와의 교차 출처 차단 해제
app.use(express.json()); // JSON 형태의 요청 본문(body) 파싱

// 라우터 연결
app.use('/api/auth', authRouter);

// 서버 구동
app.listen(PORT, () => {
  console.log(`? 백엔드 서버가 http://localhost:${PORT} 에서 구동 중입니다.`);
});