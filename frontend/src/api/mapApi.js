import { supabase } from '../lib/supabaseClient'

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

  const { data, error } = await supabase
    .from('user_locations')
    .upsert(
      {
        userid: locationData.userId,
        guestid: null,
        roomid: Number(locationData.roomId),
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        accuracy: locationData.accuracy,
        createdat: new Date().toISOString(),
        ...buildLocationStatusFields(locationData),
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

export async function saveMyGuestLocation(locationData) {
  if (!locationData.guestId) {
    throw new Error('guestId가 필요합니다.')
  }

  if (!locationData.roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { data, error } = await supabase
    .from('user_locations')
    .upsert(
      {
        userid: null,
        guestid: locationData.guestId,
        roomid: Number(locationData.roomId),
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        accuracy: locationData.accuracy,
        createdat: new Date().toISOString(),
        ...buildLocationStatusFields(locationData),
      },
      {
        onConflict: 'guestid,roomid',
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
      profiles:userid (
        id,
        nickname,
        profileimageurl:profileimageurl
      )
    `)
    .eq('userid', userId)
    .eq('roomid', Number(roomId))
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

export async function getMyGuestLocation(guestId, roomId) {
  if (!guestId) {
    throw new Error('guestId가 필요합니다.')
  }

  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const { data, error } = await supabase
    .from('user_locations')
    .select(`
      *,
      room_guests:guestid (
        id,
        nickname
      )
    `)
    .eq('guestid', guestId)
    .eq('roomid', Number(roomId))
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

  if (error) {
    throw error
  }

  return data || []
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

export async function updateRoomLocationTransportModes(roomId, travelResults = []) {
  if (!roomId) {
    throw new Error('roomId가 필요합니다.')
  }

  const updates = (travelResults || []).filter((result) => {
    return (result.userid || result.guestid) && result.mode
  })

  await Promise.all(
    updates.map(async (result) => {
      let query = supabase
        .from('user_locations')
        .update({ transportmode: result.mode })
        .eq('roomid', Number(roomId))

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
