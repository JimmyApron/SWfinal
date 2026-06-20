import { useNavigate } from 'react-router-dom'
import { FaEnvelope, FaUserPlus, FaTicketAlt, FaChevronRight } from 'react-icons/fa'
import { supabase } from '../../lib/supabaseClient'

function InviteCodePage() {
  const navigate = useNavigate()

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/home` },
    })
  }

  const handleKakaoLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: { redirectTo: `${window.location.origin}/home` },
    })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#ffffff',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width: '90px',
            height: '90px',
            borderRadius: '20px 20px 20px 4px',
            backgroundColor: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '7px',
            overflow: 'hidden',
          }}
        >
          <img src="/logo.png" alt="MeetUp" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>

        <h1 style={{ margin: 0, fontSize: '45px', fontWeight: 800, color: '#16142B' }}>MeetUp</h1>

        <p
          style={{
            margin: '8px 0 14px',
            fontSize: '12px',
            color: '#6B687A',
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          친구들과 시간과 장소를 함께 정해요.
          <br />
          더 쉽고 즐거운 모임을 만들어보세요!
        </p>

        <button
          onClick={() => navigate('/login')}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '11px',
            backgroundColor: '#EFEAFB',
            border: 'none',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: 600,
            color: '#16142B',
            cursor: 'pointer',
            marginBottom: '8px',
          }}
        >
          <FaEnvelope size={14} color="#6C5CE7" />
          이메일로 로그인
        </button>

        <button
          onClick={handleKakaoLogin}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '11px',
            backgroundColor: '#FEE500',
            border: 'none',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: 700,
            color: '#191919',
            cursor: 'pointer',
            marginBottom: '8px',
          }}
        >
          <img
            src="https://developers.kakao.com/assets/img/about/logos/kakaolink/kakaolink_btn_small.png"
            alt="Kakao"
            width="18"
          />
          카카오 간편로그인
        </button>

        <button
          onClick={handleGoogleLogin}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '11px',
            backgroundColor: '#ffffff',
            border: '1px solid #ddd9e8',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: 600,
            color: '#16142B',
            cursor: 'pointer',
            marginBottom: '14px',
          }}
        >
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google"
            width="18"
          />
          구글 간편로그인
        </button>

        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#ddd9e8' }} />
          <span style={{ fontSize: '13px', color: '#B3B0C2' }}>또는</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#ddd9e8' }} />
        </div>

        <div
          style={{
            width: '100%',
            backgroundColor: '#F7F5FC',
            borderRadius: '12px',
            padding: '10px',
            textAlign: 'center',
            marginBottom: '16px',
          }}
        >
          <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#7A7787' }}>처음이신가요?</p>

          <button
            onClick={() => navigate('/signup')}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: '13px',
              fontWeight: 700,
              color: '#6C5CE7',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            회원가입하기 <FaChevronRight size={11} />
          </button>
        </div>

        <div
          style={{
            width: '100%',
            borderTop: '1px dashed #bdbac4ef',
            paddingTop: '14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: '#F0EDF9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '8px',
            }}
          >
            <FaUserPlus size={18} color="#6C5CE7" />
          </div>

          <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700, color: '#16142B' }}>
            초대받으셨나요?
          </h3>

          <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#9491A4', textAlign: 'center' }}>
            회원가입 없이 초대 코드로 참여할 수 있어요.
          </p>

          <button
            onClick={() => navigate('/guest')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '11px',
              backgroundColor: '#ffffff',
              border: '1.5px solid #6C5CE7',
              borderRadius: '12px',
              fontSize: '14px',
              fontWeight: 700,
              color: '#6C5CE7',
              cursor: 'pointer',
            }}
          >
            <FaTicketAlt size={14} />
            초대 코드로 참여하기
          </button>
        </div>
      </div>
    </div>
  )
}

export default InviteCodePage
