import { useContext, useState } from 'react'
import { loginApi } from '../api/authApi'
import { AuthContext } from '../context/AuthContext'

function LoginPage() {
  const { user, profile, login, logout } = useContext(AuthContext)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  const handleLogin = async (event) => {
    event.preventDefault()

    if (!email || !password) {
      setMessage('이메일과 비밀번호를 입력해주세요.')
      return
    }

    try {
      setMessage('로그인 중입니다.')

      const result = await loginApi({
        email,
        password,
      })

      login({
        user: result.user,
        profile: result.profile,
      })

      setMessage('로그인에 성공했습니다.')
    } catch (error) {
      console.error('로그인 오류:', error)
      setMessage(error.message || '로그인에 실패했습니다.')
    }
  }

  if (user) {
    return (
      <section>
        <h2>로그인 상태</h2>
        <p>이메일: {user.email}</p>
        <p>닉네임: {profile?.nickname}</p>
        <button type="button" onClick={logout}>
          로그아웃
        </button>
      </section>
    )
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

        <div>
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button type="submit">로그인</button>
      </form>

      {message && <p>{message}</p>}
    </section>
  )
}

export default LoginPage;