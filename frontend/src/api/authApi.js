import { supabase } from '../lib/supabaseClient'

/**
 * 1. 이메일 중복 확인 API
 * @param {string} email
 * @returns {Promise<boolean>} 중복이면 true, 사용 가능하면 false
 */
export const checkEmailDuplicateApi = async (email) => {
  try {
    // Supabase SQL Editor에서 생성한 check_email_exists RPC 함수를 호출합니다.
    const { data, error } = await supabase.rpc('check_email_exists', {
      email_to_check: email,
    })

    if (error) {
      throw error
    }

    return data // 존재하면 true, 없으면 false
  } catch (error) {
    console.error('이메일 중복 체크 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 2. 닉네임 중복 확인 API
 * @param {string} nickname
 * @returns {Promise<boolean>} 중복이면 true, 사용 가능하면 false
 */
export const checkNicknameDuplicateApi = async (nickname) => {
  try {
    // public.profiles 테이블에서 해당 닉네임이 존재 하는지 조회합니다.
    const { data, error } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('nickname', nickname)

    if (error) {
      throw error
    }

    // 데이터가 존재하면(length > 0) 중복된 닉네임입니다.
    return data.length > 0
  } catch (error) {
    console.error('닉네임 중복 체크 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 3. 회원가입 API
 */
export async function signupApi({ email, password, nickname }) {
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
  })

  if (signUpError) {
    throw signUpError
  }

  const user = signUpData.user

  if (!user) {
    throw new Error('회원가입 중 사용자 정보를 가져오지 못했습니다.')
  }

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .insert([
      {
        id: user.id,
        email,
        nickname,
      },
    ])
    .select()
    .single()

  if (profileError) {
    throw profileError
  }

  return {
    user,
    profile: profileData,
    message: '회원가입이 완료되었습니다.',
  }
}

/**
 * 4. 로그인 API
 */
export async function loginApi({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    throw error
  }

  const user = data.user

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw profileError
  }

  return {
    user,
    profile,
    message: '로그인에 성공했습니다.',
  }
}

/**
 * 5. 로그아웃 API
 */
export async function logoutApi() {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw error
  }

  return {
    message: '로그아웃되었습니다.',
  }
}

/**
 * 6. 현재 로그인된 사용자 정보 가져오기 API
 */
export async function getCurrentUserApi() {
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    throw error
  }

  const user = data.user

  if (!user) {
    return null
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw profileError
  }

  return {
    user,
    profile,
  }
}

/**
 * 7. [비회원 전용] 특정 방 내부의 닉네임 중복 확인 API (roomid 통합 버전)
 * @param {string} nickname - 검사할 임시 닉네임
 * @param {string} inviteCode - 문자열 방 초대코드 (예: ROOM123)
 */
export const checkRoomNicknameDuplicateApi = async (nickname, inviteCode) => {
  try {
    // 1. 먼저 초대코드를 들고 가서 진짜 방의 숫자 고유 ID(id)를 알아내야 합니다.
    const { data: roomData, error: roomError } = await supabase
      .from('rooms')
      .select('id')
      .eq('invitecode', inviteCode)
      .maybeSingle()

    if (roomError) throw roomError
    if (!roomData) throw new Error('존재하지 않는 방입니다.')

    const currentRoomRealId = roomData.id

    // 2. [회원 테이블 검사] 컬럼명을 roomid로 정확하게 조준!
    const { data: memberData, error: memberError } = await supabase
      .from('room_members')
      .select('nickname')
      .eq('roomid', currentRoomRealId)
      .eq('nickname', nickname)
      .maybeSingle()

    if (memberError) throw memberError

    // 3. [비회원 테이블 검사] 💡 은혜님 요청대로 room_id에서 roomid로 완벽 매핑 교체!
    const { data: guestData, error: guestError } = await supabase
      .from('room_guests')
      .select('nickname')
      .eq('roomid', currentRoomRealId) // 👈 언더바 삭제 완료!
      .eq('nickname', nickname)
      .maybeSingle()

    if (guestError) throw guestError

    // 4. 둘 중 한 곳에라도 똑같은 닉네임이 존재한다면 true(중복됨) 반환!
    if (memberData || guestData) {
      return true 
    }

    return false // 중복 없음 (사용 가능)

  } catch (error) {
    console.error('닉네임 중복 체크 API 오류:', error)
    throw error
  }
}

/**
 * 8. [비회원 전용] 비회원 방 입장 등록 API (roomid 통합 버전)
 * @param {string} nickname - 중복확인을 마친 임시 닉네임
 * @param {string} inviteCode - 방 초대코드
 */
export const insertRoomGuestApi = async (nickname, inviteCode) => {
  try {
    // 1. 초대코드로 진짜 방 숫자 id를 조회해옵니다.
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id')
      .eq('invitecode', inviteCode.trim())
      .maybeSingle()

    if (roomError || !room) {
      throw new Error('방을 찾을 수 없습니다.')
    }

    // 2. [버그 방지 완벽 교체] 💡 room_id 컬럼명을 은혜님의 DB 구조에 맞춰 roomid로 수정!
    const { data, error } = await supabase
      .from('room_guests')
      .insert([
        {
          roomid: room.id, // 👈 언더바를 제거하여 진짜 roomid(int8) 컬럼에 꽂아줍니다!
          nickname: nickname.trim(),
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('비회원 최종 등록 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 9. [비회원 창 전용] 초대코드로 해당 방의 진짜 회원(room_members) 목록 가져오기 API
 * @param {string} inviteCode - 방 초대코드
 */
export const getRoomMembersByInviteCodeApi = async (inviteCode) => {
  try {
    // 1. 초대코드로 rooms 테이블에서 진짜 숫자 'id' 조회
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id')
      .eq('invitecode', inviteCode)
      .maybeSingle()

    if (roomError || !room) return []

    // 2. rooms.id(숫자)와 room_members.roomid(숫자) 매핑
    const { data, error } = await supabase
      .from('room_members')
      .select('nickname')
      .eq('roomid', room.id)

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('방 회원 목록 조회 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 10. [회원 전용] 로그인 성공 후 room_members 테이블에 방 참가 등록하는 API
 * @param {string} inviteCode - 방 초대코드
 * @param {string} userId - 로그인 성공한 유저의 고유 UUID (user.id)
 */
export const joinRoomMemberApi = async (inviteCode, userId) => {
  try {
    // 1. 초대코드로 rooms 테이블에서 방의 진짜 숫자 'id'를 알아냅니다.
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id')
      .eq('invitecode', inviteCode)
      .maybeSingle()

    if (roomError || !room) {
      throw new Error('초대코드에 해당하는 방을 찾을 수 없습니다.')
    }

    // 2. 이미 해당 방에 가입된 유저인지 먼저 검사합니다 (중복 가입 방지)
    const { data: existingMember, error: checkError } = await supabase
      .from('room_members')
      .select('*')
      .eq('roomid', room.id)
      .eq('userid', userId)
      .maybeSingle()

    if (checkError) throw checkError
    if (existingMember) {
      return { message: '이미 참가한 방입니다.', room }
    }

    // 3. public.profiles 테이블에서 이 회원의 진짜 닉네임을 조회해옵니다.
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('id', userId)
      .maybeSingle()

    if (profileError) throw profileError
    
    const userNickname = userProfile?.nickname || '기존회원'

    // 4. 가입 인서트 실행 (여기서도 roomid가 안전하게 유지됩니다)
    const { error: memberError } = await supabase
      .from('room_members')
      .insert([
        {
          roomid: room.id,
          userid: userId,
          nickname: userNickname,
        },
      ])

    if (memberError) throw memberError

    return { message: '방 참가 및 회원 닉네임 연동 완료', room, nickname: userNickname }
  } catch (error) {
    console.error('회원 방 참가 및 닉네임 연동 실패 상세:', error.message)
    throw error
  }
}