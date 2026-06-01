import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { logoutApi, getCurrentUserApi } from '../../api/authApi'
import { supabase } from '../../lib/supabaseClient'
import { useTheme } from '../../context/ThemeContext'

function SettingsPage() {
  const navigate = useNavigate()
  const { isDarkMode, toggleTheme } = useTheme()

  const [userProfile, setUserProfile] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loginProvider, setLoginProvider] = useState(null)

  // 알림 팝업 전역 설정 (Local Storage 사용)
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
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser()

        if (!user || authError) {
          navigate('/')
          setIsLoading(false)
          return
        }

        const provider = user.app_metadata?.provider

        const lastSignedInIdentity = user.identities?.reduce(
          (latest, identity) => {
            if (!latest) return identity

            return new Date(identity.last_sign_in_at) >
              new Date(latest.last_sign_in_at)
              ? identity
              : latest
          },
          null
        )

        const actualProvider = lastSignedInIdentity?.provider || provider
        setLoginProvider(actualProvider)

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
          nickname:
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email?.split('@')[0] ||
            '소셜유저',
          profileimageurl:
            user.user_metadata?.avatar_url ||
            user.user_metadata?.picture ||
            null,
        })

        setIsLoading(false)
      } catch (error) {
        console.error('유저 정보 로드 실패:', error)

        if (
          error.message?.includes('session missing') ||
          error.message?.includes('AuthSessionMissingError')
        ) {
          navigate('/')
          return
        }

        setIsLoading(false)
      }
    }

    fetchUserData()
  }, [navigate])

  const renderProviderBadge = () => {
    if (loginProvider === 'google') {
      return (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: '#fff',
            border: '1px solid #e0e0e0',
            borderRadius: '20px',
            padding: '4px 12px',
            fontSize: '13px',
            color: '#444',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            marginTop: '6px',
          }}
        >
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google"
            width="16"
          />
          Google로 로그인 중
        </div>
      )
    }

    if (loginProvider === 'kakao') {
      return (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: '#FEE500',
            borderRadius: '20px',
            padding: '4px 12px',
            fontSize: '13px',
            color: '#000',
            fontWeight: 'bold',
            marginTop: '6px',
          }}
        >
          <img
            src="https://developers.kakao.com/assets/img/about/logos/kakaolink/kakaolink_btn_small.png"
            alt="Kakao"
            width="16"
          />
          카카오톡으로 로그인 중
        </div>
      )
    }

    return null
  }

  if (isLoading) {
    return <div className="loading-container">로딩 중...</div>
  }

  return (
    <div className="setting-container" style={{ paddingBottom: '90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          style={{
            border: 'none',
            background: 'none',
            padding: 0,
            fontSize: '24px',
            cursor: 'pointer',
            color: '#555',
          }}
        >
          &larr;
        </button>
        <h2>마이페이지 👤</h2>
      </div>

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

        {renderProviderBadge()}
      </div>

      {/* 다크 모드 토글 */}
      <div className="profile-info-group" style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        padding: '16px 0',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <label className="info-label" style={{ marginBottom: 0 }}>다크 모드 🌙</label>
        <div 
          onClick={toggleTheme}
          style={{
            width: '50px',
            height: '26px',
            backgroundColor: isDarkMode ? '#4caf50' : '#ccc',
            borderRadius: '13px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'background-color 0.3s'
          }}
        >
          <div style={{
            width: '20px',
            height: '20px',
            backgroundColor: 'white',
            borderRadius: '50%',
            position: 'absolute',
            top: '3px',
            left: isDarkMode ? '27px' : '3px',
            transition: 'left 0.3s',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
          }} />
        </div>
      </div>

      {/* 알림 팝업 토글 */}
      <div className="profile-info-group" style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        padding: '16px 0',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <label className="info-label" style={{ marginBottom: 0 }}>알림 팝업 🔔</label>
        <div 
          onClick={toggleNotif}
          style={{
            width: '50px',
            height: '26px',
            backgroundColor: isNotifEnabled ? '#7c79ff' : '#ccc',
            borderRadius: '13px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'background-color 0.3s'
          }}
        >
          <div style={{
            width: '20px',
            height: '20px',
            backgroundColor: 'white',
            borderRadius: '50%',
            position: 'absolute',
            top: '3px',
            left: isNotifEnabled ? '27px' : '3px',
            transition: 'left 0.3s',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
          }} />
        </div>
      </div>

      <div className="setting-actions">
        <button
          onClick={() => navigate('/settings/edit')}
          className="edit-navigation-button"
        >
          내 정보 수정하기 ⚙️
        </button>

        <div className="bottom-actions-wrapper">
          <button onClick={handleLogout} className="logout-btn">
            🚪 로그아웃
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage