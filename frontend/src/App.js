import './App.css'
import { useState } from 'react'
import { AuthProvider } from './context/AuthContext.jsx'
import SignupPage from './pages/SignupPage.jsx'
import LoginPage from './pages/LoginPage.jsx'

function App() {
  const [page, setPage] = useState('signup')

  return (
    <AuthProvider>
      <div className="App">
        <h1>SWfinal Auth Test</h1>

        <nav>
          <button type="button" onClick={() => setPage('signup')}>
            회원가입
          </button>

          <button type="button" onClick={() => setPage('login')}>
            로그인
          </button>
        </nav>

        {page === 'signup' && <SignupPage />}
        {page === 'login' && <LoginPage />}
      </div>
    </AuthProvider>
  )
}

export default App