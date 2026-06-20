import { useState } from 'react'
import { loginApi } from '../../api/authApi'
import { FaEye, FaEyeSlash, FaChevronLeft } from 'react-icons/fa'
import { useNavigate } from 'react-router-dom'

function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = async (event) => {
    event.preventDefault()
    if (!email || !password) {
      setMessage('이메일과 비밀번호를 모두 입력해주세요.')
      return
    }

    try {
      setMessage('로그인 인증 중입니다...')

      // 1. 순수한 Supabase Auth 로그인 수행 (초대코드 비교 전면 철거!)
      const result = await loginApi({ email, password })

      const loggedInUserId = result.user?.id

      // 2. 가이드라인 미션 반영: 로컬스토리지에 유저 식별자 굽기
      localStorage.setItem('user_id', loggedInUserId)
      localStorage.removeItem('guest_id')

      setMessage(`${result.profile?.nickname || '회원'}님 환영합니다! 잠시 후 홈 화면으로 이동합니다.`)

      // 3. 💡 [핵심 개편] 성공 즉시 HomePage(/home)로 다이렉트 페이지 이동시킵니다.
      setTimeout(() => {
        navigate('/home')
      }, 1000)
    } catch (error) {
      console.error('로그인 오류:', error)
      setMessage(error.message || '로그인에 실패했습니다. 정보를 확인해주세요.')
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        backgroundColor: '#ffffff',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <button
        onClick={() => navigate('/')}
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#16142B',
          padding: 0,
        }}
      >
        <FaChevronLeft size={20} />
      </button>

      <h1 style={{ margin: '50px 0 0', fontSize: '28px', fontWeight: 800, color: '#16142B' }}>이메일로 로그인</h1>
      <p style={{ margin: '20px 0 36px', fontSize: '14px', color: '#6B687A' }}>
        가입한 이메일과 비밀번호를 입력해주세요.
      </p>

      <form onSubmit={handleLogin}>
        <label style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: '#16142B', marginBottom: '8px' }}>
          이메일
        </label>
        <input
          type="email"
          placeholder="이메일을 입력해주세요"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={{
            width: '100%',
            padding: '15px',
            border: '1px solid #E7E3F2',
            borderRadius: '14px',
            fontSize: '15px',
            color: '#16142B',
            boxSizing: 'border-box',
            marginBottom: '24px',
            outline: 'none',
          }}
        />

        <label style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: '#16142B', marginBottom: '8px' }}>
          비밀번호
        </label>
        <div style={{ position: 'relative', width: '100%', marginBottom: '28px' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="비밀번호를 입력해주세요"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{
              width: '100%',
              padding: '15px',
              paddingRight: '44px',
              border: '1px solid #E7E3F2',
              borderRadius: '14px',
              fontSize: '15px',
              color: '#16142B',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            style={{
              position: 'absolute',
              right: '14px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9491A4',
              display: 'flex',
              padding: 0,
            }}
          >
            {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
          </button>
        </div>

        <button
          type="submit"
          style={{
            width: '100%',
            padding: '16px',
            backgroundColor: '#6842F7',
            border: 'none',
            borderRadius: '14px',
            fontSize: '16px',
            fontWeight: 700,
            color: '#ffffff',
            cursor: 'pointer',
          }}
        >
          로그인
        </button>
      </form>

      {message && (
        <p style={{ margin: '16px 0 0', fontSize: '13px', color: '#6B687A', textAlign: 'center' }}>{message}</p>
      )}

      <button
        type="button"
        onClick={() => navigate('/reset-password')}
        style={{
          margin: '20px auto',
          display: 'block',
          background: 'none',
          border: 'none',
          fontSize: '14px',
          color: '#6C5CE7',
          cursor: 'pointer',
        }}
      >
        비밀번호를 잊으셨나요?
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '32px 0 24px' }}>
        <div style={{ flex: 1, height: '1px', backgroundColor: '#E7E3F2' }} />
        <span style={{ fontSize: '13px', color: '#6B687A', whiteSpace: 'nowrap' }}>
          계정이 없으신가요?{' '}
          <span
            onClick={() => navigate('/signup')}
            style={{ color: '#6C5CE7', fontWeight: 700, cursor: 'pointer' }}
          >
            회원가입
          </span>
        </span>
        <div style={{ flex: 1, height: '1px', backgroundColor: '#E7E3F2' }} />
      </div>

      <button
        type="button"
        onClick={() => navigate('/')}
        style={{
          width: '100%',
          padding: '15px',
          backgroundColor: '#ffffff',
          border: '1px solid #dedae8d2',
          borderRadius: '999px',
          fontSize: '15px',
          fontWeight: 600,
          color: '#16142B',
          cursor: 'pointer',
        }}
      >
        다른 로그인 방법 사용
      </button>
    </div>
  )
}

export default LoginPage
