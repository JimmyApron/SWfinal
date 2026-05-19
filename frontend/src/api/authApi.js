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
    // public.profiles 테이블에서 해당 닉네임을 가진 로우를 조회합니다.
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
    throw new Error('회원가입 후 사용자 정보를 가져오지 못했습니다.')
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
 * 7. [비회원 전용] 특정 방 내부의 닉네임 중복 확인 API
 * @param {string} nickname - 검사할 임시 닉네임
 * @param {string} roomId - 대문에서 입력받은 방 초대코드
 */
export const checkRoomNicknameDuplicateApi = async (nickname, roomId) => {
  try {
    const { data, error } = await supabase
      .from('room_guests')
      .select('nickname')
      .eq('room_id', roomId)
      .eq('nickname', nickname.trim()) // 공백으로 인한 매칭 방지

    if (error) throw error

    return data.length > 0 // 해당 방에 이미 같은 닉네임이 있다면 true 반환
  } catch (error) {
    console.error('방 비회원 닉네임 체크 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 8. [비회원 전용] 비회원 방 입장 등록 API
 * @param {string} nickname - 중복확인을 통과한 임시 닉네임
 * @param {string} roomId - 대문에서 입력받은 방 초대코드
 */
export const insertRoomGuestApi = async (nickname, roomId) => {
  try {
    const { data, error } = await supabase
      .from('room_guests')
      .insert([
        {
          room_id: roomId,
          nickname: nickname.trim(),
        },
      ])
      .select()
      .single()

    if (error) throw error

    return data // 완벽하게 갱신된 비회원 Object(id, room_id, nickname, created_at) 반환
  } catch (error) {
    console.error('비회원 등록 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 9. [비회원 전용] 특정 방에 속한 모든 비회원(게스트) 목록 가져오기 API
 * @param {string} roomId - 방 초대코드
 */
export const getRoomGuestsApi = async (roomId) => {
  try {
    const { data, error } = await supabase
      .from('room_guests')
      .select('nickname')
      .eq('room_id', roomId)

    if (error) throw error
    return data // [{nickname: '유저1'}, {nickname: '유저2'}] 형태로 반환됨
  } catch (error) {
    console.error('방 게스트 목록 조회 중 오류 발생:', error.message)
    throw error
  }
}