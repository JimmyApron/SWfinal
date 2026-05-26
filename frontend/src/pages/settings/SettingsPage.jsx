import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { logoutApi } from '../../api/authApi' 
import { getCurrentUserApi } from '../../api/authApi' 

function SettingsPage() { 
  const navigate = useNavigate()
  const [userProfile, setUserProfile] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

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
    <div className="setting-container" style={{ paddingBottom: "90px" }}>
      <h2>마이페이지 👤</h2>

      {/* 📸 1. 프로필 사진 구역 */}
      <div className="profile-image-section">
        {userProfile?.profileimageurl ? (
  <img src={userProfile.profileimageurl} alt="프로필 사진" className="profile-avatar" />
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