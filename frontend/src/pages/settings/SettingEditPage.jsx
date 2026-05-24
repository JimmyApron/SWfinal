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

  // 😢 회원 탈퇴 전용 독립 State 💥
  const [showDeleteForm, setShowDeleteForm] = useState(false) // 탈퇴 폼 열림/닫힘 상태
  const [deletePassword, setDeletePassword] = useState('')     // 탈퇴 확인용 비밀번호 입력값
  const [deleteConfirmText, setDeleteConfirmText] = useState('') // "탈퇴하기" 확인 텍스트 입력값

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
        setProfileImageUrl(data.profile.profile_image_url || '')
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

  // 😢 화면단 비밀번호 입력 + 2중 가드 탈퇴 최종 승인 핸들러 (수정 완료 💥)
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
      
      // API에 유저 ID와 입력받은 확인용 비밀번호를 같이 실어서 보냅니다!
      const res = await deleteUserAccountApi(userId, deletePassword)
      
      if (res.success) {
        alert('👋 회원 탈퇴가 성공적으로 완료되었습니다. 그동안 이용해 주셔서 감사합니다.')
        window.location.href = '/' // 완전히 세션을 파괴하고 첫 화면으로 리프레시 이동
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
    <div className="edit-container">
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
          style={{ display: 'none' }}
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
          <p className="password-notice-text" style={{ marginBottom: '10px' }}>
            현재 비밀번호를 입력하고 새 비밀번호로 수정합니다.
          </p>
          
          <div className="password-input-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
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
            <button type="submit" style={{ width: '100%' }}>비밀번호 저장</button>
          </div>
        </form>
      </div>

      {/* 🔔 알림 메시지 구역 */}
      {countdown > 0 ? (
        <p className="status-message" style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
          ⏳ 보안상의 이유로 {countdown}초 후에 다시 요청할 수 있습니다.
        </p>
      ) : (
        message && <p className="status-message">{message}</p>
      )}

      {/* ⬅️ 하단 버튼 레이아웃 구역 */}
      <div className="bottom-button-group" style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
        <button onClick={() => navigate('/settings')} className="back-button" style={{ flex: 1 }}>
           이전으로 돌아가기
        </button>
        <button onClick={() => navigate('/home')} className="home-button" style={{ flex: 1, backgroundColor: '#4caf50', color: '#fff' }}>
           🏠 홈화면으로 이동
        </button>
      </div>

      {/* 😢 5. 보안 업그레이드형 회원 탈퇴 컴포넌트 양식 */}
      <div className="delete-account-section" style={{ marginTop: '50px', textAlign: 'center', borderTop: '1px dashed #eee', paddingTop: '20px' }}>
        
        {!showDeleteForm ? (
          // 기본 숨김 링크 상태
          <button 
            type="button"
            onClick={() => setShowDeleteForm(true)} 
            style={{ background: 'none', border: 'none', color: '#bbb', fontSize: '12px', textDecoration: 'underline', cursor: 'pointer' }}
          >
            회원 탈퇴하기 😢
          </button>
        ) : (
          // 링크를 누르면 열리는 보안 탈퇴 폼 UI 💥
          <form onSubmit={handleConfirmDeleteAccount} style={{ textAlign: 'left', maxWidth: '100%', padding: '15px', backgroundColor: '#fafafa', borderRadius: '6px', border: '1px solid #ebd2d2' }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#e53935', fontSize: '14px' }}>🚨 회원 탈퇴 확인</h4>
            <p style={{ fontSize: '12px', color: '#666', margin: '0 0 12px 0', lineHeight: '1.4' }}>
              탈퇴 시 프로필 정보 및 모든 쇼핑몰 데이터가 영구히 삭제됩니다. <br />
              보안을 위해 현재 비밀번호와 확정 문구를 정확히 작성해 주세요.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
              <input 
                type="password"
                placeholder="현재 비밀번호 확인"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                style={{ padding: '8px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px' }}
              />
              <input 
                type="text"
                placeholder='아래 빈칸에 "탈퇴하기" 라고 입력'
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                style={{ padding: '8px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                type="submit"
                style={{ flex: 1, backgroundColor: '#e53935', color: '#fff', padding: '8px', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                진짜 탈퇴하기
              </button>
              <button 
                type="button"
                onClick={() => {
                  setShowDeleteForm(false)
                  setDeletePassword('')
                  setDeleteConfirmText('')
                }}
                style={{ flex: 1, backgroundColor: '#eceff1', color: '#37474f', padding: '8px', border: 'none', borderRadius: '4px', fontSize: '13px', cursor: 'pointer' }}
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