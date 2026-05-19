import { useState } from 'react'
import { signupApi, checkEmailDuplicateApi, checkNicknameDuplicateApi } from '../../api/authApi'
import { FaEye, FaEyeSlash } from 'react-icons/fa'

function SignupPage() {
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [passwordCheck, setPasswordCheck] = useState('')
  const [message, setMessage] = useState('')

  const [isEmailChecked, setIsEmailChecked] = useState(false)
  const [isNicknameChecked, setIsNicknameChecked] = useState(false)

  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordCheck, setShowPasswordCheck] = useState(false)

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/

  // 💡 [추가] 이메일 실시간 입력 핸들러
  const handleEmailChange = (event) => {
    const currentEmail = event.target.value
    setEmail(currentEmail)
    setIsEmailChecked(false) // 이메일이 바뀌면 중복확인 다시 하도록 초기화

    if (currentEmail === '') {
      setMessage('')
    } else if (!emailRegex.test(currentEmail)) {
      // 💡 타이핑할 때 형식이 안 맞으면 바로 경고를 띄웁니다.
      setMessage('⚠️ 올바른 이메일 형식이 아닙니다. (예: user@example.com)')
    } else {
      // 💡 형식이 맞으면 안내를 지워주거나 준비되었다고 알려줍니다.
      setMessage('이메일 형식이 올바릅니다. 중복확인을 해주세요.')
    }
  }

  // 이메일 중복 확인 핸들러
  const handleEmailCheck = async (event) => {
    event.preventDefault()
    if (!email) {
      setMessage('이메일을 입력한 후 중복 확인을 해주세요.')
      return
    }

    if (!emailRegex.test(email)) {
      setMessage('⚠️ 올바른 이메일 형식이 아닙니다. (예: user@example.com)')
      return
    }

    try {
      setMessage('이메일 중복 확인 중입니다...')
      const isDuplicate = await checkEmailDuplicateApi(email)
      
      if (isDuplicate) {
        setIsEmailChecked(false)
        setMessage('❌ 이미 사용 중인 이메일입니다.')
      } else {
        setIsEmailChecked(true)
        setMessage('✅ 사용 가능한 이메일입니다.')
      }
    } catch (error) {
      console.error('이메일 중복 체크 오류:', error)
      setMessage('이메일 중복 체크에 실패했습니다.')
    }
  }

  // 닉네임 중복 확인 핸들러
  const handleNicknameCheck = async (event) => {
    event.preventDefault()
    if (!nickname) {
      setMessage('닉네임을 입력한 후 중복 확인을 해주세요.')
      return
    }

    try {
      setMessage('닉네임 중복 확인 중입니다...')
      const isDuplicate = await checkNicknameDuplicateApi(nickname)

      if (isDuplicate) {
        setIsNicknameChecked(false)
        setMessage('❌ 이미 사용 중인 닉네임입니다.')
      } else {
        setIsNicknameChecked(true)
        setMessage('✅ 사용 가능한 닉네임입니다.')
      }
    } catch (error) {
      console.error('닉네임 중복 체크 오류:', error)
      setMessage('닉네임 중복 체크에 실패했습니다.')
    }
  }

  const handleSignup = async (event) => {
    event.preventDefault()

    if (!email || !nickname || !password || !passwordCheck) {
      setMessage('모든 값을 입력해주세요.')
      return
    }

    if (!emailRegex.test(email)) {
      setMessage('⚠️ 올바른 이메일 형식이 아닙니다.')
      return
    }

    if (!isEmailChecked) {
      setMessage('이메일 중복 확인을 완료해주세요.')
      return
    }

    if (!isNicknameChecked) {
      setMessage('닉네임 중복 확인을 완료해주세요.')
      return
    }

    if (!passwordRegex.test(password)) {
      setMessage('⚠️ 비밀번호는 영문 대/소문자, 숫자, 특수문자를 모두 포함하여 최소 8자 이상이어야 합니다.')
      return
    }

    if (password !== passwordCheck) {
      setMessage('비밀번호가 서로 다릅니다.')
      return
    }

    try {
      setMessage('회원가입 중입니다.')

      await signupApi({
        email,
        nickname,
        password,
      })

      setMessage('회원가입이 완료되었습니다!')
      setEmail('')
      setNickname('')
      setPassword('')
      setPasswordCheck('')
      
      setIsEmailChecked(false)
      setIsNicknameChecked(false)
    } catch (error) {
      console.error('회원가입 오류:', error)
      setMessage(error.message || '회원가입에 실패했습니다.')
    }
  }

  return (
    <section>
      <h2>회원가입</h2>

      <form onSubmit={handleSignup}>
        {/* 이메일 입력 영역 */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={handleEmailChange} // 💡 실시간 검증 핸들러로 교체
          />
          <button type="button" onClick={handleEmailCheck}>중복확인</button>
        </div>

        {/* 닉네임 입력 영역 */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <input
            type="text"
            placeholder="닉네임"
            value={nickname}
            onChange={(event) => {
              setNickname(event.target.value)
              setIsNicknameChecked(false)
            }}
          />
          <button type="button" onClick={handleNicknameCheck}>중복확인</button>
        </div>

        {/* 비밀번호 입력 영역 */}
        <div style={{ position: 'relative', width: '100%', marginBottom: '10px' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="비밀번호"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{
              width: '100%',
              paddingRight: '40px',
              boxSizing: 'border-box'
            }}
          />
          <button 
            type="button" 
            onClick={() => setShowPassword(!showPassword)}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '0',
              color: '#666'
            }}
          >
            {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
          </button>
        </div>

        {/* 비밀번호 확인 입력 영역 */}
        <div style={{ position: 'relative', width: '100%', marginBottom: '10px' }}>
          <input
            type={showPasswordCheck ? 'text' : 'password'}
            placeholder="비밀번호 확인"
            value={passwordCheck}
            onChange={(event) => setPasswordCheck(event.target.value)}
            style={{
              width: '100%',
              paddingRight: '40px',
              boxSizing: 'border-box'
            }}
          />
          <button 
            type="button" 
            onClick={() => setShowPasswordCheck(!showPasswordCheck)}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '0',
              color: '#666'
            }}
          >
            {showPasswordCheck ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
          </button>
        </div>

        <button 
          type="submit"
          disabled={!isEmailChecked || !isNicknameChecked}
          style={{ 
            width: '100%', 
            padding: '8px', 
            cursor: isEmailChecked && isNicknameChecked ? 'pointer' : 'not-allowed' 
          }}
        >
          회원가입
        </button>
      </form>

      {message && <p>{message}</p>}
    </section>
  )
}

export default SignupPage;