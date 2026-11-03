import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const PUBLIC_PATHS = ['/', '/login', '/signup', '/guest', '/reset-password']

export default function AuthGate({ children }) {
  const location = useLocation()
  const [session, setSession] = useState(undefined)
  const [guest, setGuest] = useState(() => Boolean(localStorage.getItem('guest_id')))
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    let authChanged = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authChanged = true
      if (!active) return
      setSession(nextSession)
      setError(false)
    })
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || authChanged) return
      if (sessionError) setError(true)
      else setSession(data.session)
    }).catch(() => { if (active && !authChanged) setError(true) })
    const updateGuest = () => setGuest(Boolean(localStorage.getItem('guest_id')))
    window.addEventListener('guest-session-changed', updateGuest)
    window.addEventListener('storage', updateGuest)
    return () => {
      active = false
      subscription.unsubscribe()
      window.removeEventListener('guest-session-changed', updateGuest)
      window.removeEventListener('storage', updateGuest)
    }
  }, [])

  if (PUBLIC_PATHS.includes(location.pathname)) return children
  if (error) return <p role="alert">로그인 정보를 확인하지 못했습니다. <button onClick={() => window.location.reload()}>다시 불러오기</button></p>
  if (session === undefined) return <p role="status">로그인 확인 중…</p>
  if (!session && !guest) return <Navigate to="/" replace />
  return children
}
