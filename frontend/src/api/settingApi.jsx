import { supabase } from '../lib/supabaseClient'

/**
 * 1. 닉네임 변경/수정 API
 */
export const updateNicknameApi = async (newNickname, userId) => {
  try {
    const trimmedNickname = newNickname.trim()

    // 바꿀 닉네임이 profiles 테이블에 이미 존재하는지 검사
    const { data: existingData, error: checkError } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('nickname', trimmedNickname)

    if (checkError) throw checkError

    if (existingData.length > 0) {
      throw new Error('이미 사용 중인 닉네임입니다.')
    }

    // 중복이 아니라면 로그인한 유저 본인의 profile 데이터 수정
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
// src/api/settingApi.jsx 파일 안의 updatePasswordApi를 아래처럼 수정!
export const updatePasswordApi = async (currentPassword, newPassword) => {
  try {
    // 💡 current_password를 같이 던져주면 Supabase가 알아서 현재 비밀번호를 매칭 검사합니다!
    const { error } = await supabase.auth.updateUser({
      current_password: currentPassword,
      password: newPassword
    })

    if (error) throw error
    return { success: true, message: '🔒 비밀번호가 안전하게 변경되었습니다!' }
  } catch (error) {
    // 현재 비밀번호가 틀리면 Supabase가 자동으로 에러를 뱉어줍니다.
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
    const { data: isDuplicate, error: checkError } = await supabase.rpc('check_email_exists', {
      email_to_check: trimmedEmail,
    })
    if (checkError) throw checkError
    if (isDuplicate) throw new Error('이미 사용 중인 이메일입니다.')

    const { data, error } = await supabase.auth.updateUser({ email: trimmedEmail })
    if (error) throw error

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ email: trimmedEmail })
      .eq('id', userId)
    if (profileError) throw profileError

    return { success: true, user: data.user, message: '이메일 변경 요청 완료!' }
  } catch (error) {
    console.error('이메일 변경 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 4. 회원 탈퇴 기능 API
 */
// 🔄 api/settingApi.jsx 파일 내부의 탈퇴 API 수정 예시
export const deleteUserAccountApi = async () => {
  try {
    // 💡 Supabase에게 방금 만든 'fn_delete_user_self' 함수를 실행하라고 명령!
    const { error } = await supabase.rpc('fn_delete_user_self')

    if (error) throw error

    // 성공 시 Supabase가 브라우저 세션도 알아서 파괴해 줍니다.
    return { success: true, message: '회원 탈퇴 성공' }
  } catch (error) {
    console.error('탈퇴 API 오류:', error.message)
    throw error
  }
}

/**
 * 5. 프로필 이미지 업로드 및 URL 업데이트 API (profile_image_url 반영 버전)
 */
export const uploadAvatarApi = async (file, userId) => {
  try {
    const fileExt = file.name.split('.').pop()
    const fileName = `${userId}_${Date.now()}.${fileExt}`
    const filePath = `${fileName}`

    // ① Supabase Storage의 'avatars' 버킷에 파일 업로드
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true })

    if (uploadError) throw uploadError

    // ② 업로드된 이미지의 공개 URL 주소 가져오기
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath)

//  이렇게 수정! (data,와 .select().single() 제거해서 더 깔끔하게)
const { error: profileError } = await supabase
  .from('profiles')
  .update({ profile_image_url: publicUrl })
  .eq('id', userId)

    if (profileError) throw profileError

    return { success: true, publicUrl, message: '프로필 사진이 성공적으로 변경되었습니다.' }
  } catch (error) {
    console.error('프로필 이미지 업로드 오류:', error.message)
    throw error
  }
}



