import { useState, useEffect } from 'react'
import { checkRoomNicknameDuplicateApi, insertRoomGuestApi, getRoomGuestsApi } from '../api/authApi'

function GuestLoginPage({ roomId, setPage }) {
  // 초기값들을 명확하고 안전하게 바인딩
  const [nickname, setNickname] = useState('')
  const [message, setMessage] = useState('')
  const [isAvailable, setIsAvailable] = useState(false)
  const [existingGuests, setExistingGuests] = useState([])

  // 현재 방에 있는 기존 유저 리스트 가져오기
  const fetchExistingGuests = async () => {
    if (!roomId) return
    try {
      const data = await getRoomGuestsApi(roomId)
      // data가 정상적인 배열일 때만 넣고, 아니면 무조건 빈 배열 처리
      setExistingGuests(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('목록 로드 실패:', error)
      setExistingGuests([])
    }
  }

  useEffect(() => {
    fetchExistingGuests()
  }, [roomId])

  // 1. 닉네임 중복 체크 (event 객체를 받아오도록 명확히 수정!)
  const handleCheckDuplicate = async (e) => {
    // 💡 [핵심 안전장치] 버튼 클릭 이벤트가 상위 폼이나 브라우저를 새로고침하는 것을 원천 차단합니다.
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
      fetchExistingGuests() // 목록 새로고침
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
        
        {/* 💡 onClick 이벤트에 e를 명확히 던져줍니다 */}
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

      {/* 4. 대조 및 눈으로 확인용 실시간 리스트 구역 */}
      <div style={{ textAlign: 'left', background: '#f5f5f5', padding: '10px' }}>
        <h4>📊 현재 이 방에 먼저 들어와 있는 사람들 목록:</h4>
        {/* 💡 혹시 모를 에러를 막기 위해 배열 체크 가드를 한 번 더 칩니다 */}
        {Array.isArray(existingGuests) && existingGuests.length === 0 ? (
          <p style={{ color: '#888' }}>현재 아무도 없습니다! 첫 진입 테스트가 가능합니다.</p>
        ) : (
          <ul>
            {Array.isArray(existingGuests) && existingGuests.map((guest, index) => (
              <li key={index}>👤 {guest?.nickname || '이름 없음'}</li>
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