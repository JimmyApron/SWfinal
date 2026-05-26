import { supabase } from '../lib/supabaseClient'

export async function saveMyLocation(locationData) {
  if (!locationData.userId) {
    throw new Error('userId가 필요합니다.')
  }

  if (!locationData.roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { data, error } = await supabase
    .from('user_locations')
    .upsert(
      {
        userid: locationData.userId,
        roomid: locationData.roomId,
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        accuracy: locationData.accuracy,
        createdat: new Date().toISOString(),
      },
      {
        onConflict: 'userid,roomid',
      }
    )
    .select()

  if (error) {
    throw error
  }

  return data
}

export async function getMyLocation(userId, roomId) {
  if (!userId) {
    throw new Error('userId가 필요합니다.')
  }

  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { data, error } = await supabase
    .from('user_locations')
    .select(`
      *,
      profiles (
        id,
        nickname,
        profile_image_url:profileimageurl
      )
    `)
    .eq('userid', userId)
    .eq('roomid', roomId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

export async function getRoomMemberLocations(roomId) {
  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { data, error } = await supabase
    .from('user_locations')
    .select(`
      *,
      profiles (
        id,
        nickname,
        profile_image_url:profileimageurl
      )
    `)
    .eq('roomid', roomId)
    .order('createdat', { ascending: false })

  if (error) {
    throw error
  }

  return data || []
}

export async function saveRoomMiddlePlace({
  roomId,
  place,
  confirmedBy,
}) {
  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  if (!place) {
    throw new Error('place 정보가 필요합니다.')
  }

  const { data, error } = await supabase
    .from('room_middle_places')
    .upsert(
      {
        roomid: Number(roomId),
        name: place.name,
        address: place.address || null,
        lat: Number(place.lat),
        lng: Number(place.lng),
        confirmedby: confirmedBy || null,
      },
      {
        onConflict: 'roomid',
      }
    )
    .select()
    .single()

  if (error) {
    console.error('중간장소 저장 실패:', error)
    throw new Error('중간장소 저장 실패')
  }

  return {
    id: data.id,
    roomid: data.roomid,
    name: data.name,
    address: data.address,
    lat: data.lat,
    lng: data.lng,
    confirmedby: data.confirmedby,
    createdat: data.createdat,
  }
}

export async function getRoomMiddlePlace(roomId) {
  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { data, error } = await supabase
    .from('room_middle_places')
    .select('*')
    .eq('roomid', Number(roomId))
    .maybeSingle()

  if (error) {
    console.error('중간장소 조회 실패:', error)
    throw new Error('중간장소 조회 실패')
  }

  if (!data) return null

  return {
    id: data.id,
    roomid: data.roomid,
    name: data.name,
    address: data.address,
    lat: data.lat,
    lng: data.lng,
    confirmedby: data.confirmedby,
    createdat: data.createdat,
  }
}

export async function deleteRoomMiddlePlace(roomId) {
  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { error } = await supabase
    .from('room_middle_places')
    .delete()
    .eq('roomid', Number(roomId))

  if (error) {
    console.error('중간장소 확정 취소 실패:', error)
    throw new Error('중간장소 확정 취소 실패')
  }
}