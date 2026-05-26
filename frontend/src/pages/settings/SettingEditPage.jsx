import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentUserApi } from '../../api/authApi'
import { 
  updateNicknameApi, 
  updateEmailApi,
  uploadAvatarApi,
  updatePasswordApi,
  deleteUserAccountApi 
} from '../../api/settingApi'

function SettingEditPage() {
  const navigate = useNavigate()
  const [userId, setUserId] = useState('')
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [profileImageUrl, setProfileImageUrl] = useState('')
  const [message, setMessage] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  
  // 🔒 비밀번호 입력용 State
  const [currentPassword, setCurrentPassword] = useState('') 
  const [newPassword, setNewPassword] = useState('')

  // 😢 회원 탈퇴 전용 독립 State
  const [showDeleteForm, setShowDeleteForm] = useState(false) 
  const [deletePassword, setDeletePassword] = useState('')     
  const [deleteConfirmText, setDeleteConfirmText] = useState('') 

  // ⏳ 실시간 타이머용 State 및 Ref
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef(null)

  // 🔄 최신 데이터 새로고침 함수
  const refreshUserData = async () => {
    try {
      const data = await getCurrentUserApi()
      if (data) {
        setUserId(data.user.id)
        setEmail(data.profile.email || '')
        setNickname(data.profile.nickname || '')
        setProfileImageUrl(data.profileimageurl || '')
      } else {
        alert('로그인이 만료되었습니다.')
        navigate('/login')
      }
    } catch (error) {
      console.error('데이터 동기화 실패:', error)
    }
  }

  // 초기 로드 및 타이머 정리
  useEffect(() => {
    refreshUserData()
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate])

  // ⏱️ 에러 메시지에서 숫자를 파싱해서 타이머를 가동하는 함수
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

  // 📸 프로필 사진 변경
  const handleAvatarChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    try {
      setIsUploading(true)
      setMessage('📸 프로필 이미지를 서버에 업로드 중입니다...')
      const res = await uploadAvatarApi(file, userId)
      if (res.success) {
        setProfileImageUrl(res.publicUrl)
        setMessage(`✅ ${res.message}`)
      }
    } catch (error) {
      setMessage(`❌ 사진 변경 실패: ${error.message}`)
    } finally {
      setIsUploading(false)
    }
  }

  // 🏷️ 닉네임 변경
  const handleUpdateNickname = async (e) => {
    e.preventDefault()
    if (!nickname.trim()) {
      setMessage('⚠️ 닉네임을 입력해주세요.')
      return
    }
    try {
      setMessage('닉네임 중복 및 수정 상태 체크 중...')
      const res = await updateNicknameApi(nickname, userId)
      if (res.success) {
        setMessage(`✅ ${res.message}`)
        await refreshUserData()
      }
    } catch (error) {
      setMessage(`❌ 닉네임 변경 실패: ${error.message}`)
    }
  }

  // 📧 이메일 변경
  const handleUpdateEmail = async (e) => {
    e.preventDefault()
    if (!email.trim()) {
      setMessage('⚠️ 이메일을 입력해주세요.')
      return
    }
    try {
      setMessage('이메일 중복 및 수정 상태 체크 중...')
      const res = await updateEmailApi(email, userId)
      if (res.success) {
        setMessage(`✅ ${res.message}`)
        await refreshUserData()
      }
    } catch (error) {
      if (error.message.includes('seconds')) {
        startRateLimitTimer(error.message)
      } else {
        setMessage(`❌ 이메일 변경 실패: ${error.message}`)
      }
    }
  }

  // 🔒 정석 비밀번호 변경 핸들러
  const handleUpdatePasswordDirect = async (e) => {
    e.preventDefault()
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
      setMessage(`❌ 비밀번호 변경 실패: 현재 비밀번호가 일치하지 않거나 오류가 발생했습니다.`)
    }
  }

  // 😢 회원 탈퇴 최종 승인 핸들러
  const handleConfirmDeleteAccount = async (e) => {
    e.preventDefault()

    if (!deletePassword.trim()) {
      alert('🔒 보안을 위해 현재 비밀번호를 입력해 주세요.')
      return
    }

    if (deleteConfirmText !== '탈퇴하기') {
      alert('❌ 확정 문구에 "탈퇴하기"를 정확하게 입력해 주세요.')
      return
    }

    if (!window.confirm('🚨 [최종 경고] 정말 탈퇴하시겠습니까? 이 작업은 절대 되돌릴 수 없습니다.')) return

    try {
      setMessage('비밀번호 검증 및 회원 탈퇴 요청 중...')
      const res = await deleteUserAccountApi(userId, deletePassword)
      
      if (res.success) {
        alert('👋 회원 탈퇴가 성공적으로 완료되었습니다. 그동안 이용해 주셔서 감사합니다.')
        window.location.href = '/' 
      }
    } catch (error) {
      if (error.message.includes('password') || error.message.includes('Invalid')) {
        setMessage('❌ 회원 탈퇴 실패: 현재 비밀번호가 일치하지 않습니다.')
        alert('❌ 비밀번호가 올바르지 않습니다. 다시 확인해 주세요.')
      } else {
        setMessage(`❌ 회원 탈퇴 실패: ${error.message}`)
      }
    }
  }

  return (
    <div className="setting-container" style={{ paddingBottom: "90px" }}>
      <h2>내 정보 수정 ⚙️</h2>

      {/* 📸 1. 프로필 사진 변경 섹션 */}
      <div className="edit-avatar-section">
        {profileImageUrl ? (
          <img src={profileImageUrl} alt="프로필" className="edit-avatar-preview" />
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

      {/* 🏷️ 2. 닉네임 변경 양식 */}
      <form onSubmit={handleUpdateNickname} className="edit-form-group">
        <label>닉네임 변경</label>
        <div className="input-with-button">
          <input 
            type="text" 
            value={nickname} 
            onChange={(e) => setNickname(e.target.value)} 
          />
          <button type="submit">닉네임 저장</button>
        </div>
      </form>

      {/* 📧 3. 이메일 변경 양식 */}
      <form onSubmit={handleUpdateEmail} className="edit-form-group">
        <label>이메일 변경</label>
        <div className="input-with-button">
          <input 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
          />
          <button type="submit">이메일 저장</button>
        </div>
      </form>

      {/* 🔒 4. 비밀번호 변경 양식 */}
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

      {/* 🔔 알림 메시지 구역 */}
      {countdown > 0 ? (
        <p className="status-message-timer">
          ⏳ 보안상의 이유로 {countdown}초 후에 다시 요청할 수 있습니다.
        </p>
      ) : (
        message && <p className="status-message">{message}</p>
      )}

      {/* ⬅️ 하단 버튼 레이아웃 구역 */}
      <div className="bottom-button-group">
        <button onClick={() => navigate('/settings')} className="back-button">
           이전으로 돌아가기
        </button>
        <button onClick={() => navigate('/home')} className="home-button">
           🏠 홈화면으로 이동
        </button>
      </div>

      {/* 😢 5. 보안 업그레이드형 회원 탈퇴 컴포넌트 양식 */}
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
          <form onSubmit={handleConfirmDeleteAccount} className="delete-confirm-form">
            <h4>🚨 회원 탈퇴 확인</h4>
            <p className="delete-notice-text">
              탈퇴 시 프로필 정보 및 모든 쇼핑몰 데이터가 영구히 삭제됩니다. <br />
              보안을 위해 현재 비밀번호와 확정 문구를 정확히 작성해 주세요.
            </p>
            
            <div className="delete-input-group">
              <input 
                type="password"
                placeholder="현재 비밀번호 확인"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
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