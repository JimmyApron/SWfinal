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
 * 3. 회원가입 API (인증 메일 없이 즉시 완결되는 버전)
 */
export async function signupApi({ email, password, nickname }) {
  // ① Supabase Auth에 회원등록 (이메일 인증이 꺼져있으면 즉시 가입 승인됨)
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/login`,
    },
  })

  if (signUpError) {
    throw signUpError
  }

  const user = signUpData.user

  if (!user) {
    throw new Error('회원가입 중 사용자 정보를 가져오지 못했습니다.')
  }

  // ② 가입 성공 즉시 profiles 테이블에 회원 정보 꽂아넣기
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