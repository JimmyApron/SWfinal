import { useState, useEffect } from 'react'
import { checkRoomNicknameDuplicateApi, insertRoomGuestApi, getRoomMembersByInviteCodeApi } from '../api/authApi' // 💡 임포트 함수 변경!

function GuestLoginPage({ roomId, setPage }) {
  // 초기값들을 명확하고 안전하게 바인딩
  const [nickname, setNickname] = useState('')
  const [message, setMessage] = useState('')
  const [isAvailable, setIsAvailable] = useState(false)
  
  // 💡 [개념 전환] 이제 비회원 찌꺼기가 아니라 진짜 회원(room_members) 리스트를 담습니다.
  const [existingMembers, setExistingMembers] = useState([])

  // 💡 [진짜 DB 구조 연동] 현재 방에 있는 기존 진짜 회원(room_members) 리스트 가져오기
  const fetchExistingMembers = async () => {
    if (!roomId) return
    try {
      // 부모가 넘겨준 문자열 roomId(초대코드)를 들고 가서 room_members 테이블을 긁어옵니다.
      const data = await getRoomMembersByInviteCodeApi(roomId)
      // data가 정상적인 배열일 때만 넣고, 아니면 무조건 빈 배열 처리
      setExistingMembers(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('회원 목록 로드 실패:', error)
      setExistingMembers([])
    }
  }

  useEffect(() => {
    fetchExistingMembers()
  }, [roomId])

  // 1. 닉네임 중복 체크
  const handleCheckDuplicate = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    
    if (!nickname.trim()) {
      setMessage('⚠️ 사용할 닉네임을 입력해 주세요.')
      return
    }

    try {
      setMessage('방 안의 다른 닉네임들과 대조 중...')
      const isDuplicate = await checkRoomNicknameDuplicateApi(nickname, roomId)

      if (isDuplicate) {
        setIsAvailable(false)
        setMessage('❌ 이 방에 이미 존재하는 닉네임입니다.')
      } else {
        setIsAvailable(true)
        setMessage('✅ 사용 가능한 닉네임입니다!')
      }
    } catch (error) {
      console.error(error)
      setMessage('오류가 발생했습니다.')
    }
  }

  // 2. 최종 방 입장 제출
  const handleEnterRoom = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    if (!isAvailable) return

    try {
      setMessage('비회원으로 방에 입장하는 중...')
      const guestData = await insertRoomGuestApi(nickname, roomId)
      
      setMessage(`🎉 [게스트] ${guestData.nickname}님 환영합니다!`)
      setNickname('')
      setIsAvailable(false)
      
      // 💡 입장 성공 후 목록을 리프레시해 줍니다. 
      // (만약 비회원도 room_members에 넣는 구조라면 명단에 바로 반영될 것이고, room_guests 분리 구조라면 방 내부 대시보드로 이동시키면 됩니다!)
      fetchExistingMembers() 
    } catch (error) {
      console.error(error)
      setMessage('입장에 실패했습니다.')
    }
  }

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', margin: '20px auto', maxWidth: '400px', textAlign: 'center' }}>
      
      {/* 1. 상단 타이틀 구역 */}
      <h2>👥 비회원(게스트) 입장 창</h2>
      <p>진입 대기 중인 방 코드: <b style={{ color: 'blue' }}>{roomId || '선택된 방 없음'}</b></p>
      
      <hr />

      {/* 2. 닉네임 텍스트 박스 & 중복확인 버튼 구역 */}
      <div style={{ marginTop: '20px', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="사용할 임시 닉네임"
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value)
            setIsAvailable(false)
          }}
          style={{ padding: '8px', width: '60%', marginRight: '10px' }}
        />
        
        <button type="button" onClick={(e) => handleCheckDuplicate(e)}>
          중복 확인
        </button>
      </div>

      {/* 안내 메시지 출력 */}
      {message && <p style={{ color: 'blue', fontWeight: 'bold' }}>{message}</p>}

      {/* 3. 최종 입장 버튼 */}
      <div style={{ marginBottom: '20px' }}>
        <button
          type="button"
          disabled={!isAvailable}
          onClick={(e) => handleEnterRoom(e)}
          style={{ 
            width: '100%', 
            padding: '10px', 
            backgroundColor: isAvailable ? 'green' : '#ccc', 
            color: '#fff',
            border: 'none',
            cursor: isAvailable ? 'pointer' : 'not-allowed'
          }}
        >
          이 방으로 최종 들어가기
        </button>
      </div>

      <hr />

      {/* 4. 💡 [은혜님 요청사항 완벽 반영] 대조 및 눈으로 확인용 실시간 리스트 구역 */}
      <div style={{ textAlign: 'left', background: '#f5f5f5', padding: '10px' }}>
        <h4>📊 현재 이 방에 들어와 있는 회원 목록 (`room_members`):</h4>
        
        {Array.isArray(existingMembers) && existingMembers.length === 0 ? (
          <p style={{ color: '#888' }}>현재 방에 참여 중인 회원이 없습니다.</p>
        ) : (
          <ul>
            {Array.isArray(existingMembers) && existingMembers.map((member, index) => (
              <li key={index}>👤 {member?.nickname || '이름 없는 회원'}</li>
            ))}
          </ul>
        )}
      </div>

      {/* 돌아가기 */}
      <div style={{ marginTop: '20px' }}>
        <button type="button" onClick={() => setPage('invite')} style={{ cursor: 'pointer' }}>
          처음 화면으로 돌아가기
        </button>
      </div>

    </div>
  )
}

export default GuestLoginPage