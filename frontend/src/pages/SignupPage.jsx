import { useState } from 'react'
import { signupApi } from '../api/authApi'

function SignupPage() {
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [passwordCheck, setPasswordCheck] = useState('')
  const [message, setMessage] = useState('')

  const handleSignup = async (event) => {
    event.preventDefault()

    if (!email || !nickname || !password || !passwordCheck) {
      setMessage('모든 값을 입력해주세요.')
      return
    }

    if (password !== passwordCheck) {
      setMessage('비밀번호가 서로 다릅니다.')
      return
    }

    if (password.length < 6) {
      setMessage('비밀번호는 최소 6자 이상이어야 합니다.')
      return
    }

    try {
      setMessage('회원가입 중입니다.')

      await signupApi({
        email,
        nickname,
        password,
      })

      setMessage('회원가입이 완료되었습니다. 이메일 인증이 필요할 수 있습니다.')
      setEmail('')
      setNickname('')
      setPassword('')
      setPasswordCheck('')
    } catch (error) {
      console.error('회원가입 오류:', error)
      setMessage(error.message || '회원가입에 실패했습니다.')
    }
  }

  return (
    <section>
      <h2>회원가입</h2>

      <form onSubmit={handleSignup}>
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
            type="text"
            placeholder="닉네임"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
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

        <div>
          <input
            type="password"
            placeholder="비밀번호 확인"
            value={passwordCheck}
            onChange={(event) => setPasswordCheck(event.target.value)}
          />
        </div>

        <button type="submit">회원가입</button>
      </form>

      {message && <p>{message}</p>}
    </section>
  )
}

export default SignupPage;