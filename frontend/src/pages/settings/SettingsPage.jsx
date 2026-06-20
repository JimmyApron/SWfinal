import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { logoutApi, getCurrentUserApi } from '../../api/authApi'
import { supabase } from '../../lib/supabaseClient'
import { useTheme } from '../../context/ThemeContext'
import { FaChevronLeft, FaMoon, FaBell, FaUser, FaSignOutAlt, FaChevronRight, FaPen } from 'react-icons/fa'
import './SettingsPage.css'

function SettingsPage() {
  const navigate = useNavigate()
  const { isDarkMode, toggleTheme } = useTheme()

  const [userProfile, setUserProfile] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loginProvider, setLoginProvider] = useState(null)

  const [isNotifEnabled, setIsNotifEnabled] = useState(() => {
    return localStorage.getItem("global_popup_enabled") !== "false";
  });

  const toggleNotif = () => {
    const nextValue = !isNotifEnabled;
    setIsNotifEnabled(nextValue);
    localStorage.setItem("global_popup_enabled", String(nextValue));
  };

  const handleLogout = async () => {
    if (!window.confirm('정말 로그아웃 하시겠습니까? 🥺')) return
    try {
      await logoutApi()
      window.location.href = '/'
    } catch (error) {
      window.location.href = '/'
    }
  }

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (!user || authError) {
          navigate('/')
          setIsLoading(false)
          return
        }

        const provider = user.app_metadata?.provider
        const lastSignedInIdentity = user.identities?.reduce((latest, identity) => {
          if (!latest) return identity
          return new Date(identity.last_sign_in_at) > new Date(latest.last_sign_in_at) ? identity : latest
        }, null)

        setLoginProvider(lastSignedInIdentity?.provider || provider)

        try {
          const data = await getCurrentUserApi()
          if (data?.profile) {
            setUserProfile(data.profile)
            setIsLoading(false)
            return
          }
        } catch (profileError) {
          console.error('프로필 조회 실패:', profileError)
        }

        setUserProfile({
          id: user.id,
          email: user.email,
          nickname: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || '소셜유저',
          profileimageurl: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
        })
        setIsLoading(false)
      } catch (error) {
        if (error.message?.includes('session missing')) {
          navigate('/')
          return
        }
        setIsLoading(false)
      }
    }
    fetchUserData()
  }, [navigate])

  if (isLoading) return <div className="loading-container">프로필을 불러오는 중입니다...</div>

  return (
    <div className="settings-page">
      <div className="settings-content">
        <header className="settings-header">
          <button type="button" className="back-button" onClick={() => navigate(-1)} aria-label="이전 화면으로 돌아가기">
            <FaChevronLeft />
          </button>
          <h2 className="settings-title">마이페이지</h2>
        </header>

        <section className="profile-hero">
          <div className="profile-image-wrapper">
            {userProfile?.profileimageurl ? (
              <img src={userProfile.profileimageurl} alt="프로필" className="profile-avatar" />
            ) : (
              <div className="profile-avatar-default"><FaUser /></div>
            )}
          </div>
          <h1 className="nickname">{userProfile?.nickname || '닉네임 없음'}</h1>
          <p className="email">{userProfile?.email || '이메일 정보 없음'}</p>
          
          {loginProvider === 'google' && <div className="provider-badge provider-google"><img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="16" /> Google</div>}
          {loginProvider === 'kakao' && <div className="provider-badge provider-kakao">카카오</div>}
          
          <button type="button" className="profile-edit-button" onClick={() => navigate('/settings/edit')}>
            <FaPen size={12} /> 프로필 편집
          </button>
        </section>

        <h3 className="settings-section-title">앱 설정</h3>
        <div className="settings-card">
          <div className="settings-row">
            <div className="row-info">
              <div className="settings-icon-circle"><FaMoon /></div>
              <span className="row-label">다크 모드</span>
            </div>
            <button type="button" className="settings-toggle" role="switch" aria-checked={isDarkMode} onClick={toggleTheme}>
              <div className="settings-toggle-thumb" />
            </button>
          </div>
          <div className="settings-row">
            <div className="row-info">
              <div className="settings-icon-circle"><FaBell /></div>
              <span className="row-label">알림 팝업</span>
            </div>
            <button type="button" className="settings-toggle" role="switch" aria-checked={isNotifEnabled} onClick={toggleNotif}>
              <div className="settings-toggle-thumb" />
            </button>
          </div>
        </div>

        <h3 className="settings-section-title">계정</h3>
        <div className="account-menu-list">
          <button type="button" className="account-menu-card" onClick={() => navigate('/settings/edit')}>
            <div className="row-info">
              <div className="account-menu-icon"><FaUser /></div>
              <span className="row-label">내 정보 수정</span>
            </div>
            <FaChevronRight color="#9ca3af" />
          </button>

          <button type="button" className="account-menu-card logout-card" onClick={handleLogout}>
            <div className="row-info">
              <div className="account-menu-icon"><FaSignOutAlt /></div>
              <span className="row-label">로그아웃</span>
            </div>
            <FaChevronRight color="#9ca3af" />
          </button>
        </div>

        <p className="settings-version">버전 1.0.0</p>
      </div>
    </div>
  )
}

export default SettingsPage