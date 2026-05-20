import { useState, useEffect } from 'react'
import { checkRoomNicknameDuplicateApi, insertRoomGuestApi, getRoomMembersByInviteCodeApi } from '../../api/authApi' 
import { supabase } from '../../lib/supabaseClient' // 👈 방 존재 여부 체크를 위해 직접 수혈
import { useNavigate } from 'react-router-dom' // 👈 라우터 이동용 장착

function GuestLoginPage() {
  const navigate = useNavigate()
  
  // 💡 [핵심 개편] 이제 부모 프롭스 대신, 컴포넌트 내부에서 초대코드를 직접 관리합니다!
  const [inviteCode, setInviteCode] = useState('') 
  const [isRoomVerified, setIsRoomVerified] = useState(false) // 방 검증 통과 여부
  
  const [nickname, setNickname] = useState('')
  const [message, setMessage] = useState('')
  const [isAvailable, setIsAvailable] = useState(false) // 닉네임 중복체크 완료 여부
  
  const [existingMembers, setExistingMembers] = useState([])

// 1. 초대코드 방 존재 여부 체크 및 [회원 + 비회원] 명단 전체 불러오기
  const handleVerifyRoom = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    
    if (!inviteCode.trim()) {
      setMessage('⚠️ 초대코드를 입력해 주세요.')
      return
    }

    try {
      setMessage('방 유효성 검사 중...');
      
      // [1] 먼저 rooms 테이블에서 진짜 방 정보와 고유 숫자 고유번호(id)를 낚아챕니다.
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('id, invitecode')
        .eq('invitecode', inviteCode.trim())
        .maybeSingle()

      if (roomError) throw roomError

      if (!roomData) {
        setIsRoomVerified(false)
        setExistingMembers([])
        setMessage('❌ 존재하지 않는 초대코드입니다. 다시 확인해 주세요.')
        return
      }

      // [2] 방이 존재한다면, 기존 가입 회원 목록(room_members)을 가져옵니다.
      const memberList = await getRoomMembersByInviteCodeApi(inviteCode.trim())
      const formattedMembers = Array.isArray(memberList) 
        ? memberList.map(m => ({ nickname: m.nickname, type: '회원' })) 
        : []

      // [3] 💡 [추가] 이제 개편된 int8 타입의 room_guests 테이블에서 현재 방 고유번호(room_id)를 가진 비회원 목록도 긁어옵니다!
      const { data: guestList, error: guestError } = await supabase
        .from('room_guests')
        .select('nickname')
        .eq('room_id', roomData.id) // ⬅️ 외래키로 물리적 연결된 진짜 숫자 id로 조회!

      const formattedGuests = Array.isArray(guestList)
        ? guestList.map(g => ({ nickname: g.nickname, type: '비회원' }))
        : []

      // [4] 💡 회원 배열과 비회원 배열을 하나로 깔끔하게 묶어줍니다 (Concat)
      const allParticipants = [...formattedMembers, ...formattedGuests]
      setExistingMembers(allParticipants)
      
      setIsRoomVerified(true)
      setMessage('✅ 유효한 방 확인 완료! 전체 참여자 명단을 대조하여 닉네임을 검증합니다.')

    } catch (error) {
      console.error('방 검증 또는 통합 명단 로드 실패:', error)
      setMessage('서버 통신 중 오류가 발생했습니다.')
      setIsRoomVerified(false)
    }
  }

  // 2. 닉네임 중복 체크 (기존 회원 목록 대조 포함)
  const handleCheckDuplicate = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    
    if (!nickname.trim()) {
      setMessage('⚠️ 사용할 닉네임을 입력해 주세요.')
      return
    }

    try {
      setMessage('방 안의 다른 닉네임들과 대조 중...')
      // API 내부적으로 room_guests와 room_members 양방향 철벽 수색 수행
      const isDuplicate = await checkRoomNicknameDuplicateApi(nickname.trim(), inviteCode.trim())

      if (isDuplicate) {
        setIsAvailable(false)
        setMessage('❌ 이 방에 이미 존재하는 닉네임입니다.')
      } else {
        setIsAvailable(true)
        setMessage('✅ 사용 가능한 닉네임입니다!')
      }
    } catch (error) {
      console.error(error)
      setMessage('닉네임 체크 중 오류가 발생했습니다.')
    }
  }

  // 3. 최종 방 입장 제출 및 대시보드 리다이렉트
  const handleEnterRoom = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    if (!isAvailable || !isRoomVerified) return

    try {
      setMessage('비회원으로 방에 입장하는 중...')
      const guestData = await insertRoomGuestApi(nickname.trim(), inviteCode.trim())
      
      setMessage(`🎉 [게스트] ${guestData.nickname}님 환영합니다! 방 내부로 진입합니다.`)
      
      // 가이드라인 2번 미션 반영: 세션/로컬스토리지에 식별자 저장
      localStorage.setItem('guest_nickname', guestData.nickname)
      localStorage.setItem('current_room_code', inviteCode.trim())

      // 💡 진짜 방 내부 대시보드 또는 상세페이지 경로로 리다이렉트 연동!
      setTimeout(() => {
        navigate(`/rooms/${inviteCode.trim()}`) 
      }, 1200)

    } catch (error) {
      console.error(error)
      setMessage('방 입장에 실패했습니다. 관리자에게 문의하세요.')
    }
  }

  return (
    <section>
      
      <h2>👥 비회원(게스트) 입장 창</h2>
      <p>로그인 없이 초대코드를 이용해 방에 임시로 진입합니다.</p>
      
      <hr />

      {/* ─── 1구역: 초대코드 선입력 및 방 검증 구역 ─── */}
      <div>
        <h3>1단계: 초대코드 입력</h3>
        <form onSubmit={handleVerifyRoom}>
          <input
            type="text"
            placeholder="초대코드를 입력하세요 (예: ROOM123)"
            value={inviteCode}
            disabled={isRoomVerified} // 검증 성공 시 입력창 잠금
            onChange={(e) => setInviteCode(e.target.value)}
          />
          {!isRoomVerified && (
            <button type="submit">
              방 확인하기
            </button>
          )}
        </form>
      </div>

      {/* ─── 2구역: 닉네임 작성 및 중복 체크 (방 검증이 끝나야만 활성화) ─── */}
      {isRoomVerified && (
        <div style={{ marginTop: '20px' }}>
          <h3>2단계: 닉네임 설정</h3>
          <form onSubmit={handleCheckDuplicate}>
            <input
              type="text"
              placeholder="사용할 임시 닉네임"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value)
                setIsAvailable(false) // 타이핑을 다시 하면 중복체크 풀림
              }}
            />
            <button type="submit">
              중복 확인
            </button>
          </form>
        </div>
      )}

      {/* 알림 안내 메시지 통합 출력 */}
      {message && <p style={{ fontWeight: 'bold', margin: '15px 0' }}>{message}</p>}

      {/* ─── 3구역: 최종 입장 버튼 구역 ─── */}
      {isRoomVerified && (
        <div>
          <button
            type="button"
            disabled={!isAvailable}
            onClick={handleEnterRoom}
          >
            이 방으로 최종 들어가기
          </button>
        </div>
      )}

      <hr />

     {/* ─── 4구역: 실시간 기존 회원 리스트 시각화 구역 (방 확인 완료 시 노출) ─── */}
      {isRoomVerified && (
        <div>
          <h4>📊 현재 이 방에 참여 중인 명단 (전체 대조군):</h4>
          {existingMembers.length === 0 ? (
            <p>현재 방에 참여 중인 유저가 없습니다.</p>
          ) : (
            <ul>
              {existingMembers.map((member, index) => (
                <li key={index}>
                  {member.type === '회원' ? '👤 [회원] ' : '👥 [게스트] '} 
                  {member?.nickname || '이름 없는 참가자'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      
      {/* 처음으로 돌아가기 */}
      <div style={{ marginTop: '30px' }}>
        <button type="button" onClick={() => navigate('/')}>
          처음 화면으로 돌아가기
        </button>
      </div>

    </section>
  )
}

export default GuestLoginPage