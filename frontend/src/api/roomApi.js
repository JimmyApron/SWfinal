import { supabase } from './supabaseClient'

// 랜덤 초대코드 생성 함수
function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

export async function createRoom(roomData) {
  const { data, error } = await supabase
    .from('rooms')
    .insert([{
      roomName: roomData.roomName,
      description: roomData.description,
      inviteCode: generateInviteCode()  // 자동생성!
    }])
    .select()
    .single()

  if (error) throw new Error("방 생성 실패")

  return { room: data }
}
//supabase에 rooms 테이블에 저장 