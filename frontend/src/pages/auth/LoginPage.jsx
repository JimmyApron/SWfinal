import { useState } from 'react'
import { loginApi, checkRoomNicknameDuplicateApi } from '../../api/authApi'
import { FaEye, FaEyeSlash } from 'react-icons/fa'
import { useNavigate, useSearchParams } from "react-router-dom";
import { joinRoomByInviteCode } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";

function LoginPage() {


  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  //아래는 url에서 읽어오는 값
  const inviteCodeParam = searchParams.get("inviteCode")?.trim().toUpperCase();//초대코드 대소문자변환
 
  console.log("URL에서 읽은 inviteCode:", inviteCodeParam); 
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  
  // 💡 [비회원 기능용 추가 상태값들]
  const [isGuestMode, setIsGuestMode] = useState(false) // 비회원 입력창 전환 스위치
  const [guestNickname, setGuestNickname] = useState('') // 비회원 닉네임
  const [inviteCode, setInviteCode] = useState('') // 들어가려는 방 초대코드 사용자 input 값
  const [isRoomNicknameChecked, setIsRoomNicknameChecked] = useState(false) // 방 닉네임 중복체크 여부

  // 회원 로그인 핸들러
  const handleLogin = async (event) => {

    event.preventDefault()
    if (!email || !password) {
      setMessage('이메일과 비밀번호를 모두 입력해주세요.')
      return
    }
    try {
      setMessage('로그인 중입니다...');

      await loginApi({ email, password });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (inviteCodeParam && user) {
        const result = await joinRoomByInviteCode(inviteCodeParam, user.id);
        navigate(`/rooms/${result.room.id}`);
      } else {
        navigate('/home');
      }  
    } catch (error) {
      console.error('로그인 오류:', error)
      setMessage(error.message || '로그인에 실패했습니다. 정보를 확인해주세요.')
    }
  }

  // 💡 [추가] 비회원 방 내부 닉네임 중복 확인 핸들러
  const handleGuestNicknameCheck = async (event) => {
    event.preventDefault()
    if (!inviteCode) {
      setMessage('⚠️ 진입할 방의 초대코드를 먼저 입력해주세요.')
      return
    }
    if (!guestNickname) {
      setMessage('⚠️ 사용할 임시 닉네임을 입력해주세요.')
      return
    }

    try {
      setMessage('방 멤버들의 닉네임과 중복 확인 중입니다...')
      // 방 코드와 닉네임을 넘겨서 중복 체크
      const isDuplicate = await checkRoomNicknameDuplicateApi(guestNickname, inviteCode)

      if (isDuplicate) {
        setIsRoomNicknameChecked(false)
        setMessage('❌ 이 방에 이미 존재하는 닉네임입니다. 다른 닉네임을 써주세요.')
      } else {
        setIsRoomNicknameChecked(true)
        setMessage('✅ 사용 가능한 닉네임입니다! 입장 버튼을 눌러주세요.')
      }
    } catch (error) {
      console.error('방 닉네임 체크 오류:', error)
      setMessage('중복 체크에 실패했습니다. 코드를 확인해주세요.')
    }
  }

  // 💡 [추가] 비회원 입장 최종 제출 핸들러
  const handleGuestSubmit = async (event) => {
    event.preventDefault()
    if (!isRoomNicknameChecked) {
      setMessage('⚠️ 닉네임 중복확인을 먼저 완료해주세요.')
      return
    }

    try {
      setMessage('비회원으로 방에 입장하는 중입니다...')
      
      // TODO: Supabase 익명로그인을 쓰거나, 세션에 임시 유저 정보를 저장하고 방으로 리다이렉트
      console.log('비회원 입장 완료:', { guestNickname, inviteCode })
      setMessage('비회원 입장에 성공했습니다!')
      
      // 예: 해당 방으로 바로 다이렉트 이동
      // navigate(`/room/${inviteCode}`)
    } catch (error) {
      setMessage('입장에 실패했습니다.')
    }
  }

  return (
    <section style={{ maxWidth: '400px', margin: '0 auto', padding: '20px' }}>
      
      {/* 💡 Mode에 따라 상단 제목 가변 처리 */}
      <h2>{isGuestMode ? '비회원 방 입장' : '로그인'}</h2>

      {/* 1️⃣ 일반 회원 로그인 폼 */}
      {!isGuestMode ? (
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '10px' }}>
            <input
              type="email"
              placeholder="이메일"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ position: 'relative', width: '100%', marginBottom: '10px' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="비밀번호"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={{ width: '100%', paddingRight: '40px', boxSizing: 'border-box' }}
            />
            <button 
              type="button" 
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: '#666'
              }}
            >
              {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
            </button>
          </div>

          <button type="submit" style={{ width: '100%', padding: '8px', cursor: 'pointer' }}>
            로그인
          </button>
        </form>
      ) : (
        /* 2️⃣ 💡 [추가] 비회원 전용 입력 폼 */
        <form onSubmit={handleGuestSubmit}>
          <div style={{ marginBottom: '10px' }}>
            <input
              type="text"
              placeholder="방 초대코드 입력"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <input
              type="text"
              placeholder="사용할 임시 닉네임"
              value={guestNickname}
              onChange={(event) => {
                setGuestNickname(event.target.value)
                setIsRoomNicknameChecked(false) // 수정 시 중복체크 초기화
              }}
              style={{ flex: 1, padding: '8px', boxSizing: 'border-box' }}
            />
            <button type="button" onClick={handleGuestNicknameCheck} style={{ cursor: 'pointer' }}>
              중복확인
            </button>
          </div>

          <button 
            type="submit"
            disabled={!isRoomNicknameChecked}
            style={{ 
              width: '100%', padding: '8px', 
              cursor: isRoomNicknameChecked ? 'pointer' : 'not-allowed' 
            }}
          >
            비회원으로 방 들어가기
          </button>
        </form>
      )}

      {/* 안내 메시지 구역 */}
      {message && <p style={{ fontSize: '14px', marginTop: '10px' }}>{message}</p>}

      {/* 💡 [핵심 요구사항] 하단 회색 밑줄 가독성 링크 영역 */}
      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <button
          type="button"
          onClick={() => {
            setIsGuestMode(!isGuestMode) // 모드 전환 스위칭
            setMessage('') // 메시지 초기화
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#888.js', // 회색 글씨
            textDecoration: 'underline', // 밑줄 긋기
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          {isGuestMode ? '기존 회원 로그인으로 돌아가기' : '비회원으로 이용하기'}
        </button>
      </div>

    </section>
  )
}

export default LoginPage