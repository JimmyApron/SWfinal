import { useState } from 'react'
import { loginApi, joinRoomMemberApi } from '../../api/authApi' // 👈 상위 폴더 경로 정렬 및 회원가입 연동 함수 포함
import { FaEye, FaEyeSlash } from 'react-icons/fa'

// 💡 부모(App.js)가 튼튼하게 넘겨준 roomId와 setPage를 받아옵니다.
function LoginPage({ roomId, setPage }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // 회원 로그인 및 자동 방 멤버 등록 핸들러
  const handleLogin = async (event) => {
    event.preventDefault()
    if (!email || !password) {
      setMessage('이메일과 비밀번호를 모두 입력해주세요.')
      return
    }

    // 💡 안전장치: 대문을 거치지 않고 네비바 버튼으로 직접 접근했을 때 방어
    if (!roomId) {
      setMessage('⚠️ 초대코드를 통해 먼저 방을 확인하고 로그인해 주세요.')
      return
    }

    try {
      setMessage('로그인 인증 중입니다...')
      // 1. Supabase Auth 로그인 수행
      const result = await loginApi({ email, password })
      const loggedInUserId = result.user?.id

      setMessage('인증 성공! 방 멤버 목록(room_members)에 등록 중...')
      
      // 2. 💡 [핵심 연동] 대문에서 입력했던 roomId(초대코드)와 로그인한 유저 고유 id 연동
      const joinResult = await joinRoomMemberApi(roomId, loggedInUserId)
      console.log('room_members 등록 성공 결과:', joinResult)

      setMessage(`🎉 ${result.profile?.nickname || '회원'}님 환영합니다! 방 멤버 등록 후 입장합니다.`)
      
      // 3. 미션 반영: 세션 스토리지 보존 및 대시보드로 페이지 전환
      localStorage.setItem('user_id', loggedInUserId)
      setTimeout(() => {
        if (typeof setPage === 'function') {
          setPage('dashboard') // 진짜 방 내부 대시보드로 라우팅 연동
        }
      }, 1000)

    } catch (error) {
      console.error('로그인 또는 방 가입 오류:', error)
      setMessage(error.message || '로그인에 실패했습니다. 정보를 확인해주세요.')
    }
  }

  return (
    <section style={{ maxWidth: '400px', margin: '40px auto', padding: '20px', textAlign: 'center' }}>
      
      <h2>로그인 입장</h2>
      <p style={{ color: '#666', fontSize: '14px' }}>
        진입 대기 중인 방 코드: <strong style={{ color: '#4A90E2' }}>{roomId || '선택된 방 없음'}</strong>
      </p>

      <hr style={{ border: '0.5px solid #eee', marginBottom: '20px' }} />

      <form onSubmit={handleLogin}>
        {/* 이메일 인풋 */}
        <div style={{ marginBottom: '10px' }}>
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box', fontSize: '16px' }}
          />
        </div>

        {/* 비밀번호 인풋 */}
        <div style={{ position: 'relative', width: '100%', marginBottom: '20px' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="비밀번호"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: '100%', padding: '10px', paddingRight: '45px', boxSizing: 'border-box', fontSize: '16px' }}
          />
          <button 
            type="button" 
            onClick={() => setShowPassword(!showPassword)}
            style={{
              position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: '#666'
            }}
          >
            {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
          </button>
        </div>

        {/* 최종 제출 버튼 */}
        <button type="submit" style={{ width: '100%', padding: '12px', fontSize: '16px', cursor: 'pointer', backgroundColor: '#4A90E2', color: '#fff', border: 'none' }}>
          로그인하고 방 입장하기
        </button>
      </form>

      {message && <p style={{ fontSize: '14px', marginTop: '15px', color: 'darkblue', fontWeight: 'bold' }}>{message}</p>}

      {/* 처음으로 돌아가기 버튼 */}
      <div style={{ marginTop: '25px' }}>
        <button
          type="button"
          onClick={() => setPage('invite')}
          style={{ background: 'none', border: 'none', color: '#888', textDecoration: 'underline', cursor: 'pointer', fontSize: '14px' }}
        >
          초대코드 입력 화면으로 돌아가기
        </button>
      </div>

    </section>
  )
}

export default LoginPage