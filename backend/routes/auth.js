const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db'); // 기존에 성공적으로 연결한 Supabase db.js 객체

// 1. 이메일 중복 확인 API
router.post('/check-email', async (req, res) => {
  const { email } = req.body;

  try {
    const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (result.rows.length > 0) {
      return res.status(400).json({ isAvailable: false, message: '이미 사용 중인 이메일입니다.' });
    }
    
    return res.status(200).json({ isAvailable: true, message: '사용 가능한 이메일입니다.' });
  } catch (error) {
    console.error('이메일 중복 확인 에러:', error);
    return res.status(500).json({ message: '서버 에러가 발생했습니다.' });
  }
});

// 2. 회원가입 API
router.post('/signup', async (req, res) => {
  const { email, password, nickname } = req.body;

  try {
    // 비밀번호 암호화 (Salt Round: 10)
    const hashedPassword = await bcrypt.hash(password, 10);

    // DB에 유저 정보 INSERT
    const queryText = 'INSERT INTO users(email, password, nickname) VALUES($1, $2, $3) RETURNING id, email, nickname';
    const values = [email, hashedPassword, nickname];
    const result = await db.query(queryText, values);

    return res.status(201).json({
      message: '회원가입이 성공적으로 완료되었습니다.',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('회원가입 에러:', error);
    return res.status(500).json({ message: '서버 에러가 발생했습니다.' });
  }
});

// 3. 로그인 API
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 유저 조회
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(400).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = result.rows[0];

    // 암호화된 비밀번호 비교 검증
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    // 로그인 성공 시 비밀번호를 제외한 유저 정보 반환
    return res.status(200).json({
      message: '로그인 성공',
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname
      }
    });
  } catch (error) {
    console.error('로그인 에러:', error);
    return res.status(500).json({ message: '서버 에러가 발생했습니다.' });
  }
});

module.exports = router;