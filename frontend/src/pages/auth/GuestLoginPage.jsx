import { useState, useEffect } from 'react'
import {
  checkRoomNicknameDuplicateApi,
  insertRoomGuestApi,
  getRoomMembersByInviteCodeApi,
} from '../../api/authApi'
import { supabase } from '../../lib/supabaseClient'
import { useNavigate } from 'react-router-dom'

function GuestLoginPage() {
  const navigate = useNavigate()

  const [inviteCode, setInviteCode] = useState('')
  const [roomRealId, setRoomRealId] = useState(null)
  const [isRoomVerified, setIsRoomVerified] = useState(false)

  const [nickname, setNickname] = useState('')
  const [message, setMessage] = useState('')
  const [isAvailable, setIsAvailable] = useState(false)

  const [existingMembers, setExistingMembers] = useState([])

  // 🔄 회원 + 비회원 통합 명단 갱신 함수
  const refreshParticipantList = async (targetInviteCode, targetRoomId) => {
    if (!targetInviteCode || !targetRoomId) return

    try {
      // 1. 이 방에 속한 회원 목록 가져오기
      const memberList = await getRoomMembersByInviteCodeApi(targetInviteCode)

      const formattedMembers = Array.isArray(memberList)
        ? memberList.map((m) => ({
            nickname: m.nickname,
            type: '회원',
          }))
        : []

      // 2. 이 방에 속한 비회원 목록 가져오기
      const { data: guestList, error: guestError } = await supabase
        .from('room_guests')
        .select('nickname')
        .eq('roomid', targetRoomId)

      if (guestError) throw guestError

      const formattedGuests = Array.isArray(guestList)
        ? guestList.map((g) => ({
            nickname: g.nickname,
            type: '비회원',
          }))
        : []

      // 3. 합쳐서 화면 갱신
      setExistingMembers([...formattedMembers, ...formattedGuests])
    } catch (err) {
      console.error('명단 실시간 새로고침 실패:', err)
    }
  }

  // 1. 초대코드 방 존재 여부 체크
  const handleVerifyRoom = async (e) => {
    if (e && e.preventDefault) e.preventDefault()

    const trimmedInviteCode = inviteCode.trim().toUpperCase()

    if (!trimmedInviteCode) return

    try {
      setMessage('방 유효성 검사 중...')

      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('id, invitecode')
        .eq('invitecode', trimmedInviteCode)
        .maybeSingle()

      if (roomError) throw roomError

      if (!roomData) {
        setIsRoomVerified(false)
        setRoomRealId(null)
        setExistingMembers([])
        setMessage('❌ 존재하지 않는 초대코드입니다.')
        return
      }

      setInviteCode(trimmedInviteCode)
      setRoomRealId(roomData.id)
      setIsRoomVerified(true)
      setMessage('✅ 유효한 방 확인 완료! 참가자 명단을 실시간으로 감시합니다.')

      await refreshParticipantList(trimmedInviteCode, roomData.id)
    } catch (error) {
      console.error(error)
      setMessage('서버 통신 중 오류가 발생했습니다.')
    }
  }

  // 🚨 [실시간 통신 안테나] 테이블 변동 캐치
  useEffect(() => {
    if (!isRoomVerified || !roomRealId || !inviteCode) return

    console.log('🔥 Supabase 실시간 통합 채널 가동!')

    const participantChannel = supabase
      .channel(`room-universal-changes-${roomRealId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_guests',
          filter: `roomid=eq.${roomRealId}`,
        },
        (payload) => {
          console.log('👥 비회원 테이블 변동 감지!', payload)
          refreshParticipantList(inviteCode.trim(), roomRealId)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_members',
          filter: `roomid=eq.${roomRealId}`,
        },
        (payload) => {
          console.log('👤 회원 테이블 변동 감지!', payload)
          refreshParticipantList(inviteCode.trim(), roomRealId)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(participantChannel)
    }
  }, [isRoomVerified, roomRealId, inviteCode])

  // 2. 닉네임 중복 체크
  const handleCheckDuplicate = async (e) => {
    if (e && e.preventDefault) e.preventDefault()

    const trimmedNickname = nickname.trim()
    const trimmedInviteCode = inviteCode.trim().toUpperCase()

    if (!trimmedNickname) {
      setIsAvailable(false)
      setMessage('닉네임을 입력해 주세요.')
      return
    }

    if (!trimmedInviteCode || !isRoomVerified) {
      setIsAvailable(false)
      setMessage('먼저 초대코드를 확인해 주세요.')
      return
    }

    try {
      setMessage('방 안의 다른 닉네임들과 대조 중...')

      const isDuplicate = await checkRoomNicknameDuplicateApi(
        trimmedNickname,
        trimmedInviteCode
      )

      if (isDuplicate) {
        setIsAvailable(false)
        setMessage('❌ 이 방에 이미 존재하는 닉네임입니다.')
      } else {
        setIsAvailable(true)
        setMessage('✅ 사용 가능한 닉네임입니다!')
      }
    } catch (error) {
      console.error(error)
      setIsAvailable(false)
      setMessage('오류가 발생했습니다.')
    }
  }

  // 3. 최종 방 입장 제출
  const handleEnterRoom = async (e) => {
    if (e && e.preventDefault) e.preventDefault()

    if (!isAvailable || !isRoomVerified) return

    const trimmedNickname = nickname.trim()
    const trimmedInviteCode = inviteCode.trim().toUpperCase()

    if (!trimmedNickname) {
      setIsAvailable(false)
      setMessage('닉네임을 입력해 주세요.')
      return
    }

    try {
      setMessage('방 진입 직전 최종 중복 검사 중...')

      const isDuplicateAtLastSecond = await checkRoomNicknameDuplicateApi(
        trimmedNickname,
        trimmedInviteCode
      )

      if (isDuplicateAtLastSecond) {
        setIsAvailable(false)
        setMessage(
          '❌ 앗! 방금 전 다른 유저가 이 닉네임을 먼저 사용했습니다. 다른 닉네임을 입력해 주세요.'
        )
        return
      }

      setMessage('비회원으로 방에 입장하는 중...')

      const guestData = await insertRoomGuestApi(trimmedNickname, trimmedInviteCode)

      localStorage.setItem('guest_id', guestData.id)
      localStorage.setItem('current_room_code', trimmedInviteCode)
      localStorage.setItem('guest_nickname', trimmedNickname)

      const targetRoomId = guestData.roomid || roomRealId

      setTimeout(() => {
        navigate(`/rooms/${targetRoomId}`)
      }, 1200)
    } catch (error) {
      console.error(error)
      setMessage('입장에 실패했습니다.')
    }
  }

  return (
    <section>
      <h2>👥 비회원(게스트) 입장 창</h2>
      <p>초대코드를 입력하면 명단이 실시간으로 동기화됩니다.</p>

      <hr />

      {/* 1단계 구역 */}
      <div>
        <h3>1단계: 초대코드 입력</h3>

        <form onSubmit={handleVerifyRoom}>
          <input
            type="text"
            placeholder="초대코드를 입력하세요"
            value={inviteCode}
            disabled={isRoomVerified}
            onChange={(e) => {
              setInviteCode(e.target.value.toUpperCase())
              setIsRoomVerified(false)
              setRoomRealId(null)
              setIsAvailable(false)
              setExistingMembers([])
            }}
          />

          {!isRoomVerified && <button type="submit">방 확인하기</button>}
        </form>
      </div>

      {/* 2단계 구역 */}
      {isRoomVerified && (
        <div>
          <h3>2단계: 닉네임 설정</h3>

          <form onSubmit={handleCheckDuplicate}>
            <input
              type="text"
              placeholder="사용할 임시 닉네임"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value)
                setIsAvailable(false)
              }}
            />

            <button type="submit">중복 확인</button>
          </form>
        </div>
      )}

      {message && <p>{message}</p>}

      {/* 3단계 구역 */}
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

      {/* 4단계 구역: 실시간 명단 출력 구역 */}
      {isRoomVerified && (
        <div>
          <h4>📊 현재 이 방에 참여 중인 명단 (실시간 동기화):</h4>

          {existingMembers.length === 0 ? (
            <p>현재 이 방에 참여 중인 유저가 아무도 없습니다.</p>
          ) : (
            <ul>
              {existingMembers.map((member, index) => (
                <li key={`${member.type}-${member.nickname}-${index}`}>
                  {member.type === '회원' ? '👤 [회원] ' : '👥 [게스트] '}
                  <strong>{member.nickname}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <button type="button" onClick={() => navigate('/')}>
          처음 화면으로 돌아가기
        </button>
      </div>
    </section>
  )
}

export default GuestLoginPage