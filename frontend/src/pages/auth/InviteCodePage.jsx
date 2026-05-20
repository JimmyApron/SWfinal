import { useNavigate } from 'react-router-dom' // 👈 리액트 라우터 이동 훅 임포트

function InviteCodePage() {
  const navigate = useNavigate() // 👈 페이지 이동 기기 장착!

  return (
    <section>
      
      <div>
        <h2>👋 프로젝트 메인 대문</h2>
        <p>
          원하시는 서비스 입장 방식을 선택해 주세요.
        </p>
      </div>

      <hr />

      <div>
        <h3>입장 방식을 선택해 주세요</h3>
        
        {/* 1. 로그인 선택 ➡️ /login 주소로 이동 */}
        <button onClick={() => navigate('/login')}>
          기존 계정으로 로그인해서 입장
        </button>

        {/* 2. 회원가입 선택 ➡️ /signup 주소로 이동 */}
        <button onClick={() => navigate('/signup')}>
          새로 가입하고 입장 (추천)
        </button>

        {/* 3. 비회원 선택 ➡️ /guest 주소로 이동 (여기서 초대코드와 닉네임을 받게 설계) */}
        <button onClick={() => navigate('/guest')}>
          로그인 없이 비회원으로 입장
        </button>
      </div>

    </section>
  )
}

export default InviteCodePage