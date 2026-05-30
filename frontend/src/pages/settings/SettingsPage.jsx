import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGoogleLogin } from '@react-oauth/google'
import { logoutApi } from '../../api/authApi'
import { getCurrentUserApi } from '../../api/authApi'

function Toggle({ value, onChange }) {
  return (
    <div
      onClick={onChange}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        cursor: 'pointer',
        backgroundColor: value ? '#7c79ff' : '#ccc',
        position: 'relative',
        transition: 'background-color 0.2s',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          backgroundColor: '#fff',
          position: 'absolute',
          top: '2px',
          left: value ? '22px' : '2px',
          transition: 'left 0.2s',
        }}
      />
    </div>
  )
}

function SettingsPage() {
  const navigate = useNavigate()
  const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID
  const [userProfile, setUserProfile] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  const [googleConnected, setGoogleConnected] = useState(
    !!localStorage.getItem('google_calendar_token')
  )

  const [googleAutoSync, setGoogleAutoSync] = useState(
    localStorage.getItem('google_calendar_auto_sync') === 'true'
  )

  const googleLogin = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/calendar.events',
    onSuccess: (tokenResponse) => {
      const expiry = Date.now() + tokenResponse.expires_in * 1000

      localStorage.setItem('google_calendar_token', tokenResponse.access_token)
      localStorage.setItem('google_calendar_token_expiry', String(expiry))

      setGoogleConnected(true)
      alert('구글 캘린더가 연결되었습니다!')
    },
    onError: () => alert('구글 캘린더 연결에 실패했습니다.'),
  })

  const handleGoogleDisconnect = () => {
    localStorage.removeItem('google_calendar_token')
    localStorage.removeItem('google_calendar_token_expiry')
    localStorage.removeItem('google_calendar_auto_sync')

    setGoogleConnected(false)
    setGoogleAutoSync(false)
  }

  const handleAutoSyncToggle = () => {
    const next = !googleAutoSync
    localStorage.setItem('google_calendar_auto_sync', String(next))
    setGoogleAutoSync(next)
  }

  const handleLogout = async () => {
    if (!window.confirm('정말 로그아웃 하시겠습니까? 🥺')) return

    try {
      logoutApi()
      window.location.href = '/'
    } catch (error) {
      window.location.href = '/'
    }
  }

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const data = await getCurrentUserApi()

        if (data) {
          setUserProfile(data.profile)
        } else {
          alert('로그인이 필요한 페이지입니다.')
          navigate('/')
        }
      } catch (error) {
        console.error('유저 정보 로드 실패:', error)

        if (
          error.message?.includes('session missing') ||
          error.message?.includes('AuthSessionMissingError')
        ) {
          navigate('/')
          return
        }
      } finally {
        setIsLoading(false)
      }
    }

    fetchUserData()
  }, [navigate])

  if (isLoading) {
    return <div className="loading-container">로딩 중...</div>
  }

  return (
    <div className="setting-container" style={{ paddingBottom: '90px' }}>
      <h2>마이페이지 👤</h2>

      <div className="profile-image-section">
        {userProfile?.profileimageurl ? (
          <img
            src={userProfile.profileimageurl}
            alt="프로필 사진"
            className="profile-avatar"
          />
        ) : (
          <div className="profile-avatar-default">👤</div>
        )}
      </div>

      <div className="profile-info-group">
        <label className="info-label">닉네임</label>
        <p className="info-value">{userProfile?.nickname || '닉네임 없음'}</p>
      </div>

      <div className="profile-info-group">
        <label className="info-label">이메일</label>
        <p className="info-value">
          {userProfile?.email || '이메일 정보 없음'}
        </p>
      </div>

      <div className="profile-info-group">
        <label className="info-label">구글 캘린더 연동</label>

        {googleConnected ? (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              <span style={{ fontSize: '14px', color: '#4CAF50' }}>
                ✓ 연결됨
              </span>

              <button
                onClick={handleGoogleDisconnect}
                style={{
                  fontSize: '13px',
                  color: '#f44',
                  border: '1px solid #f44',
                  background: 'none',
                  borderRadius: '8px',
                  padding: '4px 12px',
                  cursor: 'pointer',
                }}
              >
                연결 해제
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: '14px', color: '#333' }}>
                확정 일정 자동 추가
              </span>

              <Toggle value={googleAutoSync} onChange={handleAutoSyncToggle} />
            </div>

            <p style={{ fontSize: '11px', color: '#aaa', margin: '4px 0 0' }}>
              켜면 캘린더에 등록한 일정이 구글 캘린더에 자동으로 추가됩니다
            </p>
          </div>
        ) : (
          <button
            onClick={() => googleLogin()}
            disabled={!googleClientId}
            style={{
              fontSize: '14px',
              color: '#fff',
              backgroundColor: googleClientId ? '#4285F4' : '#aaa',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              cursor: googleClientId ? 'pointer' : 'not-allowed',
            }}
          >
            Google 캘린더 연결
          </button>
        )}

        {!googleClientId && (
          <p style={{ fontSize: '12px', color: '#888', marginBottom: 0 }}>
            Google OAuth Client ID 설정이 필요합니다.
          </p>
        )}
      </div>

      <div className="setting-actions">
        <button
          onClick={() => navigate('/settings/edit')}
          className="edit-navigation-button"
        >
          내 정보 수정하기 ⚙️
        </button>

        <div className="bottom-actions-wrapper">
          <button onClick={() => navigate('/home')} className="home-button">
            🏠 홈화면으로 이동
          </button>

          <button onClick={handleLogout} className="logout-btn">
            🚪 로그아웃
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
