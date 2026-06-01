import { supabase } from '../lib/supabaseClient'

/**
 * 1-1. 닉네임 중복 확인 전용 API
 */
export const checkNicknameDuplicateApi = async (nickname) => {
  try {
    const trimmedNickname = nickname.trim()
    if (!trimmedNickname) throw new Error('닉네임을 입력해주세요.')

    const { data, error } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('nickname', trimmedNickname)

    if (error) throw error

    if (data.length > 0) {
      return { success: false, message: '이미 사용 중인 닉네임입니다.' }
    }

    return { success: true, message: '사용 가능한 닉네임입니다.' }
  } catch (error) {
    console.error('닉네임 중복 확인 오류:', error.message)
    throw error
  }
}

/**
 * 1. 닉네임 변경/수정 API
 */
export const updateNicknameApi = async (newNickname, userId) => {
  try {
    const trimmedNickname = newNickname.trim()

    const { data: existingData, error: checkError } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('nickname', trimmedNickname)

    if (checkError) throw checkError

    if (existingData.length > 0) {
      throw new Error('이미 사용 중인 닉네임입니다.')
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ nickname: trimmedNickname })
      .eq('id', userId)
      .select()
      .single()

    if (error) throw error

    return {
      success: true,
      data,
      message: '닉네임이 성공적으로 변경되었습니다.',
    }
  } catch (error) {
    console.error('닉네임 변경 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 2. 비밀번호 변경 기능 API
 */
export const updatePasswordApi = async (currentPassword, newPassword) => {
  try {
    // 1. 현재 사용자 정보 가져오기 (이메일 확인용)
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) throw new Error('사용자 정보를 불러올 수 없습니다.')

    // 2. 현재 비밀번호 확인을 위해 다시 로그인 시도
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })

    if (signInError) {
      throw new Error('현재 비밀번호가 일치하지 않습니다.')
    }

    // 3. 새 비밀번호로 업데이트
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) throw updateError

    return {
      success: true,
      message: '🔒 비밀번호가 안전하게 변경되었습니다!',
    }
  } catch (error) {
    console.error('비밀번호 변경 오류:', error.message)
    throw error
  }
}

/**
 * 3-1. 이메일 중복 확인 전용 API
 * RPC 대신 직접 조회를 시도하여 부수 효과를 차단합니다.
 */
export const checkEmailDuplicateApi = async (email) => {
  try {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) throw new Error('이메일을 입력해주세요.')

    // 1. profiles 테이블 확인
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('email')
      .eq('email', trimmedEmail)
    
    if (profileError) throw profileError

    if (profileData.length > 0) {
      return { success: false, message: '이미 사용 중인 이메일입니다.' }
    }

    // 2. 만약 RPC가 필요하다면 (Auth 유저까지 확인 위해) 사용하되, 
    // updateEmailApi가 아닌 이 전용 함수만 호출되는지 확인합니다.
    const { data: isDuplicate, error: rpcError } = await supabase.rpc('check_email_exists', {
      email_to_check: trimmedEmail,
    })

    if (rpcError) throw rpcError

    if (isDuplicate) {
      return { success: false, message: '이미 사용 중인 이메일입니다.' }
    }

    return { success: true, message: '사용 가능한 이메일입니다.' }
  } catch (error) {
    console.error('이메일 중복 확인 오류:', error.message)
    throw error
  }
}

/**
 * 4. 회원 탈퇴 기능 API
 */
export const deleteUserAccountApi = async () => {
  try {
    const { error } = await supabase.rpc('fn_delete_user_self')

    if (error) throw error

    return {
      success: true,
      message: '회원 탈퇴 성공',
    }
  } catch (error) {
    console.error('탈퇴 API 오류:', error.message)
    throw error
  }
}

/**
 * 5. 프로필 이미지 업로드 및 URL 업데이트 API
 */
export const uploadAvatarApi = async (file, userId) => {
  try {
    const fileExt = file.name.split('.').pop()

    const fileName = `${userId}_${Date.now()}.${fileExt}`

    const filePath = `${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true })

    if (uploadError) throw uploadError

    const {
      data: { publicUrl },
    } = supabase.storage.from('avatars').getPublicUrl(filePath)

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ profileimageurl: publicUrl })
      .eq('id', userId)

    if (profileError) throw profileError

    return {
      success: true,
      publicUrl,
      message: '프로필 사진이 성공적으로 변경되었습니다.',
    }
  } catch (error) {
    console.error('프로필 이미지 업로드 오류:', error.message)
    throw error
  }
}
