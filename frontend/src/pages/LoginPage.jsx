import { useState } from 'react'
import { loginApi } from '../api/authApi'
// 💡 [추가] react-icons에서 눈(FaEye)과 눈에 슬래시(FaEyeSlash) 아이콘을 가져옵니다.
import { FaEye, FaEyeSlash } from 'react-icons/fa'

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  // 로그인 비밀번호 보이기/숨기기 상태 관리
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = async (event) => {
    event.preventDefault()

    if (!email || !password) {
      setMessage('이메일과 비밀번호를 모두 입력해주세요.')
      return
    }

   try {
  setMessage('로그인 중입니다...')
  
  const result = await loginApi({ email, password })
  
  // 💡 result.message 대신 직접 한글 문자열을 꽂아버립니다.
  setMessage('로그인에 성공했습니다!') 
  
  // 로그인 성공 후 처리 (예: 홈 화면으로 이동 등)
} catch (error) {
  console.error('로그인 오류:', error)
  setMessage('로그인에 실패했습니다. 정보를 확인해주세요.')
}
  }

  return (
    <section>
      <h2>로그인</h2>

      <form onSubmit={handleLogin}>
        <div style={{ marginBottom: '10px' }}>
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* 💡 [수정] 텍스트박스 일체형 벡터 아이콘 비밀번호 입력 영역 */}
        <div style={{ position: 'relative', width: '100%', marginBottom: '10px' }}>
          <input
            type={showPassword ? 'text' : 'password'} // true면 일반 텍스트, false면 ●●● 표시
            placeholder="비밀번호"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{
              width: '100%',
              paddingRight: '40px', // 오른쪽에 눈 아이콘이 들어갈 공간 확보
              boxSizing: 'border-box'
            }}
          />
          <button 
            type="button" // form이 제출되는 것을 방지하기 위해 필수!
            onClick={() => setShowPassword(!showPassword)}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)', // 세로 정중앙 정렬
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '0',
              color: '#666' // 아이콘 색상 조절 (회색톤)
            }}
          >
            {/* 상태 변화에 따라 알맞은 벡터 아이콘 컴포넌트를 렌더링합니다 */}
            {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
          </button>
        </div>

        <button 
          type="submit"
          style={{ 
            width: '100%', 
            padding: '8px', 
            cursor: 'pointer' 
          }}
        >
          로그인
        </button>
      </form>

      {message && <p>{message}</p>}
    </section>
  )
}

export default LoginPage