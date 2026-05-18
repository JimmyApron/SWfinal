import { supabase } from './supabaseClient'

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