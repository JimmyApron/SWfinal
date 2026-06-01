import { supabase } from '../lib/supabaseClient'

function getLocationTable(scheduleId) {
  return scheduleId ? 'schedule_user_locations' : 'user_locations'
}

function buildLocationStatusFields(locationData) {
  const statusFields = {}

  if (typeof locationData.isDeparted === 'boolean') {
    statusFields.isdeparted = locationData.isDeparted
  }

  if ('departedAt' in locationData) {
    statusFields.departedat = locationData.departedAt
  }

  if ('arrivedAt' in locationData) {
    statusFields.arrivedat = locationData.arrivedAt
  }

  if ('lastLocationUpdatedAt' in locationData) {
    statusFields.lastlocationupdatedat = locationData.lastLocationUpdatedAt
  }

  if (locationData.locationStatus) {
    statusFields.locationstatus = locationData.locationStatus
  }

  if ('locationError' in locationData) {
    statusFields.locationerror = locationData.locationError
  }

  if (locationData.transportMode) {
    statusFields.transportmode = locationData.transportMode
  }

  return statusFields
}

export async function saveMyLocation(locationData) {
  if (!locationData.userId) {
    throw new Error('userId가 필요합니다.')
  }

  if (!locationData.roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const scheduleId = locationData.scheduleId ? Number(locationData.scheduleId) : null
  const { data, error } = await supabase
    .from(getLocationTable(scheduleId))
    .upsert(
      {
        userid: locationData.userId,
        guestid: null,
        roomid: Number(locationData.roomId),
        ...(scheduleId ? { scheduleid: scheduleId } : {}),
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        accuracy: locationData.accuracy,
        createdat: new Date().toISOString(),
        ...buildLocationStatusFields(locationData),
      },
      {
        onConflict: scheduleId ? 'scheduleid,userid' : 'userid,roomid',
      }
    )
    .select()

  if (error) {
    throw error
  }

  return data
}

export async function saveMyGuestLocation(locationData) {
  if (!locationData.guestId) {
    throw new Error('guestId가 필요합니다.')
  }

  if (!locationData.roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const scheduleId = locationData.scheduleId ? Number(locationData.scheduleId) : null
  const { data, error } = await supabase
    .from(getLocationTable(scheduleId))
    .upsert(
      {
        userid: null,
        guestid: locationData.guestId,
        roomid: Number(locationData.roomId),
        ...(scheduleId ? { scheduleid: scheduleId } : {}),
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        accuracy: locationData.accuracy,
        createdat: new Date().toISOString(),
        ...buildLocationStatusFields(locationData),
      },
      {
        onConflict: scheduleId ? 'scheduleid,guestid' : 'guestid,roomid',
      }
    )
    .select()

  if (error) {
    throw error
  }

  return data
}

export async function getMyLocation(userId, roomId, scheduleId = null) {
  if (!userId) {
    throw new Error('userId가 필요합니다.')
  }

  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { data, error } = await supabase
    .from(getLocationTable(scheduleId))
    .select(`
      *,
      profiles:userid (
        id,
        nickname,
        profileimageurl:profileimageurl
      )
    `)
    .eq('userid', userId)
    .eq('roomid', Number(roomId))
    .match(scheduleId ? { scheduleid: Number(scheduleId) } : {})
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

export async function getMyGuestLocation(guestId, roomId, scheduleId = null) {
  if (!guestId) {
    throw new Error('guestId가 필요합니다.')
  }

  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { data, error } = await supabase
    .from(getLocationTable(scheduleId))
    .select(`
      *,
      room_guests:guestid (
        id,
        nickname
      )
    `)
    .eq('guestid', guestId)
    .eq('roomid', Number(roomId))
    .match(scheduleId ? { scheduleid: Number(scheduleId) } : {})
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

export async function getRoomMemberLocations(roomId, scheduleId = null) {
  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { data, error } = await supabase
    .from(getLocationTable(scheduleId))
    .select(`
      *,
      profiles:userid (
        id,
        nickname,
        profileimageurl:profileimageurl
      ),
      room_guests:guestid (
        id,
        nickname
      )
    `)
    .eq('roomid', Number(roomId))
    .match(scheduleId ? { scheduleid: Number(scheduleId) } : {})
    .order('createdat', { ascending: false })

  if (error) {
    throw error
  }

  if (!scheduleId) {
    return data || []
  }

  const { data: defaultLocations, error: defaultError } = await supabase
    .from('user_locations')
    .select(`
      *,
      profiles:userid (
        id,
        nickname,
        profileimageurl:profileimageurl
      ),
      room_guests:guestid (
        id,
        nickname
      )
    `)
    .eq('roomid', Number(roomId))
    .order('createdat', { ascending: false })

  if (defaultError) {
    throw defaultError
  }

  const scheduleLocations = data || []
  const savedParticipantKeys = new Set(
    scheduleLocations.map((location) => location.userid || location.guestid)
  )
  const inheritedLocations = (defaultLocations || [])
    .filter((location) => !savedParticipantKeys.has(location.userid || location.guestid))
    .map((location) => ({
      ...location,
      id: `default-${location.id}`,
      scheduleid: Number(scheduleId),
      isdeparted: false,
      departedat: null,
      arrivedat: null,
      locationstatus: 'idle',
      locationerror: null,
      isinheriteddefault: true,
    }))

  return [...scheduleLocations, ...inheritedLocations]
}

export async function getRoomParticipants(roomId) {
  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { data: members, error: memberError } = await supabase
    .from('room_members')
    .select(`
      id,
      roomid,
      userid,
      nickname,
      profiles:userid (
        id,
        nickname,
        profileimageurl:profileimageurl
      )
    `)
    .eq('roomid', Number(roomId))

  if (memberError) {
    throw memberError
  }

  const { data: guests, error: guestError } = await supabase
    .from('room_guests')
    .select('id, roomid, nickname')
    .eq('roomid', Number(roomId))

  if (guestError) {
    throw guestError
  }

  return [
    ...(members || []).map((member) => ({
      ...member,
      guestid: null,
      participantType: 'member',
    })),
    ...(guests || []).map((guest) => ({
      id: `guest-${guest.id}`,
      guestrowid: guest.id,
      roomid: guest.roomid,
      userid: null,
      guestid: guest.id,
      nickname: guest.nickname,
      participantType: 'guest',
    })),
  ]
}

export async function updateRoomLocationTransportModes(roomId, travelResults = [], scheduleId = null) {
  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const updates = (travelResults || []).filter((result) => {
    return (result.userid || result.guestid) && result.mode
  })

  await Promise.all(
    updates.map(async (result) => {
      let query = supabase
        .from(getLocationTable(scheduleId))
        .update({ transportmode: result.mode })
        .eq('roomid', Number(roomId))

      if (scheduleId) {
        query = query.eq('scheduleid', Number(scheduleId))
      }

      if (result.userid) {
        query = query.eq('userid', result.userid)
      } else {
        query = query.eq('guestid', result.guestid)
      }

      const { error } = await query

      if (error) {
        throw error
      }
    })
  )
}

export async function saveRoomMiddlePlace({ roomId, place, confirmedBy }) {
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

/**
 * 위치 상태 및 출발/도착 시간 업데이트
 *
 * 새로 생긴 기능 유지:
 * - 출발 상태 업데이트
 * - 도착 임박 상태 업데이트
 * - 도착 완료 상태 업데이트
 * - 회원/게스트 둘 다 처리
 */
export async function updateLocationStatus({
  roomId,
  scheduleId,
  userId,
  guestId,
  status,
  isDeparted,
  isArrived,
}) {
  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  if (!userId && !guestId) {
    console.warn('위치 상태 업데이트 생략: userId 또는 guestId가 필요합니다.')
    return
  }

  const updateData = {
    locationstatus: status,
    lastlocationupdatedat: new Date().toISOString(),
  }

  if (typeof isDeparted === 'boolean') {
    updateData.isdeparted = isDeparted
  }

  if (isDeparted) {
    updateData.departedat = new Date().toISOString()
  }

  if (isArrived) {
    updateData.isdeparted = false
    updateData.arrivedat = new Date().toISOString()
  }

  let query = supabase
    .from(getLocationTable(scheduleId))
    .update(updateData)
    .eq('roomid', Number(roomId))

  if (scheduleId) {
    query = query.eq('scheduleid', Number(scheduleId))
  }

  if (userId) {
    query = query.eq('userid', userId)
  } else {
    query = query.eq('guestid', guestId)
  }

  const { error } = await query

  if (error) {
    console.error(`위치 상태(${status}) 업데이트 실패:`, error)
    throw error
  }
}
