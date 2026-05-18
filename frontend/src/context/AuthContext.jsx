import { createContext, useEffect, useState } from 'react'
import { getCurrentUserApi, logoutApi } from '../api/authApi'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadUser = async () => {
      try {
        const result = await getCurrentUserApi()

        if (result) {
          setUser(result.user)
          setProfile(result.profile)
        }
      } catch (error) {
        console.error('현재 사용자 조회 실패:', error)
      } finally {
        setLoading(false)
      }
    }

    loadUser()
  }, [])

  const login = ({ user, profile }) => {
    setUser(user)
    setProfile(profile)
  }

  const logout = async () => {
    await logoutApi()
    setUser(null)
    setProfile(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
 