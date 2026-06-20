import { supabase } from '../lib/supabaseClient'

/**
 * 1. 이메일 중복 확인 API (순수 디비 조회)
 * @param {string} email
 * @returns {Promise<boolean>} 중복이면 true, 사용 가능하면 false
 */
export const checkEmailDuplicateApi = async (email) => {
  try {
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
    const { data, error } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('nickname', nickname)

    if (error) {
      throw error
    }

    return data.length > 0
  } catch (error) {
    console.error('닉네임 중복 체크 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 3. 이메일로 OTP 인증 코드 전송 (회원가입 이메일 인증용)
 */
export async function sendEmailOtpApi(email) {
  // 이미 가입된 이메일인지 profiles 테이블에서 확인
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    throw new Error('이미 사용 중인 이메일입니다.')
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: undefined,
    },
  })

  if (error) throw error
}

/**
 * 3-1. OTP 코드 검증
 */
export async function verifyEmailOtpApi(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  })

  if (error) throw error
  return data
}

/**
 * 3-2. 회원가입 완료 API (OTP 세션 상태에서 비밀번호 설정 + 프로필 생성)
 */
export async function signupApi({ password, nickname }) {
  const { data: updateData, error: updateError } = await supabase.auth.updateUser({
    password,
    data: { nickname },
  })

  if (updateError) throw updateError

  const user = updateData.user

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (!existing) {
    const { error: profileError } = await supabase
      .from('profiles')
      .insert([{ id: user.id, email: user.email, nickname }])

    if (profileError) throw profileError
  }

  return { user, message: '회원가입이 완료되었습니다.' }
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
  // getSession() reads from localStorage — works for OAuth users
  const { data: sessionData } = await supabase.auth.getSession()
  let user = sessionData?.session?.user

  // Fallback: getUser() makes a network call
  if (!user) {
    const { data, error } = await supabase.auth.getUser()
    if (error && !error.message?.includes('session missing')) throw error
    user = data?.user
  }

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (profile) return { user, profile }

  // OAuth 신규 유저: profiles 테이블에 자동 생성
  const nickname =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    '소셜유저'
  const profileimageurl =
    user.user_metadata?.avatar_url ||
    user.user_metadata?.picture ||
    null

  const { data: newProfile, error: insertError } = await supabase
    .from('profiles')
    .insert([{ id: user.id, email: user.email, nickname, profileimageurl }])
    .select()
    .single()

  if (!insertError) return { user, profile: newProfile }

  // insert 실패 시 (DB 트리거나 중복 등) 다시 조회 시도
  const { data: retryProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (retryProfile) return { user, profile: retryProfile }

  // 그래도 없으면 auth 메타데이터로 임시 프로필 반환 (설정 페이지 접근 보장)
  return {
    user,
    profile: { id: user.id, email: user.email, nickname, profileimageurl },
  }
}

/**
 * 7. 특정 방 내부의 닉네임 중복 확인 API (roomid 통합 버전)
 */
export const checkRoomNicknameDuplicateApi = async (nickname, inviteCode) => {
  try {
    const { data: roomData, error: roomError } = await supabase
      .from('rooms')
      .select('id')
      .eq('invitecode', inviteCode)
      .maybeSingle()

    if (roomError) throw roomError
    if (!roomData) throw new Error('존재하지 않는 방입니다.')

    const currentRoomRealId = roomData.id

    const { data: memberData, error: memberError } = await supabase
      .from('room_members')
      .select('nickname')
      .eq('roomid', currentRoomRealId)
      .eq('nickname', nickname)
      .maybeSingle()

    if (memberError) throw memberError

    const { data: guestData, error: guestError } = await supabase
      .from('room_guests')
      .select('nickname')
      .eq('roomid', currentRoomRealId) 
      .eq('nickname', nickname)
      .maybeSingle()

    if (guestError) throw guestError

    if (memberData || guestData) {
      return true 
    }

    return false 

  } catch (error) {
    console.error('닉네임 중복 체크 API 오류:', error)
    throw error
  }
}

/**
 * 8. 비회원 방 입장 등록 API (roomid 통합 버전)
 */
export const insertRoomGuestApi = async (nickname, inviteCode) => {
  try {
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id')
      .eq('invitecode', inviteCode.trim())
      .maybeSingle()

    if (roomError || !room) {
      throw new Error('방을 찾을 수 없습니다.')
    }

    const { data, error } = await supabase
      .from('room_guests')
      .insert([
        {
          roomid: room.id, 
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
 * 9. 초대코드로 해당 방의 진짜 회원 목록 가져오기 API
 */
export const getRoomMembersByInviteCodeApi = async (inviteCode) => {
  try {
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id')
      .eq('invitecode', inviteCode)
      .maybeSingle()

    if (roomError || !room) return []

    // 수정된 부분: profiles 테이블과 join하여 profileimageurl 가져오기
    const { data, error } = await supabase
      .from('room_members')
      .select(`
        nickname,
        profiles(profileimageurl)
      `)
      .eq('roomid', room.id)

    if (error) throw error
    
    // 데이터 포맷 변경하여 반환 (profiles 데이터 구조 평탄화)
    return data.map(m => ({
        nickname: m.nickname,
        profileimageurl: m.profiles?.profileimageurl || null
    })) || []
  } catch (error) {
    console.error('방 회원 목록 조회 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 10. 로그인 성공 후 room_members 테이블에 방 참가 등록하는 API
 */
export const joinRoomMemberApi = async (inviteCode, userId) => {
  try {
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id')
      .eq('invitecode', inviteCode)
      .maybeSingle()

    if (roomError || !room) {
      throw new Error('초대코드에 해당하는 방을 찾을 수 없습니다.')
    }

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

    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('id', userId)
      .maybeSingle()

    if (profileError) throw profileError
    
    const userNickname = userProfile?.nickname || '기존회원'

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