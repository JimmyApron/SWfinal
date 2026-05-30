import { useNavigate } from 'react-router-dom'
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
    <section>
      <div>
        <h2>👋 프로젝트 메인 대문</h2>
        <p>원하시는 서비스 입장 방식을 선택해 주세요.</p>
      </div>

      <hr />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3>입장 방식을 선택해 주세요</h3>

        <button onClick={() => navigate('/login')}>
          기존 계정으로 로그인해서 입장
        </button>

        <button onClick={() => navigate('/signup')}>
          새로 가입하고 입장 (추천)
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
          <hr style={{ flex: 1 }} />
          <span style={{ color: '#aaa', fontSize: '13px' }}>간편 로그인</span>
          <hr style={{ flex: 1 }} />
        </div>

        <button
          onClick={handleGoogleLogin}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#fff', cursor: 'pointer', fontSize: '14px' }}
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="18" />
          Google로 시작하기
        </button>

        <button
          onClick={handleKakaoLogin}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', border: 'none', borderRadius: '8px', backgroundColor: '#FEE500', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', color: '#000' }}
        >
          <img src="https://developers.kakao.com/assets/img/about/logos/kakaolink/kakaolink_btn_small.png" alt="Kakao" width="18" />
          카카오로 시작하기
        </button>

        <button onClick={() => navigate('/guest')} style={{ color: '#888', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', marginTop: '4px' }}>
          로그인 없이 비회원으로 입장
        </button>
      </div>
    </section>
  )
}

export default InviteCodePage