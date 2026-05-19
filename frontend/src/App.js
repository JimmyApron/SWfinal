import './App.css'
import { useState } from 'react'
import { AuthProvider } from './context/AuthContext.jsx'
import InviteCodePage from './pages/InviteCodePage'
import SignupPage from './pages/SignupPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import GuestLoginPage from './pages/GuestLoginPage.jsx'

function App() {
  // 첫 화면에 초대코드 페이지가 뜨도록 기본값을 'invite'로 설정합니다.
  const [page, setPage] = useState('invite')
  
  // 하위 컴포넌트(InviteCodePage)에서 검증한 초대코드를 보관할 부모 상태값입니다.
  const [currentRoomId, setCurrentRoomId] = useState('')

  // 💡 [핵심 안전장치] 방ID 세팅과 화면 전환을 한 치의 오차도 없이 일치시키는 함수
  const handleNavigateToAuth = (targetPage, roomId) => {
    setCurrentRoomId(roomId) // 부모 창고에 저장하고
    setPage(targetPage)      // 화면도 동시에 변경!
  }

  return (
    <AuthProvider>
      <div className="App">
        <h1>SWfinal Auth Test</h1>

        {/* 상단 네비게이션 바 (테스트 편의용) */}
        <nav style={{ marginBottom: '20px' }}>
          <button type="button" onClick={() => { setPage('invite'); setCurrentRoomId(''); }}>
            초대코드 입력
          </button>
          <button type="button" onClick={() => setPage('signup')}>
            회원가입
          </button>
          <button type="button" onClick={() => setPage('login')}>
            로그인
          </button>
          <button type="button" onClick={() => setPage('guest')}>
            비회원(게스트)
          </button>
        </nav>

        <hr style={{ border: '0.5px solid #eee', marginBottom: '20px' }} />

        {/* ─── page 상태에 따른 조건부 렌더링 매핑 ─── */}
        
        {/* 1. 첫 화면: 초대코드 입력창 */}
        {page === 'invite' && (
          // 💡 [수정 완료] 자식이 애타게 기다리던 onNavigate 이름표에 안전 함수를 바인딩해 줍니다.
          <InviteCodePage onNavigate={handleNavigateToAuth} />
        )}

        {/* 2. 회원가입 창 */}
        {page === 'signup' && (
          <SignupPage roomId={currentRoomId} setPage={setPage} />
        )}

        {/* 3. 로그인 창 */}
        {page === 'login' && (
          <LoginPage roomId={currentRoomId} setPage={setPage} />
        )}

        {/* 4. 비회원 입장 창 */}
        {page === 'guest' && (
          <GuestLoginPage roomId={currentRoomId} setPage={setPage} />
        )}
      </div>
    </AuthProvider>
  )
}

export default App