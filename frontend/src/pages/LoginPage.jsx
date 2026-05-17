import React, { useState, useContext } from 'react';
import { loginApi } from '../api/authApi';
import { AuthContext } from '../context/AuthContext';

const LoginPage = () => {
  const { user, login, logout } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    const data = await loginApi({ email, password });
    
    if (data.user) {
      login(data.user); // Context 전역 상태 및 로컬 스토리지에 유저 저장
      alert(data.message);
    } else {
      alert(data.message || '로그인 실패');
    }
  };

  // 이미 로그인된 상태라면 유저 정보와 로그아웃 버튼 표시
  if (user) {
    return (
      <div style={{ padding: '20px' }}>
        <h2>환영합니다, {user.nickname}님!</h2>
        <p>이메일: {user.email}</p>
        <button onClick={logout}>로그아웃</button>
      </div>
    );
  }

  // 로그인 폼 화면
  return (
    <div style={{ padding: '20px' }}>
      <h2>로그인</h2>
      <form onSubmit={handleLogin}>
        <div>
          <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <input type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit">로그인</button>
      </form>
    </div>
  );
};

export default LoginPage;