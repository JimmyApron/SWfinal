import { useState } from 'react'
import { supabase } from '../api/supabaseClient'

// 💡 [수정] 부모로부터 따로따로 받던 상태 함수 대신, 안전하게 묶어둔 onNavigate 함수 하나만 받습니다.
function InviteCodePage({ onNavigate }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [step, setStep] = useState(1)

  // 1단계: 초대코드 검증 핸들러
  const handleVerifyCode = async (event) => {
    event.preventDefault()
    if (!code) {
      setMessage('⚠️ 초대코드를 입력해 주세요.')
      return
    }

    try {
      setMessage('초대코드 확인 중...')
      
      // rooms 테이블의 invitecode 컬럼 조회
      const { data, error } = await supabase
        .from('rooms')
        .select('invitecode')
        .eq('invitecode', code)
        .maybeSingle()

      if (error) throw error

      if (!data) {
        setMessage('❌ 존재하지 않는 초대코드입니다. 다시 확인해 주세요.')
        return
      }

      // 💡 [수정] 1단계를 통과했을 때는 일단 step만 2로 바꿔서 입장 방식 선택창을 띄웁니다.
      // 부모 상태는 최종 버튼을 누르는 순간 실어서 보낼 거라 여기서는 건드리지 않고 대기합니다!
      setMessage('✅ 유효한 초대코드입니다. 입장 방식을 선택해 주세요.')
      setStep(2)

    } catch (err) {
      console.error(err)
      setMessage('서버 통신 중 오류가 발생했습니다.')
    }
  }

  return (
    <section style={{ maxWidth: '400px', margin: '40px auto', padding: '20px', textAlign: 'center' }}>
      
      {/* ─── 1구역: 초대코드 입력 영역 (2단계가 되면 클릭 잠금) ─── */}
      <div 
        style={{ 
          opacity: step === 2 ? 0.5 : 1, 
          pointerEvents: step === 2 ? 'none' : 'auto',
          marginBottom: '30px'
        }}
      >
        <h2>초대코드 입력</h2>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
          공유받으신 방의 초대코드를 입력하시면 입장 단계를 진행합니다.
        </p>
        
        <form onSubmit={handleVerifyCode}>
          <input
            type="text"
            placeholder="초대코드를 입력하세요 (예: ROOM123)"
            value={code}
            disabled={step === 2}
            onChange={(event) => setCode(event.target.value)}
            style={{ width: '100%', padding: '10px', fontSize: '16px', marginBottom: '10px', boxSizing: 'border-box' }}
          />
          {step === 1 && (
            <button type="submit" style={{ width: '100%', padding: '10px', fontSize: '16px', cursor: 'pointer' }}>
              방 확인하기
            </button>
          )}
        </form>
      </div>

      {/* 안내 메시지 출력 구역 */}
      {message && <p style={{ fontSize: '14px', marginBottom: '20px', fontWeight: 'bold' }}>{message}</p>}

      {/* ─── 2구역: 선택 버튼 영역 (step이 2일 때만 활성화) ─── */}
      {step === 2 && (
        <div style={{ borderTop: '1px dashed #ccc', paddingTop: '20px' }}>
          <h3 style={{ marginBottom: '20px' }}>입장 방식을 선택해 주세요</h3>
          
          {/* 1. 로그인 선택 ➡️ 페이지 이름과 내가 입력했던 code를 동시에 부모에게 쏴버림 */}
          <button 
            onClick={() => onNavigate('login', code)}
            style={{ width: '100%', padding: '12px', marginBottom: '10px', cursor: 'pointer' }}
          >
            기존 계정으로 로그인해서 입장
          </button>

          {/* 2. 회원가입 선택 ➡️ 페이지 이름과 내가 입력했던 code를 동시에 부모에게 쏴버림 */}
          <button 
            onClick={() => onNavigate('signup', code)}
            style={{ width: '100%', padding: '12px', marginBottom: '10px', cursor: 'pointer' }}
          >
            새로 가입하고 입장 (추천)
          </button>

          {/* 3. 비회원 선택 ➡️ 페이지 이름과 내가 입력했던 code를 동시에 부모에게 쏴버림 */}
          <button 
            onClick={() => onNavigate('guest', code)} 
            style={{ width: '100%', padding: '12px', marginBottom: '15px', cursor: 'pointer' }}
          >
            로그인 없이 비회원으로 입장
          </button>

          {/* 다시 코드를 치고 싶을 때를 위한 되돌리기 버튼 */}
          <button
            type="button"
            onClick={() => {
              setStep(1)
              setMessage('')
              onNavigate('invite', '') // 부모 상태도 깔끔하게 비워줌
            }}
            style={{ background: 'none', border: 'none', color: '#999', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }}
          >
            초대코드 다시 입력하기
          </button>
        </div>
      )}

    </section>
  )
}

export default InviteCodePage