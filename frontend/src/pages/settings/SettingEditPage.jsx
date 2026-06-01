import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaEye, FaEyeSlash } from 'react-icons/fa'
import { getCurrentUserApi, sendEmailOtpApi } from '../../api/authApi'
import { supabase } from '../../lib/supabaseClient'
import {
  updateNicknameApi,
  checkNicknameDuplicateApi,
  checkEmailDuplicateApi,
  uploadAvatarApi,
  updatePasswordApi,
  deleteUserAccountApi,
} from '../../api/settingApi'

function SettingEditPage() {
  const navigate = useNavigate()

  const [userId, setUserId] = useState('')
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [profileImageUrl, setProfileImageUrl] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [message, setMessage] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  const [initialNickname, setInitialNickname] = useState('')
  const [initialEmail, setInitialEmail] = useState('')

  const [isSocialUser, setIsSocialUser] = useState(false)

  const [isNicknameChecked, setIsNicknameChecked] = useState(false)
  const [isEmailChecked, setIsEmailChecked] = useState(false)
  
  // OTP 관련 State (회원가입과 동일한 방식)
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const timerRef = useRef(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [showDeleteForm, setShowDeleteForm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const [countdown, setCountdown] = useState(0)
  const rateLimitTimerRef = useRef(null)

  // Rate Limit 타이머 (60초 쿨다운)
  useEffect(() => {
    if (countdown > 0) {
      rateLimitTimerRef.current = setInterval(() => {
        setCountdown((prev) => (prev <= 1 ? 0 : prev - 1))
      }, 1000)
    } else {
      clearInterval(rateLimitTimerRef.current)
    }
    return () => clearInterval(rateLimitTimerRef.current)
  }, [countdown])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  // OTP 타이머
  useEffect(() => {
    if (!otpSent || emailVerified) return
    setTimeLeft(600) // 10분
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [otpSent, emailVerified])

  const formatTime = (seconds) => {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0')
    const s = String(seconds % 60).padStart(2, '0')
    return `${m}:${s}`
  }

  const refreshUserData = useCallback(async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        alert('로그인이 만료되었습니다.')
        navigate('/login')
        return
      }

      const provider = authUser?.app_metadata?.provider
      setIsSocialUser(provider === 'google' || provider === 'kakao')

      try {
        const data = await getCurrentUserApi()
        if (data) {
          setUserId(data.user.id)
          const currentEmail = data.profile.email || authUser?.email || ''
          const currentNickname = data.profile.nickname || authUser.user_metadata?.nickname || ''
          
          setEmail(currentEmail)
          setInitialEmail(currentEmail)
          setNickname(currentNickname)
          setInitialNickname(currentNickname)
          setProfileImageUrl(data.profile.profileimageurl || '')

          setIsNicknameChecked(true)
          setIsEmailChecked(true)
          setEmailVerified(false)
          setOtpSent(false)
          return
        }
      } catch (err) { console.error(err) }
    } catch (error) { console.error(error) }
  }, [navigate])

  useEffect(() => {
    refreshUserData()
    return () => {
      if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current)
    }
  }, [refreshUserData])

  const handleAvatarChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setSelectedFile(file)
    setMessage('📸 사진이 선택되었습니다. "저장하기"를 누르면 반영됩니다.')
  }

  const handleCheckNickname = async () => {
    if (!nickname.trim()) { setMessage('⚠️ 닉네임을 입력해주세요.'); return }
    if (nickname === initialNickname) { setIsNicknameChecked(true); setMessage('✅ 현재 사용 중인 닉네임입니다.'); return }
    try {
      setMessage('닉네임 중복 체크 중...')
      const res = await checkNicknameDuplicateApi(nickname)
      if (res.success) { setIsNicknameChecked(true); setMessage(`✅ ${res.message}`) }
      else { setIsNicknameChecked(false); setMessage(`❌ ${res.message}`) }
    } catch (error) { setIsNicknameChecked(false); setMessage(`❌ 중복 확인 실패: ${error.message}`) }
  }

  const handleCheckEmail = async () => {
    if (isSocialUser) { setMessage('⚠️ 소셜 계정은 이메일을 변경할 수 없어요.'); return }
    if (!email.trim()) { setMessage('⚠️ 이메일을 입력해주세요.'); return }
    if (email === initialEmail) { setIsEmailChecked(true); setMessage('✅ 현재 사용 중인 이메일입니다.'); return }
    try {
      setMessage('이메일 중복 체크 중...')
      // 1. profiles 테이블 확인 (다른 유저)
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email.trim())
        .neq('id', userId)
        .maybeSingle()
      if (profileError) throw profileError
      if (profileData) {
        setIsEmailChecked(false)
        setMessage('❌ 이미 사용 중인 이메일입니다.')
        return
      }
      // 2. auth.users 확인 (미완료 계정 포함) — updateUser 실패 방지
      const { data: isDuplicate, error: rpcError } = await supabase.rpc('check_email_exists', {
        email_to_check: email.trim(),
      })
      if (rpcError) throw rpcError
      if (isDuplicate) {
        setIsEmailChecked(false)
        setMessage('❌ 이미 등록된 이메일입니다. 다른 이메일을 사용해주세요.')
        return
      }
      setIsEmailChecked(true)
      setOtpSent(false)
      setMessage('✅ 사용 가능한 이메일입니다.')
    } catch (error) { setIsEmailChecked(false); setMessage(`❌ 중복 확인 실패: ${error.message}`) }
  }

  // OTP 전송 (이메일 변경용 — supabase.auth.updateUser 사용)
  const handleSendOtp = async () => {
    if (!isEmailChecked) { setMessage('⚠️ 먼저 이메일 중복 확인을 해주세요.'); return }
    if (countdown > 0) { setMessage(`⚠️ ${countdown}초 후에 다시 시도해주세요.`); return }

    try {
      setIsUploading(true)
      setMessage('📧 인증 코드를 발송 중입니다...')

      // 이메일 변경 확인 코드 전송 (signInWithOtp 아닌 updateUser 사용)
      const { error } = await supabase.auth.updateUser({ email: email.trim() })
      if (error) throw error

      setOtpSent(true)
      setCountdown(60)
      setMessage('📧 새 이메일로 6자리 인증 코드가 발송되었습니다. 인증번호를 입력하고 "확인"을 눌러주세요.')
    } catch (error) {
      if (error.message?.includes('rate limit')) {
        setMessage('❌ 보안을 위해 인증 메일 발송이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.')
        setCountdown(60)
      } else {
        setMessage(`❌ 인증 코드 발송 실패: ${error.message}`)
      }
    } finally { setIsUploading(false) }
  }

  // OTP 검증 (회원가입과 동일한 로직)
  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) { setMessage('⚠️ 6자리 인증 코드를 입력해주세요.'); return }
    try {
      setIsUploading(true)
      setMessage('확인 중...')
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode,
        type: 'email_change'
      })
      if (error) throw error
      setEmailVerified(true)
      setOtpSent(false)
      setMessage('✅ 이메일 인증이 완료되었습니다. "저장하기"를 눌러주세요.')
    } catch (error) {
      setMessage('❌ 인증 코드가 올바르지 않거나 만료되었습니다.')
    } finally { setIsUploading(false) }
  }

  const handleSaveAll = async () => {
    if (!nickname.trim()) { setMessage('⚠️ 닉네임을 입력해주세요.'); return }
    if (nickname !== initialNickname && !isNicknameChecked) { setMessage('⚠️ 닉네임 중복 확인을 해주세요.'); return }
    
    const isEmailChanged = !isSocialUser && email !== initialEmail
    if (isEmailChanged && !emailVerified) {
      setMessage('⚠️ 이메일 인증을 완료해주세요.'); return
    }

    try {
      setIsUploading(true)
      setMessage('🔄 정보를 저장 중입니다...')

      // 1. 사진 업로드
      if (selectedFile) {
        const uploadRes = await uploadAvatarApi(selectedFile, userId)
        if (!uploadRes.success) throw new Error('사진 업로드 실패')
      }

      // 2. 닉네임 변경
      if (nickname !== initialNickname) {
        await updateNicknameApi(nickname, userId)
      }

      // 3. 프로필 테이블 이메일 동기화 (auth.verifyOtp에서 이미 auth.users는 업데이트됨)
      if (isEmailChanged) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ email })
          .eq('id', userId)
        if (profileError) throw profileError
      }

      setMessage('✅ 모든 정보가 성공적으로 저장되었습니다.')
      setSelectedFile(null)
      setOtpCode('')
      if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl('') }
      await refreshUserData()
    } catch (error) {
      setMessage(`❌ 저장 실패: ${error.message}`)
    } finally { setIsUploading(false) }
  }

  // 비밀번호 변경 기능
  const handleUpdatePasswordDirect = async (e) => {
    e.preventDefault(); if (isSocialUser) return;
    
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/

    if (!currentPassword) { setMessage('⚠️ 현재 비밀번호를 입력해주세요.'); return }
    if (!newPassword) { setMessage('⚠️ 새 비밀번호를 입력해주세요.'); return }
    if (!passwordRegex.test(newPassword)) {
      setMessage('⚠️ 비밀번호는 영문 대/소문자, 숫자, 특수문자를 모두 포함하여 최소 8자 이상이어야 합니다.')
      return
    }
    if (newPassword !== confirmPassword) { setMessage('⚠️ 새 비밀번호 확인이 일치하지 않습니다.'); return }

    try {
      setIsUploading(true)
      setMessage('🔄 비밀번호를 변경 중입니다...')
      const res = await updatePasswordApi(currentPassword, newPassword)
      if (res.success) { 
        setMessage(`✅ ${res.message}`)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      }
    } catch (err) { 
      setMessage(`❌ ${err.message || '비밀번호 변경 실패'}`) 
    } finally {
      setIsUploading(false)
    }
  }

  const handleConfirmDeleteAccount = async (e) => {
    e.preventDefault(); if (deleteConfirmText !== '탈퇴하기') return;
    try {
      const res = await deleteUserAccountApi()
      if (res.success) { alert('탈퇴 완료'); window.location.href = '/' }
    } catch (e) { setMessage('탈퇴 실패') }
  }

  return (
    <div className="setting-container" style={{ paddingBottom: '90px' }}>
      <button
        onClick={() => navigate(-1)}
        style={{ border: 'none', background: 'none', fontSize: '24px', cursor: 'pointer', padding: '0 0 8px', display: 'block' }}
      >
        ←
      </button>
      <h2>내 정보 수정 ⚙️</h2>

      {/* 프로필 사진 */}
      <div className="edit-avatar-section">
        {previewUrl || profileImageUrl ? (
          <img src={previewUrl || profileImageUrl} alt="프로필" className="edit-avatar-preview" />
        ) : (
          <div className="edit-avatar-default">👤</div>
        )}
        <label htmlFor="avatar-file-input" className="avatar-upload-btn-label">
          {isUploading ? '처리 중...' : '사진 변경하기 📷'}
        </label>
        <input id="avatar-file-input" type="file" accept="image/*" onChange={handleAvatarChange} disabled={isUploading} style={{ display: 'none' }} />
      </div>

      {/* 닉네임 */}
      <div className="edit-form-group">
        <label>닉네임 변경</label>
        <div className="input-with-button">
          <input type="text" value={nickname} onChange={(e) => { setNickname(e.target.value); setIsNicknameChecked(e.target.value === initialNickname) }} />
          <button type="button" onClick={handleCheckNickname}>중복 확인</button>
        </div>
      </div>

      {/* 이메일 (OTP 인증 방식) */}
      <div className="edit-form-group">
        <label>이메일{isSocialUser ? '' : ' 변경'}</label>
        {isSocialUser ? (
          <>
            <input type="email" value={email} disabled style={{ width: '100%', boxSizing: 'border-box' }} />
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#888' }}>
              카카오 또는 구글로 로그인한 계정은 이메일을 변경할 수 없습니다.
            </p>
          </>
        ) : (
          <div className="input-with-button">
            <input
              type="email"
              value={email}
              disabled={emailVerified}
              onChange={(e) => {
                setEmail(e.target.value)
                setIsEmailChecked(e.target.value === initialEmail)
                setOtpSent(false)
                setEmailVerified(false)
              }}
            />
            <button type="button" onClick={handleCheckEmail} disabled={emailVerified}>
              중복 확인
            </button>
          </div>
        )}

        {emailVerified && (
          <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#4caf50', fontWeight: 'bold' }}>
            ✅ 인증 완료
          </p>
        )}

        {isEmailChecked && email !== initialEmail && !emailVerified && (
          <button
            type="button"
            onClick={handleSendOtp}
            disabled={isUploading || countdown > 0}
            style={{
              width: '100%',
              marginTop: '8px',
              padding: '10px',
              backgroundColor: countdown > 0 ? '#eee' : '#7c79ff',
              color: countdown > 0 ? '#aaa' : '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: countdown > 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {countdown > 0
              ? `${countdown}초 후 재전송 가능`
              : otpSent
              ? '인증 코드 재전송'
              : '이메일 인증하기'}
          </button>
        )}

        {otpSent && !emailVerified && (
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="text"
                placeholder="인증 코드 6자리"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                style={{ width: '100%', paddingRight: '50px', boxSizing: 'border-box' }}
              />
              <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: timeLeft <= 60 ? '#f44' : '#888' }}>
                {formatTime(timeLeft)}
              </span>
            </div>
            <button type="button" onClick={handleVerifyOtp} disabled={isUploading || timeLeft === 0}>
              확인
            </button>
          </div>
        )}
      </div>

      {/* 비밀번호 변경 (일반 로그인 사용자만) */}
      {!isSocialUser && (
        <div className="edit-form-group" style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
          <label>비밀번호 변경 🔒</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ position: 'relative' }}>
              <input 
                type={showCurrentPassword ? "text" : "password"} 
                placeholder="현재 비밀번호" 
                value={currentPassword} 
                onChange={(e) => setCurrentPassword(e.target.value)} 
                autoComplete="new-password"
                style={{ width: '100%', paddingRight: '40px' }}
              />
              <span 
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: '#888' }}
              >
                {showCurrentPassword ? <FaEyeSlash /> : <FaEye />}
              </span>
            </div>
            
            <div style={{ position: 'relative' }}>
              <input 
                type={showNewPassword ? "text" : "password"} 
                placeholder="새 비밀번호" 
                value={newPassword} 
                onChange={(e) => setNewPassword(e.target.value)} 
                autoComplete="new-password"
                style={{ width: '100%', paddingRight: '40px' }}
              />
              <span 
                onClick={() => setShowNewPassword(!showNewPassword)}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: '#888' }}
              >
                {showNewPassword ? <FaEyeSlash /> : <FaEye />}
              </span>
            </div>
            {newPassword && (
              <p style={{ 
                fontSize: '12px', 
                margin: '0 0 4px 4px', 
                color: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(newPassword) ? '#4caf50' : '#f44336' 
              }}>
                {/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(newPassword) 
                  ? '✅ 안전한 비밀번호입니다.' 
                  : '❌ 영문 대/소문자, 숫자, 특수문자 포함 8자 이상'}
              </p>
            )}

            <div style={{ position: 'relative' }}>
              <input 
                type={showConfirmPassword ? "text" : "password"} 
                placeholder="새 비밀번호 확인" 
                value={confirmPassword} 
                onChange={(e) => setConfirmPassword(e.target.value)} 
                autoComplete="new-password"
                style={{ width: '100%', paddingRight: '40px' }}
              />
              <span 
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: '#888' }}
              >
                {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
              </span>
            </div>
            {confirmPassword && (
              <p style={{ 
                fontSize: '12px', 
                margin: '0 0 4px 4px', 
                color: newPassword === confirmPassword ? '#4caf50' : '#f44336' 
              }}>
                {newPassword === confirmPassword ? '✅ 비밀번호가 일치합니다.' : '❌ 비밀번호가 일치하지 않습니다.'}
              </p>
            )}

            <button 
              type="button" 
              onClick={handleUpdatePasswordDirect} 
              disabled={isUploading}
              style={{ 
                marginTop: '5px', 
                padding: '10px', 
                backgroundColor: '#f0f0f0', 
                border: '1px solid #ddd', 
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600'
              }}
            >
              비밀번호 변경하기
            </button>
          </div>
        </div>
      )}

      {/* 알림 메시지 */}
      {message && <p className="status-message">{message}</p>}

      <div className="bottom-button-group">
        <button onClick={handleSaveAll} className="save-all-button" disabled={isUploading}>저장하기</button>
      </div>

      {/* 회원 탈퇴 */}
      <div className="delete-account-section" style={{ marginTop: '40px' }}>
        {!showDeleteForm ? (
          <button type="button" onClick={() => setShowDeleteForm(true)} className="delete-link-btn">회원 탈퇴하기 😢</button>
        ) : (
          <form onSubmit={handleConfirmDeleteAccount} className="delete-confirm-form">
            <h4>🚨 회원 탈퇴 확인</h4>
            <div className="delete-input-group">
              <input type="text" placeholder='아래 빈칸에 "탈퇴하기" 라고 입력' value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} />
            </div>
            <div className="delete-action-buttons">
              <button type="submit" className="delete-submit-btn">진짜 탈퇴하기</button>
              <button type="button" onClick={() => setShowDeleteForm(false)} className="delete-cancel-btn">취소</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default SettingEditPage
