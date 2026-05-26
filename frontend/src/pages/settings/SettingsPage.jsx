import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGoogleLogin } from '@react-oauth/google'
import { logoutApi } from '../../api/authApi'
import { getCurrentUserApi } from '../../api/authApi'

function SettingsPage() { 
  const navigate = useNavigate()
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
      const expiry = Date.now() + tokenResponse.expires_in * 1000;
      localStorage.setItem('google_calendar_token', tokenResponse.access_token);
      localStorage.setItem('google_calendar_token_expiry', String(expiry));
      setGoogleConnected(true);
      alert('구글 캘린더가 연결되었습니다!');
    },
    onError: () => alert('구글 캘린더 연결에 실패했습니다.'),
  })

  const handleGoogleDisconnect = () => {
    localStorage.removeItem('google_calendar_token');
    localStorage.removeItem('google_calendar_token_expiry');
    localStorage.removeItem('google_calendar_auto_sync');
    setGoogleConnected(false);
    setGoogleAutoSync(false);
  }

  const handleAutoSyncToggle = () => {
    const next = !googleAutoSync;
    localStorage.setItem('google_calendar_auto_sync', String(next));
    setGoogleAutoSync(next);
  }

  // 🚪 로그아웃 처리 핸들러 (응답 대기 없는 초고속 버전 💥)
  const handleLogout = async () => {
    if (!window.confirm('정말 로그아웃 하시겠습니까? 🥺')) return

    try {
      // 💡 1. 서버에 로그아웃 신호는 백그라운드로 던져두고!
      logoutApi() 
      
      // 💡 2. 유저는 기다리게 하지 않고 즉시 메인 대문('/') 화면으로 강제 워프 사출!!!
      window.location.href = '/' 
    } catch (error) {
      // 혹시 모를 에러 발생 시에도 그냥 대문으로 튕기기
      window.location.href = '/'
    }
  }

  // 화면이 켜지자마자 현재 로그인한 유저의 프로필을 불러옵니다.
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const data = await getCurrentUserApi()
        if (data) {
          setUserProfile(data.profile)
        } else {
          // 로그인 세션이 없으면 첫 메인 화면으로 안전하게 튕겨내기
          alert('로그인이 필요한 페이지입니다.')
          navigate('/')
        }
      } catch (error) {
        console.error('유저 정보 로드 실패:', error)
        
        // 💡 [핵심 방어선 수정]: 로그아웃 직후 세션 만료 에러가 터지면 빨간 화면 안 띄우고 바로 첫 메인 화면('/')으로 탈출!!
        if (error.message?.includes('session missing') || error.message?.includes('AuthSessionMissingError')) {
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
    <div className="setting-container">
      <h2>마이페이지 👤</h2>

      {/* 📸 1. 프로필 사진 구역 */}
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

      {/* 🏷️ 2. 닉네임 표시 구역 */}
      <div className="profile-info-group">
        <label className="info-label">닉네임</label>
        <p className="info-value">{userProfile?.nickname || '닉네임 없음'}</p>
      </div>

      {/* 📧 3. 이메일 표시 구역 */}
      <div className="profile-info-group">
        <label className="info-label">이메일</label>
        <p className="info-value">{userProfile?.email || '이메일 정보 없음'}</p>
      </div>

      {/* 구글 캘린더 연동 */}
      <div className="profile-info-group">
        <label className="info-label">구글 캘린더 연동</label>
        {googleConnected ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{ fontSize: '14px', color: '#4CAF50' }}>✓ 연결됨</span>
              <button
                onClick={handleGoogleDisconnect}
                style={{ fontSize: '13px', color: '#f44', border: '1px solid #f44', background: 'none', borderRadius: '8px', padding: '4px 12px', cursor: 'pointer' }}
              >
                연결 해제
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '14px', color: '#333' }}>확정 일정 자동 추가</span>
              <div
                onClick={handleAutoSyncToggle}
                style={{
                  width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer',
                  backgroundColor: googleAutoSync ? '#4285F4' : '#ccc',
                  position: 'relative', transition: 'background-color 0.2s',
                }}
              >
                <div style={{
                  width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff',
                  position: 'absolute', top: '2px',
                  left: googleAutoSync ? '22px' : '2px',
                  transition: 'left 0.2s',
                }} />
              </div>
            </div>
            <p style={{ fontSize: '11px', color: '#aaa', margin: '4px 0 0' }}>
              켜면 투표로 확정된 일정이 구글 캘린더에 자동으로 추가됩니다
            </p>
          </div>
        ) : (
          <button
            onClick={() => googleLogin()}
            style={{ fontSize: '14px', color: '#fff', backgroundColor: '#4285F4', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer' }}
          >
            Google 캘린더 연결
          </button>
        )}
      </div>

      {/* 🚀 4. 수정하기 버튼 및 포탈 구역 (인라인 style 싹 다 박멸! 🧼) */}
      <div className="setting-actions">
        <button 
          onClick={() => navigate('/settings/edit')} 
          className="edit-navigation-button"
        >
          내 정보 수정하기 ⚙️
        </button>
        
        {/* 하단 홈 / 로그아웃 버튼 레이아웃 */}
        <div className="bottom-actions-wrapper">
          <button 
            onClick={() => navigate('/home')} 
            className="home-button" 
          >
            🏠 홈화면으로 이동
          </button>
          
          <button 
            onClick={handleLogout} 
            className="logout-btn"
          >
            🚪 로그아웃
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage