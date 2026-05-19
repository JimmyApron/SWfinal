import { supabase } from './supabaseClient'

/**
 * 1. �̸��� �ߺ� Ȯ�� API
 * @param {string} email
 * @returns {Promise<boolean>} �ߺ��̸� true, ��� �����ϸ� false
 */
export const checkEmailDuplicateApi = async (email) => {
  try {
    // Supabase SQL Editor���� ������ check_email_exists RPC �Լ��� ȣ���մϴ�.
    const { data, error } = await supabase.rpc('check_email_exists', {
      email_to_check: email,
    })

    if (error) {
      throw error
    }

    return data // �����ϸ� true, ������ false
  } catch (error) {
    console.error('�̸��� �ߺ� üũ �� ���� �߻�:', error.message)
    throw error
  }
}

/**
 * 2. �г��� �ߺ� Ȯ�� API
 * @param {string} nickname
 * @returns {Promise<boolean>} �ߺ��̸� true, ��� �����ϸ� false
 */
export const checkNicknameDuplicateApi = async (nickname) => {
  try {
    // public.profiles ���̺����� �ش� �г����� ���� �ο츦 ��ȸ�մϴ�.
    const { data, error } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('nickname', nickname)

    if (error) {
      throw error
    }

    // �����Ͱ� �����ϸ�(length > 0) �ߺ��� �г����Դϴ�.
    return data.length > 0
  } catch (error) {
    console.error('�г��� �ߺ� üũ �� ���� �߻�:', error.message)
    throw error
  }
}

/**
 * 3. ȸ������ API
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
    throw new Error('ȸ������ �� ����� ������ �������� ���߽��ϴ�.')
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
    message: 'ȸ�������� �Ϸ�Ǿ����ϴ�.',
  }
}

/**
 * 4. �α��� API
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
    message: '�α��ο� �����߽��ϴ�.',
  }
}

/**
 * 5. �α׾ƿ� API
 */
export async function logoutApi() {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw error
  }

  return {
    message: '�α׾ƿ��Ǿ����ϴ�.',
  }
}

/**
 * 6. ���� �α��ε� ����� ���� �������� API
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
 * 7. [비회원 전용] 수정된 int8 구조 반영 ➡️ 특정 방 내부의 닉네임 중복 확인 API
 * @param {string} nickname - 검사할 임시 닉네임
 * @param {string} inviteCode - 대문에서 넘어온 문자열 방 초대코드 (예: ROOM123)
 */
export const checkRoomNicknameDuplicateApi = async (nickname, inviteCode) => {
  try {
    // 1. 초대코드로 먼저 rooms 테이블에서 진짜 숫자 고유 번호(id)를 알아냅니다.
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id')
      .eq('invitecode', inviteCode.trim())
      .maybeSingle()

    if (roomError || !room) {
      throw new Error('존재하지 않는 초대코드입니다.')
    }

    // 2. [수정 완료] 알아낸 진짜 방 숫자 id(int8)를 가지고 room_guests 테이블을 찌릅니다!
    const { data: guestData, error: guestError } = await supabase
      .from('room_guests')
      .select('nickname')
      .eq('room_id', room.id) // 💡 이제 코드가 아니라 진짜 숫자 ID 매핑!
      .eq('nickname', nickname.trim())

    if (guestError) throw guestError

    // 3. 기존 방 회원들과도 안 겹치게 room_members도 같이 대조해 줍니다.
    const { data: memberData, error: memberError } = await supabase
      .from('room_members')
      .select('nickname')
      .eq('roomid', room.id)
      .eq('nickname', nickname.trim())

    if (memberError) throw memberError

    return guestData.length > 0 || memberData.length > 0
  } catch (error) {
    console.error('방 비회원 닉네임 체크 중 오류 발생:', error.message)
    throw error
  }
}

/**
 * 8. [비회원 전용] 수정된 int8 구조 반영 ➡️ 비회원 방 입장 등록 API
 * @param {string} nickname - 중복확인을 마친 임시 닉네임
 * @param {string} inviteCode - 대문에서 전달받은 문자열 방 초대코드
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

    // 2. [수정 완료] room_guests.room_id에 진짜 숫자 고유 id를 쾅 박아줍니다!
    const { data, error } = await supabase
      .from('room_guests')
      .insert([
        {
          room_id: room.id, // 💡 문자열 대신 진짜 숫자 고유 ID(int8)가 완벽하게 저장됩니다!
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
 * @param {string} inviteCode - 부모가 넘겨준 문자열 방 초대코드
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

    // 2. [진짜 DB 구조 연동] rooms.id(숫자)와 room_members.roomid(숫자) 매핑!
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
 * 10. [회원 전용] 로그인 성공 후 room_members 테이블에 방 참가 등록하는 API (원래 닉네임 자동 연동 버전)
 * @param {string} inviteCode - 대문에서 입력한 방 초대코드
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
      // 이미 참가해 있다면 에러를 내지 않고 기존 방 정보만 스무스하게 반환합니다.
      return { message: '이미 참가한 방입니다.', room }
    }

    // 3. 💡 [은혜님 요구사항 반영 핵심 추가!]
    // public.profiles 테이블에서 이 회원의 진짜 회원가입 당시 닉네임을 조회해옵니다.
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('id', userId)
      .maybeSingle()

    if (profileError) throw profileError
    
    // 혹시라도 프로필 닉네임이 없으면 '회원' 혹은 기본값으로 방어해 줍니다.
    const userNickname = userProfile?.nickname || '기존회원'

    // 4. 💡 가이드 규칙 업그레이드 인서트 실행!
    // 이제 nickname 자리에 null 대신 방금 찾아온 회원의 진짜 닉네임(userNickname)을 꽂아줍니다!
    const { error: memberError } = await supabase
      .from('room_members')
      .insert([
        {
          roomid: room.id,
          userid: userId,
          nickname: userNickname, // ➡️ null에서 회원의 실제 닉네임으로 변경!
        },
      ])

    if (memberError) throw memberError

    return { message: '방 참가 및 회원 닉네임 연동 완료', room, nickname: userNickname }
  } catch (error) {
    console.error('회원 방 참가 및 닉네임 연동 실패 상세:', error.message)
    throw error
  }
}