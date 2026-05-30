import { useState } from 'react'
import { loginApi } from '../../api/authApi'
import { FaEye, FaEyeSlash } from 'react-icons/fa'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'

function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { 
        redirectTo: `${window.location.origin}/home`
         },
    })
  }

  const handleKakaoLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: { 
        redirectTo: `${window.location.origin}/home`,
        scopes: 'profile_nickname',
        queryParams: {
          prompt: 'none',
        }, },
    })
  }

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

      setMessage(`🎉 ${result.profile?.nickname || '회원'}님 환영합니다! 잠시 후 홈 화면으로 이동합니다.`)
      
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
    <section>
      <h2>로그인</h2>

      <form onSubmit={handleLogin}>
        <div>
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div style={{ position: 'relative', width: '100%' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="비밀번호"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: '100%', paddingRight: '45px', boxSizing: 'border-box' }}
          />
          <button 
            type="button" 
            onClick={() => setShowPassword(!showPassword)}
            style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}
          >
            {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
          </button>
        </div>

        <button type="submit">
          로그인
        </button>
      </form>

      {message && <p>{message}</p>}

      <div style={{ margin: '16px 0', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>── 또는 ──</div>

      <button
        type="button"
        onClick={handleGoogleLogin}
        style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '14px', marginBottom: '8px' }}
      >
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="18" />
        Google로 로그인
      </button>

      <button
        type="button"
        onClick={handleKakaoLogin}
        style={{ width: '100%', padding: '10px', border: 'none', borderRadius: '8px', backgroundColor: '#FEE500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '14px', fontWeight: 'bold', color: '#000' }}
      >
        <img src="https://developers.kakao.com/assets/img/about/logos/kakaolink/kakaolink_btn_small.png" alt="Kakao" width="18" />
        카카오로 로그인
      </button>

      <div style={{ marginTop: '12px' }}>
        <button type="button" onClick={() => navigate('/')}>
          처음 화면으로 돌아가기
        </button>
      </div>
    </section>
  )
}

export default LoginPage