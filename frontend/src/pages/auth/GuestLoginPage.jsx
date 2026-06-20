import { useState, useEffect } from 'react'
import {
  checkRoomNicknameDuplicateApi,
  insertRoomGuestApi,
  getRoomMembersByInviteCodeApi,
} from '../../api/authApi'
import { supabase } from '../../lib/supabaseClient'
import { useNavigate } from 'react-router-dom'
import { FaChevronLeft, FaUserFriends, FaSignInAlt, FaUsers } from 'react-icons/fa'
import './GuestLoginPage.css'

function GuestLoginPage() {
  const navigate = useNavigate()

  const [inviteCode, setInviteCode] = useState('')
  const [roomRealId, setRoomRealId] = useState(null)
  const [isRoomVerified, setIsRoomVerified] = useState(false)

  const [nickname, setNickname] = useState('')
  const [message, setMessage] = useState('')
  const [isAvailable, setIsAvailable] = useState(false)

  const [existingMembers, setExistingMembers] = useState([])
  const [isParticipantOpen, setIsParticipantOpen] = useState(false)

  const refreshParticipantList = async (targetInviteCode, targetRoomId) => {
    if (!targetInviteCode || !targetRoomId) return

    try {
      const memberList = await getRoomMembersByInviteCodeApi(targetInviteCode)

      const formattedMembers = Array.isArray(memberList)
        ? memberList.map((m) => ({
            nickname: m.nickname,
            type: '회원',
            profileimageurl: m.profileimageurl,
          }))
        : []

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

      setExistingMembers([...formattedMembers, ...formattedGuests])
    } catch (err) {
      console.error('명단 실시간 새로고침 실패:', err)
    }
  }

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
        setMessage('존재하지 않는 초대코드입니다.')
        return
      }

      setInviteCode(trimmedInviteCode)
      setRoomRealId(roomData.id)
      setIsRoomVerified(true)
      setMessage('유효한 초대코드입니다.')

      await refreshParticipantList(trimmedInviteCode, roomData.id)
    } catch (error) {
      console.error(error)
      setMessage('서버 통신 중 오류가 발생했습니다.')
    }
  }

  useEffect(() => {
    if (!isRoomVerified || !roomRealId || !inviteCode) return

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
          refreshParticipantList(inviteCode.trim(), roomRealId)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(participantChannel)
    }
  }, [isRoomVerified, roomRealId, inviteCode])

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
      setMessage('닉네임을 확인하고 있습니다...')

      const isDuplicate = await checkRoomNicknameDuplicateApi(
        trimmedNickname,
        trimmedInviteCode
      )

      if (isDuplicate) {
        setIsAvailable(false)
        setMessage('이 방에 이미 존재하는 닉네임입니다.')
      } else {
        setIsAvailable(true)
        setMessage('사용 가능한 닉네임입니다.')
      }
    } catch (error) {
      console.error(error)
      setIsAvailable(false)
      setMessage('오류가 발생했습니다.')
    }
  }

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
      setMessage('입장 정보를 확인하고 있습니다...')

      const isDuplicateAtLastSecond = await checkRoomNicknameDuplicateApi(
        trimmedNickname,
        trimmedInviteCode
      )

      if (isDuplicateAtLastSecond) {
        setIsAvailable(false)
        setMessage(
          '앗! 방금 전 다른 유저가 이 닉네임을 먼저 사용했습니다. 다른 닉네임을 입력해 주세요.'
        )
        return
      }

      setMessage('방에 입장하고 있습니다...')

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
    <div className="guest-page">
      <header className="guest-header">
        <button className="guest-back-button" onClick={() => navigate(-1)} aria-label="이전 화면으로 돌아가기">
          <FaChevronLeft size={20} />
        </button>
        <h1 className="guest-title">비회원으로 참여하기</h1>
      </header>

      <main className="guest-content">
        <div className="guest-intro">
          <FaUserFriends size={48} className="guest-intro-icon" />
          <p className="guest-intro-text">초대코드만 입력하면 빠르게 방에 들어갈 수 있어요.</p>
        </div>

        <section className="guest-card">
          <form onSubmit={handleVerifyRoom}>
            <div className="guest-step">
              <div className="guest-step-indicator">
                <div className="guest-step-number">1</div>
                <div className="guest-step-line" />
              </div>
              <div className="guest-step-content">
                <h3 className="guest-step-title">1. 초대코드 입력</h3>
                <div className="guest-input-row">
                  <input className="guest-input" type="text" placeholder="초대코드를 입력해주세요" value={inviteCode} disabled={isRoomVerified} onChange={(e) => {
                    setInviteCode(e.target.value.toUpperCase())
                    setIsRoomVerified(false)
                    setRoomRealId(null)
                    setIsAvailable(false)
                    setExistingMembers([])
                  }} aria-label="초대코드" />
                  {!isRoomVerified && <button className="guest-button" type="submit">확인</button>}
                </div>
                {message && isRoomVerified && <p className="guest-message message-success">✓ {message}</p>}
                {message && !isRoomVerified && inviteCode && <p className="guest-message message-error">{message}</p>}
              </div>
            </div>
          </form>

          <div className="guest-divider" />

          <form onSubmit={handleCheckDuplicate}>
            <div className="guest-step">
              <div className="guest-step-indicator">
                <div className="guest-step-number">2</div>
                <div className="guest-step-line" />
              </div>
              <div className="guest-step-content">
                <h3 className="guest-step-title">2. 닉네임 설정</h3>
                <div className="guest-input-row">
                  <input className="guest-input" type="text" placeholder="사용할 닉네임 입력" value={nickname} disabled={!isRoomVerified} onChange={(e) => {
                    setNickname(e.target.value)
                    setIsAvailable(false)
                  }} aria-label="닉네임" />
                  <button className="guest-button" type="submit" disabled={!isRoomVerified}>중복 확인</button>
                </div>
                {message && isAvailable && <p className="guest-message message-success">✓ {message}</p>}
                {message && !isAvailable && nickname && !isRoomVerified && <p className="guest-message message-error">{message}</p>}
              </div>
            </div>
          </form>

          <div className="guest-divider" />

          <div className="guest-step">
            <div className="guest-step-indicator">
              <div className="guest-step-number">3</div>
            </div>
            <div className="guest-step-content">
              <h3 className="guest-step-title">3. 방 입장</h3>
              <button className="guest-submit-button" type="button" disabled={!isRoomVerified || !isAvailable} onClick={handleEnterRoom}>
                <FaSignInAlt /> 방에 참여하기
              </button>
            </div>
          </div>
        </section>

        {isRoomVerified && (
          <section className="guest-participants-card">
            <div className="guest-participants-header" onClick={() => setIsParticipantOpen(!isParticipantOpen)} aria-expanded={isParticipantOpen}>
              <div className="participant-header-icon">
                <FaUsers size={20} />
              </div>
              <div className="guest-participants-header-text">
                <strong>현재 참여자 보기 ({existingMembers.length}명)</strong>
                <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>실시간으로 동기화돼요</p>
              </div>
              <span>{isParticipantOpen ? '▲' : '▼'}</span>
            </div>
            {isParticipantOpen && (
              <div className="guest-participants-list">
                {existingMembers.length === 0 ? (
                  <p style={{ fontSize: '14px', color: '#888' }}>현재 참여 중인 사용자가 없습니다.</p>
                ) : (
                  existingMembers.map((member, index) => (
                    <div key={index} className="guest-participant-item">
                      <div className="participant-info">
                        <div className="avatar">
                          {member.profileimageurl ? (
                            <img src={member.profileimageurl} alt={member.nickname} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            member.nickname.charAt(0)
                          )}
                        </div>
                        <span>{member.nickname}</span>
                      </div>
                      <span className={`badge ${member.type === '회원' ? 'badge-member' : 'badge-guest'}`}>{member.type}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        )}

        <button className="guest-home-link" type="button" onClick={() => navigate('/')}>처음 화면으로 돌아가기</button>
      </main>
    </div>
  )
}

export default GuestLoginPage