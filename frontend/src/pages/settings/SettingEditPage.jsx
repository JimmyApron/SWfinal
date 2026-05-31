import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentUserApi } from '../../api/authApi'
import { supabase } from '../../lib/supabaseClient'
import {
  updateNicknameApi,
  checkNicknameDuplicateApi,
  updateEmailApi,
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
  const [selectedFile, setSelectedFile] = useState(null) // 실제 업로드할 파일 객체
  const [previewUrl, setPreviewUrl] = useState('') // 화면에 보여줄 미리보기 URL
  const [message, setMessage] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  // 변경 여부 확인을 위한 초기값 보관 State
  const [initialNickname, setInitialNickname] = useState('')
  const [initialEmail, setInitialEmail] = useState('')

  // 소셜 로그인 여부
  const [isSocialUser, setIsSocialUser] = useState(false)

  // 중복 확인 상태
  const [isNicknameChecked, setIsNicknameChecked] = useState(false)
  const [isEmailChecked, setIsEmailChecked] = useState(false)

  // 비밀번호 입력용 State
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  // 회원 탈퇴 전용 State
  const [showDeleteForm, setShowDeleteForm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // 실시간 타이머용 State 및 Ref
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef(null)

  // 컴포넌트 언마운트 시 미리보기 URL 메모리 해제
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  // 최신 데이터 새로고침 함수
  const refreshUserData = useCallback(async () => {
    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()

      if (!authUser) {
        alert('로그인이 만료되었습니다.')
        navigate('/login')
        return
      }

      const provider = authUser?.app_metadata?.provider
      const social = provider === 'google' || provider === 'kakao'
      setIsSocialUser(social)

      try {
        const data = await getCurrentUserApi()

        if (data) {
          setUserId(data.user.id)
          
          const currentEmail = data.profile.email || authUser?.email || ''
          const currentNickname = data.profile.nickname ||
            authUser.user_metadata?.full_name ||
            authUser.user_metadata?.name ||
            authUser.email?.split('@')[0] ||
            ''
          
          setEmail(currentEmail)
          setInitialEmail(currentEmail)
          setNickname(currentNickname)
          setInitialNickname(currentNickname)
          
          setProfileImageUrl(
            data.profile.profileimageurl ||
              authUser.user_metadata?.avatar_url ||
              authUser.user_metadata?.picture ||
              ''
          )

          setIsNicknameChecked(true)
          setIsEmailChecked(true)
          return
        }
      } catch (err) {
        console.error('프로필 조회 실패, 메타데이터 폴백:', err)
      }

      setUserId(authUser.id)
      const fbEmail = authUser.email || ''
      const fbNickname = authUser.user_metadata?.full_name ||
        authUser.user_metadata?.name ||
        authUser.email?.split('@')[0] ||
        ''

      setEmail(fbEmail)
      setInitialEmail(fbEmail)
      setNickname(fbNickname)
      setInitialNickname(fbNickname)
      
      setProfileImageUrl(
        authUser.user_metadata?.avatar_url ||
          authUser.user_metadata?.picture ||
          ''
      )

      setIsNicknameChecked(true)
      setIsEmailChecked(true)
    } catch (error) {
      console.error('데이터 동기화 실패:', error)
    }
  }, [navigate])

  useEffect(() => {
    refreshUserData()

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [refreshUserData])

  // Rate limit 타이머
  const startRateLimitTimer = (errorMessage) => {
    const secondsMatch = errorMessage.match(/\d+/)
    if (!secondsMatch) return

    const seconds = parseInt(secondsMatch[0], 10)
    setCountdown(seconds)

    if (timerRef.current) clearInterval(timerRef.current)

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          setMessage('')
          return 0
        }

        return prev - 1
      })
    }, 1000)
  }

  // 프로필 사진 선택 (미리보기만 처리)
  const handleAvatarChange = (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (previewUrl) URL.revokeObjectURL(previewUrl)

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setSelectedFile(file)
    setMessage('📸 사진이 선택되었습니다. "저장하기"를 누르면 반영됩니다.')
  }

  // 닉네임 중복 확인
  const handleCheckNickname = async () => {
    if (!nickname.trim()) {
      setMessage('⚠️ 닉네임을 입력해주세요.')
      return
    }

    if (nickname === initialNickname) {
      setIsNicknameChecked(true)
      setMessage('✅ 현재 사용 중인 닉네임입니다.')
      return
    }

    try {
      setMessage('닉네임 중복 체크 중...')
      const res = await checkNicknameDuplicateApi(nickname)

      if (res.success) {
        setIsNicknameChecked(true)
        setMessage(`✅ ${res.message}`)
      } else {
        setIsNicknameChecked(false)
        setMessage(`❌ ${res.message}`)
      }
    } catch (error) {
      setIsNicknameChecked(false)
      setMessage(`❌ 중복 확인 실패: ${error.message}`)
    }
  }

  // 이메일 중복 확인
  const handleCheckEmail = async () => {
    if (isSocialUser) {
      setMessage('⚠️ 소셜 로그인 계정은 이메일을 변경할 수 없어요.')
      return
    }

    if (!email.trim()) {
      setMessage('⚠️ 이메일을 입력해주세요.')
      return
    }

    if (email === initialEmail) {
      setIsEmailChecked(true)
      setMessage('✅ 현재 사용 중인 이메일입니다.')
      return
    }

    try {
      setMessage('이메일 중복 체크 중...')
      const res = await checkEmailDuplicateApi(email)

      if (res.success) {
        setIsEmailChecked(true)
        setMessage(`✅ ${res.message}`)
      } else {
        setIsEmailChecked(false)
        setMessage(`❌ ${res.message}`)
      }
    } catch (error) {
      setIsEmailChecked(false)
      setMessage(`❌ 중복 확인 실패: ${error.message}`)
    }
  }

  // 모든 정보 통합 저장
  const handleSaveAll = async () => {
    if (!nickname.trim()) {
      setMessage('⚠️ 닉네임을 입력해주세요.')
      return
    }

    // 닉네임이 변경되었는데 중복 확인을 안 한 경우에만 차단
    if (nickname !== initialNickname && !isNicknameChecked) {
      setMessage('⚠️ 변경된 닉네임의 중복 확인을 해주세요.')
      return
    }

    if (!isSocialUser) {
      if (!email.trim()) {
        setMessage('⚠️ 이메일을 입력해주세요.')
        return
      }
      // 이메일이 변경되었는데 중복 확인을 안 한 경우에만 차단
      if (email !== initialEmail && !isEmailChecked) {
        setMessage('⚠️ 변경된 이메일의 중복 확인을 해주세요.')
        return
      }
    }

    try {
      setIsUploading(true)
      setMessage('🔄 정보를 저장 중입니다...')

      // 1. 이미지 파일이 선택되어 있다면 먼저 업로드
      if (selectedFile) {
        setMessage('📸 프로필 이미지를 서버에 업로드 중입니다...')
        const uploadRes = await uploadAvatarApi(selectedFile, userId)
        if (!uploadRes.success) {
          throw new Error('사진 업로드 중 오류가 발생했습니다.')
        }
      }

      // 2. 닉네임 업데이트 (변경된 경우에만)
      if (nickname !== initialNickname) {
        await updateNicknameApi(nickname, userId)
      }

      // 3. 이메일 업데이트 (변경된 경우에만)
      if (!isSocialUser && email !== initialEmail) {
        await updateEmailApi(email, userId)
      }

      setMessage('✅ 모든 정보가 성공적으로 저장되었습니다.')
      setSelectedFile(null)
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        setPreviewUrl('')
      }
      await refreshUserData()
    } catch (error) {
      if (error.message.includes('seconds')) {
        startRateLimitTimer(error.message)
      } else {
        setMessage(`❌ 저장 실패: ${error.message}`)
      }
    } finally {
      setIsUploading(false)
    }
  }

  // 비밀번호 변경
  const handleUpdatePasswordDirect = async (e) => {
    e.preventDefault()

    if (isSocialUser) {
      setMessage('⚠️ 소셜 로그인 계정은 비밀번호를 이 화면에서 변경할 수 없어요.')
      return
    }

    if (!currentPassword.trim()) {
      setMessage('⚠️ 현재 비밀번호를 입력해주세요.')
      return
    }

    if (!newPassword.trim()) {
      setMessage('⚠️ 새 비밀번호를 입력해주세요.')
      return
    }

    if (newPassword.length < 6) {
      setMessage('⚠️ 새 비밀번호는 최소 6자리 이상이어야 합니다.')
      return
    }

    if (currentPassword === newPassword) {
      setMessage('⚠️ 현재 비밀번호와 새 비밀번호가 동일합니다.')
      return
    }

    try {
      setMessage('비밀번호 변경 여부 검증 중...')
      const res = await updatePasswordApi(currentPassword, newPassword)

      if (res.success) {
        setMessage(`✅ ${res.message}`)
        setCurrentPassword('')
        setNewPassword('')
      }
    } catch (error) {
      setMessage('❌ 비밀번호 변경 실패: 현재 비밀번호가 일치하지 않거나 오류가 발생했습니다.')
    }
  }

  // 회원 탈퇴
  const handleConfirmDeleteAccount = async (e) => {
    e.preventDefault()

    if (!isSocialUser && !deletePassword.trim()) {
      alert('🔒 보안을 위해 현재 비밀번호를 입력해 주세요.')
      return
    }

    if (deleteConfirmText !== '탈퇴하기') {
      alert('❌ 확정 문구에 "탈퇴하기"를 정확하게 입력해 주세요.')
      return
    }

    if (!window.confirm('🚨 [최종 경고] 정말 탈퇴하시겠습니까? 이 작업은 절대 되돌릴 수 없습니다.')) {
      return
    }

    try {
      setMessage('회원 탈퇴 요청 중...')
      const res = await deleteUserAccountApi(isSocialUser ? undefined : deletePassword)

      if (res.success) {
        alert('👋 회원 탈퇴가 성공적으로 완료되었습니다. 그동안 이용해 주셔서 감사합니다.')
        window.location.href = '/'
      }
    } catch (error) {
      setMessage(`❌ 회원 탈퇴 실패: ${error.message}`)
    }
  }

  return (
    <div className="setting-container" style={{ paddingBottom: '90px' }}>
      <h2>내 정보 수정 ⚙️</h2>

      {/* 프로필 사진 변경 */}
      <div className="edit-avatar-section">
        {previewUrl || profileImageUrl ? (
          <img
            src={previewUrl || profileImageUrl}
            alt="프로필"
            className="edit-avatar-preview"
          />
        ) : (
          <div className="edit-avatar-default">👤</div>
        )}

        <label htmlFor="avatar-file-input" className="avatar-upload-btn-label">
          {isUploading ? '업로드 중...' : '사진 변경하기 📷'}
        </label>

        <input
          id="avatar-file-input"
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          disabled={isUploading}
          className="hidden-file-input"
        />
      </div>

      {/* 닉네임 변경 */}
      <div className="edit-form-group">
        <label>닉네임 변경</label>

        <div className="input-with-button">
          <input
            type="text"
            value={nickname}
            onChange={(e) => {
              const val = e.target.value
              setNickname(val)
              // 입력값이 초기값과 같으면 체크 완료 상태로 유지, 다르면 체크 해제
              setIsNicknameChecked(val === initialNickname)
            }}
          />

          <button type="button" onClick={handleCheckNickname}>
            중복 확인
          </button>
        </div>
      </div>

      {/* 이메일 변경 */}
      {isSocialUser ? (
        <div className="edit-form-group">
          <label>이메일</label>

          <div className="input-with-button">
            <input
              type="email"
              value={email}
              disabled
              style={{
                backgroundColor: '#f5f5f5',
                color: '#999',
                cursor: 'not-allowed',
              }}
            />
          </div>

          <p style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
            소셜 로그인 계정은 이메일을 변경할 수 없어요.
          </p>
        </div>
      ) : (
        <div className="edit-form-group">
          <label>이메일 변경</label>

          <div className="input-with-button">
            <input
              type="email"
              value={email}
              onChange={(e) => {
                const val = e.target.value
                setEmail(val)
                setIsEmailChecked(val === initialEmail)
              }}
            />

            <button type="button" onClick={handleCheckEmail}>
              중복 확인
            </button>
          </div>
        </div>
      )}

      {/* 비밀번호 변경 - 소셜 유저는 숨김 */}
      {!isSocialUser && (
        <div className="edit-form-group">
          <label>비밀번호 변경</label>

          <form onSubmit={handleUpdatePasswordDirect}>
            <p className="password-notice-text">
              현재 비밀번호를 입력하고 새 비밀번호로 수정합니다.
            </p>

            <div className="password-input-wrapper">
              <input
                type="password"
                placeholder="현재 비밀번호 입력"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />

              <input
                type="password"
                placeholder="새 비밀번호 입력 (6자리 이상)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="input-with-button">
              <button type="submit">비밀번호 저장</button>
            </div>
          </form>
        </div>
      )}

      {/* 알림 메시지 */}
      {countdown > 0 ? (
        <p className="status-message-timer">
          ⏳ 보안상의 이유로 {countdown}초 후에 다시 요청할 수 있습니다.
        </p>
      ) : (
        message && <p className="status-message">{message}</p>
      )}

      {/* 하단 버튼 */}
      <div className="bottom-button-group">
        <button onClick={handleSaveAll} className="save-all-button">
          저장하기
        </button>
      </div>

      {/* 회원 탈퇴 */}
      <div className="delete-account-section">
        {!showDeleteForm ? (
          <button
            type="button"
            onClick={() => setShowDeleteForm(true)}
            className="delete-link-btn"
          >
            회원 탈퇴하기 😢
          </button>
        ) : (
          <form
            onSubmit={handleConfirmDeleteAccount}
            className="delete-confirm-form"
          >
            <h4>🚨 회원 탈퇴 확인</h4>

            <p className="delete-notice-text">
              탈퇴 시 프로필 정보 및 모든 데이터가 영구히 삭제됩니다. <br />
              확정 문구를 정확히 입력해 주세요.
            </p>

            <div className="delete-input-group">
              {!isSocialUser && (
                <input
                  type="password"
                  placeholder="현재 비밀번호 확인"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                />
              )}

              <input
                type="text"
                placeholder='아래 빈칸에 "탈퇴하기" 라고 입력'
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />
            </div>

            <div className="delete-action-buttons">
              <button type="submit" className="delete-submit-btn">
                진짜 탈퇴하기
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowDeleteForm(false)
                  setDeletePassword('')
                  setDeleteConfirmText('')
                }}
                className="delete-cancel-btn"
              >
                탈퇴 취소
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default SettingEditPage
