import { useState, useEffect, useRef } from 'react'
import { sendEmailOtpApi, verifyEmailOtpApi, signupApi, checkNicknameDuplicateApi, checkEmailDuplicateApi } from '../../api/authApi'
import { FaEye, FaEyeSlash } from 'react-icons/fa'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'

function SignupPage() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [isEmailChecked, setIsEmailChecked] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)

  const [nickname, setNickname] = useState('')
  const [isNicknameChecked, setIsNicknameChecked] = useState(false)

  const [password, setPassword] = useState('')
  const [passwordCheck, setPasswordCheck] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordCheck, setShowPasswordCheck] = useState(false)

  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!otpSent || emailVerified) return
    setTimeLeft(600)
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [otpSent, emailVerified])

  const formatTime = (seconds) => {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0')
    const s = String(seconds % 60).padStart(2, '0')
    return `${m}:${s}`
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/

  const handleEmailChange = (e) => {
    setEmail(e.target.value)
    setIsEmailChecked(false)
    setOtpSent(false)
    setEmailVerified(false)
    setOtpCode('')
    setMessage('')
  }

  const handleCheckEmail = async () => {
    if (!email) { setMessage('이메일을 입력해주세요.'); return }
    if (!emailRegex.test(email)) { setMessage('⚠️ 올바른 이메일 형식이 아닙니다. (예: user@example.com)'); return }
    setLoading(true)
    setMessage('중복 확인 중...')
    try {
      const isDuplicate = await checkEmailDuplicateApi(email.trim())
      if (isDuplicate) {
        setIsEmailChecked(false)
        setMessage('❌ 이미 사용 중인 이메일입니다.')
      } else {
        setIsEmailChecked(true)
        setMessage('✅ 사용 가능한 이메일입니다.')
      }
    } catch (error) {
      setIsEmailChecked(false)
      setMessage('❌ 중복 확인 실패: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSendOtp = async () => {
    if (!isEmailChecked) { setMessage('⚠️ 먼저 이메일 중복 확인을 해주세요.'); return }
    setLoading(true)
    setMessage('인증 코드 전송 중...')
    try {
      await sendEmailOtpApi(email.trim())
      setOtpSent(true)
      setMessage('📧 인증 코드를 이메일로 전송했습니다. 6자리 코드를 입력해주세요.')
    } catch (error) {
      if (error.status === 429 || error.message?.includes('rate limit') || error.message?.includes('429')) {
        setMessage('⚠️ 인증 코드 요청이 너무 많습니다. 1~5분 후 다시 시도해주세요.')
      } else if (error.message === '이미 사용 중인 이메일입니다.') {
        setMessage('❌ 이미 사용 중인 이메일입니다.')
      } else {
        setMessage('❌ 인증 코드 전송 실패: ' + (error.message || '잠시 후 다시 시도해주세요.'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length !== 6) { setMessage('6자리 인증 코드를 입력해주세요.'); return }

    setLoading(true)
    setMessage('인증 코드 확인 중...')

    try {
      await verifyEmailOtpApi(email.trim(), otpCode)
      setEmailVerified(true)
      setOtpSent(false)
      setMessage('✅ 이메일 인증이 완료되었습니다.')
    } catch (error) {
      setMessage('❌ 인증 코드가 올바르지 않습니다. 다시 확인해주세요.')
    } finally {
      setLoading(false)
    }
  }

  const handleNicknameCheck = async (e) => {
    e.preventDefault()
    if (!nickname) { setMessage('닉네임을 입력한 후 중복 확인을 해주세요.'); return }

    try {
      setMessage('닉네임 중복 확인 중입니다...')
      const isDuplicate = await checkNicknameDuplicateApi(nickname.trim())
      if (isDuplicate) {
        setIsNicknameChecked(false)
        setMessage('❌ 이미 사용 중인 닉네임입니다.')
      } else {
        setIsNicknameChecked(true)
        setMessage('✅ 사용 가능한 닉네임입니다.')
      }
    } catch (error) {
      setMessage('닉네임 중복 체크에 실패했습니다.')
    }
  }

  const handleSignup = async (e) => {
    e.preventDefault()

    if (!emailVerified) { setMessage('이메일 인증을 완료해주세요.'); return }
    if (!isNicknameChecked) { setMessage('닉네임 중복 확인을 완료해주세요.'); return }
    if (!passwordRegex.test(password)) {
      setMessage('⚠️ 비밀번호는 영문 대/소문자, 숫자, 특수문자를 모두 포함하여 최소 8자 이상이어야 합니다.')
      return
    }
    if (password !== passwordCheck) { setMessage('비밀번호가 서로 다릅니다.'); return }

    try {
      setMessage('회원가입 중입니다...')
      await signupApi({ password, nickname: nickname.trim() })
      await supabase.auth.signOut()
      setMessage('🎉 회원가입이 완료되었습니다! 로그인 페이지로 이동합니다.')
      setTimeout(() => navigate('/login'), 2000)
    } catch (error) {
      console.error('회원가입 오류:', error)
      setMessage(error.message || '회원가입에 실패했습니다.')
    }
  }

  return (
    <section>
      <h2>회원가입</h2>

      <form onSubmit={handleSignup}>
        {/* 이메일 + 중복 확인 */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={handleEmailChange}
            disabled={emailVerified}
          />
          <button
            type="button"
            onClick={handleCheckEmail}
            disabled={loading || emailVerified}
          >
            {emailVerified ? '인증완료' : '중복 확인'}
          </button>
        </div>

        {/* 중복 확인 후 인증하기 버튼 */}
        {isEmailChecked && !emailVerified && (
          <button
            type="button"
            onClick={handleSendOtp}
            disabled={loading}
            style={{ width: '100%', marginBottom: '10px', padding: '8px', backgroundColor: '#7c79ff', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
          >
            {otpSent ? '인증 코드 재전송' : '인증하기'}
          </button>
        )}

        {/* OTP 코드 입력 */}
        {otpSent && !emailVerified && (
          <div style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="text"
                  placeholder="인증 코드 6자리"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  style={{ width: '100%', paddingRight: '52px', boxSizing: 'border-box' }}
                />
                <span style={{
                  position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                  fontSize: '13px', color: timeLeft <= 60 ? '#e53935' : '#888', fontWeight: 'bold'
                }}>
                  {formatTime(timeLeft)}
                </span>
              </div>
              <button type="button" onClick={handleVerifyOtp} disabled={loading || timeLeft === 0}>
                확인
              </button>
            </div>
            {timeLeft === 0 && (
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#e53935' }}>
                인증 코드가 만료되었습니다. 재전송 버튼을 눌러주세요.
              </p>
            )}
          </div>
        )}

        {/* 닉네임 */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <input
            type="text"
            placeholder="닉네임"
            value={nickname}
            onChange={(e) => { setNickname(e.target.value); setIsNicknameChecked(false) }}
            disabled={!emailVerified}
          />
          <button type="button" onClick={handleNicknameCheck} disabled={!emailVerified}>
            중복확인
          </button>
        </div>

        {/* 비밀번호 */}
        <div style={{ position: 'relative', width: '100%', marginBottom: '10px' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!emailVerified}
            style={{ width: '100%', paddingRight: '40px', boxSizing: 'border-box' }}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0', color: '#666' }}
          >
            {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
          </button>
        </div>

        {/* 비밀번호 확인 */}
        <div style={{ position: 'relative', width: '100%', marginBottom: '10px' }}>
          <input
            type={showPasswordCheck ? 'text' : 'password'}
            placeholder="비밀번호 확인"
            value={passwordCheck}
            onChange={(e) => setPasswordCheck(e.target.value)}
            disabled={!emailVerified}
            style={{ width: '100%', paddingRight: '40px', boxSizing: 'border-box' }}
          />
          <button
            type="button"
            onClick={() => setShowPasswordCheck(!showPasswordCheck)}
            style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0', color: '#666' }}
          >
            {showPasswordCheck ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
          </button>
        </div>

        <button
          type="submit"
          disabled={!emailVerified || !isNicknameChecked}
          style={{ width: '100%', padding: '8px', cursor: emailVerified && isNicknameChecked ? 'pointer' : 'not-allowed' }}
        >
          회원가입 완료하기
        </button>
      </form>

      {message && <p>{message}</p>}
    </section>
  )
}

export default SignupPage
