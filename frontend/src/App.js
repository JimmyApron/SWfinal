import './App.css'
import { useState } from 'react'
import { AuthProvider } from './context/AuthContext.jsx'
import InviteCodePage from './pages/InviteCodePage'
import SignupPage from './pages/SignupPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import GuestLoginPage from './pages/GuestLoginPage.jsx'
import RoomCreatePage from './pages/RoomCreatePage'

function App() {
  const [page, setPage] = useState('invite')
  const [currentRoomId, setCurrentRoomId] = useState('')

  const handleNavigateToAuth = (targetPage, roomId) => {
    setCurrentRoomId(roomId)
    setPage(targetPage)
  }

  return (
    <AuthProvider>
      <div className="App">
        <h1>SWfinal Auth Test</h1>

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
          <button type="button" onClick={() => setPage('roomCreate')}>
            방 만들기
          </button>
        </nav>

        <hr style={{ border: '0.5px solid #eee', marginBottom: '20px' }} />

        {page === 'invite' && (
          <InviteCodePage onNavigate={handleNavigateToAuth} />
        )}

        {page === 'signup' && (
          <SignupPage roomId={currentRoomId} setPage={setPage} />
        )}

        {page === 'login' && (
          <LoginPage roomId={currentRoomId} setPage={setPage} />
        )}

        {page === 'guest' && (
          <GuestLoginPage roomId={currentRoomId} setPage={setPage} />
        )}

        {page === 'roomCreate' && (
          <RoomCreatePage />
        )}
      </div>
    </AuthProvider>
  )
}

export default App