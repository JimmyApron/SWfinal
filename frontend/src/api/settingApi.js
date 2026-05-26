import { supabase } from '../lib/supabaseClient'

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
    const { error } = await supabase.auth.updateUser({
      current_password: currentPassword,
      password: newPassword,
    })

    if (error) throw error

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
 * 3. 이메일 변경 기능 API
 */
export const updateEmailApi = async (newEmail, userId) => {
  try {
    const trimmedEmail = newEmail.trim()

    const { data: isDuplicate, error: checkError } =
      await supabase.rpc('check_email_exists', {
        email_to_check: trimmedEmail,
      })

    if (checkError) throw checkError

    if (isDuplicate) {
      throw new Error('이미 사용 중인 이메일입니다.')
    }

    const { data, error } = await supabase.auth.updateUser({
      email: trimmedEmail,
    })

    if (error) throw error

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ email: trimmedEmail })
      .eq('id', userId)

    if (profileError) throw profileError

    return {
      success: true,
      user: data.user,
      message: '이메일 변경 요청 완료!',
    }
  } catch (error) {
    console.error('이메일 변경 중 오류 발생:', error.message)
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