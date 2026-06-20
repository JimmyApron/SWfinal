import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'

function EmailConfirmPage() {
  const navigate = useNavigate()
  // 💡 유저의 진짜 닉네임을 담아둘 상태 (기본값은 '회원')
  const [userNickname, setUserNickname] = useState('회원')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkAuthAndFetchNickname = async () => {
      try {
        // 1. 인증 링크를 타고 들어오면서 Supabase가 자동으로 잡아준 세션 확인
        const { data: { session } } = await supabase.auth.getSession()

        if (session?.user) {
          const userId = session.user.id
          
          // 2. 💡 약속했던 대로 로컬스토리지에 user_id 마저 구워주기
          localStorage.setItem('user_id', userId)

          // 
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('nickname')
            .eq('id', userId)
            .maybeSingle()

          if (!profileError && profileData?.nickname) {
            setUserNickname(profileData.nickname) // 찾은 닉네임으로 교체!
          }

          setLoading(false)

          // 4. 2.5초 동안 환영 메시지를 따뜻하게 보여준 뒤 홈 화면으로 직행!
          setTimeout(() => {
            navigate('/home')
          }, 2500)
        } else {
          // 세션이 없으면 로그인 페이지로 튕겨내기
          navigate('/login')
        }
      } catch (error) {
        console.error('인증 세션 처리 중 오류:', error)
        navigate('/login')
      }
    }

    checkAuthAndFetchNickname()
  }, [navigate])

  if (loading) {
    return (
      <section style={{ textAlign: 'center', marginTop: '100px' }}>
        <h2>인증 세션 확인 중...</h2>
        <p>안전하게 로그인 처리를 진행하고 있습니다. 잠시만 기다려주세요.</p>
      </section>
    )
  }

  return (
    <section style={{ textAlign: 'center', marginTop: '100px' }}>
      <h2>인증 성공! 환영합니다, {userNickname}님!</h2>
      <p>이메일 인증이 완벽하게 완료되었습니다.</p>
      <p>잠시 후 서비스 화면으로 안전하게 이동합니다...</p>
    </section>
  )
}

export default EmailConfirmPage
