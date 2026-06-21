require('dotenv').config()

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const WebSocket = require('ws')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    realtime: {
      transport: WebSocket,
    },
  }
)

const TICK_MS = 3 * 1000

function parseArgs() {
  const args = {}
  process.argv.slice(2).forEach((arg) => {
    const match = arg.match(/^--([^=]+)=(.*)$/)
    if (match) args[match[1]] = match[2]
  })
  return args
}

let configFilePath = null

function loadConfig(configPath) {
  const resolved = path.resolve(process.cwd(), configPath)
  configFilePath = resolved
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'))
}

const args = parseArgs()
const config = args.config ? loadConfig(args.config) : null

const DURATION_MIN = Number(args.duration || config?.duration || 5)
const TOTAL_TICKS = Math.max(1, Math.round((DURATION_MIN * 60 * 1000) / TICK_MS))
const context = {
  roomId: null,
  scheduleId: null,
}

function lerp(start, end, t) {
  return start + (end - start) * t
}

async function resolveRunContext() {
  let roomId = Number(args.room || config?.room)
  let scheduleId = Number(args.schedule || config?.schedule)
  const useLatestRoom =
    args.latestRoom === 'true' ||
    args.latestRoom === '1' ||
    config?.latestRoom === true

  if (useLatestRoom || !roomId) {
    const { data: latestRoom, error } = await supabase
      .from('rooms')
      .select('id, roomname')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (!latestRoom?.id) {
      throw new Error('rooms 테이블에서 최신 방을 찾지 못했습니다.')
    }

    roomId = Number(latestRoom.id)
    console.log(`최신 방 사용: ${latestRoom.roomname || '이름 없음'} (#${roomId})`)
  }

  if (useLatestRoom || !scheduleId) {
    const { data: latestSchedule, error } = await supabase
      .from('confirmed_schedules')
      .select('id, title, location, locationlat, locationlng')
      .eq('roomid', roomId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (!latestSchedule?.id) {
      throw new Error(`room ${roomId}의 confirmed_schedules에서 사용할 일정을 찾지 못했습니다.`)
    }

    scheduleId = Number(latestSchedule.id)
    console.log(`최신 일정 사용: ${latestSchedule.title || '제목 없음'} (#${scheduleId})`)
  }

  if (!roomId || !scheduleId) {
    console.error(
      '사용법: node scripts/simulateMemberMovement.js --room=<roomId> --schedule=<scheduleId> [--duration=분(기본 5)]'
    )
    console.error(
      '   또는: node scripts/simulateMemberMovement.js --config=scripts/seed.json  (출발 등록까지 한번에 처리)'
    )
    process.exit(1)
  }

  context.roomId = roomId
  context.scheduleId = scheduleId

  persistResolvedContext()
}

function persistResolvedContext() {
  if (!config || !configFilePath) return

  const nextConfig = {
    ...config,
    room: context.roomId,
    schedule: context.scheduleId,
  }

  fs.writeFileSync(configFilePath, `${JSON.stringify(nextConfig, null, 2)}\n`)
  config.room = context.roomId
  config.schedule = context.scheduleId
}

function getParticipantIdentity(participant) {
  const isUser = Boolean(participant.userid)

  if (!isUser && !participant.guestid) {
    throw new Error('config의 participants 항목에는 userid 또는 guestid가 필요합니다.')
  }

  return {
    isUser,
    userId: isUser ? participant.userid : null,
    guestId: isUser ? null : participant.guestid,
  }
}

async function getSavedTransportMode(participant) {
  const { isUser, userId, guestId } = getParticipantIdentity(participant)
  const applyParticipantFilter = (query) =>
    isUser ? query.eq('userid', userId) : query.eq('guestid', guestId)

  const scheduledQuery = applyParticipantFilter(
    supabase
      .from('schedule_user_locations')
      .select('transportmode, createdat')
      .eq('roomid', context.roomId)
      .eq('scheduleid', context.scheduleId)
      .not('transportmode', 'is', null)
      .order('createdat', { ascending: false })
      .limit(1)
  )

  const { data: scheduledRows, error: scheduledError } = await scheduledQuery
  if (scheduledError) throw scheduledError

  if (scheduledRows?.[0]?.transportmode) {
    return scheduledRows[0].transportmode
  }

  const defaultQuery = applyParticipantFilter(
    supabase
      .from('user_locations')
      .select('transportmode, createdat')
      .eq('roomid', context.roomId)
      .not('transportmode', 'is', null)
      .order('createdat', { ascending: false })
      .limit(1)
  )

  const { data: defaultRows, error: defaultError } = await defaultQuery
  if (defaultError) throw defaultError

  return defaultRows?.[0]?.transportmode || null
}

function getConfigDestination() {
  const destination = config?.destination
  if (!destination) return null

  const lat = Number(destination.lat ?? destination.locationlat)
  const lng = Number(destination.lng ?? destination.locationlng)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('config.destination에는 숫자 lat/lng가 필요합니다.')
  }

  return {
    lat,
    lng,
    name: destination.name || destination.location || '시연 목적지',
  }
}

async function saveDestinationToSchedule(dest) {
  const { error } = await supabase
    .from('confirmed_schedules')
    .update({
      location: dest.name,
      locationlat: dest.lat,
      locationlng: dest.lng,
    })
    .eq('id', context.scheduleId)
    .eq('roomid', context.roomId)

  if (error) throw error
}

async function getDestination() {
  const { data, error } = await supabase
    .from('confirmed_schedules')
    .select('location, locationlat, locationlng')
    .eq('id', context.scheduleId)
    .eq('roomid', context.roomId)
    .maybeSingle()

  if (error) throw error
  const configDestination = getConfigDestination()
  if (configDestination) {
    await saveDestinationToSchedule(configDestination)
    console.log('config.destination을 일정의 만날 장소로 저장했습니다.')
    return configDestination
  }

  if (data?.locationlat != null && data?.locationlng != null) {
    return { lat: Number(data.locationlat), lng: Number(data.locationlng), name: data.location || '확정된 장소' }
  }

  throw new Error(
    '이 일정에 확정된 만날 장소가 없습니다. 앱에서 장소를 확정하거나 config.destination을 추가하세요.'
  )
}

async function getMovingParticipants() {
  const { data, error } = await supabase
    .from('schedule_user_locations')
    .select('userid, guestid, latitude, longitude, isdeparted, createdat')
    .eq('roomid', context.roomId)
    .eq('scheduleid', context.scheduleId)
    .order('createdat', { ascending: false })

  if (error) throw error

  const seen = new Set()
  const latest = []

  ;(data || []).forEach((row) => {
    const key = row.userid ? `user:${row.userid}` : `guest:${row.guestid}`
    if (seen.has(key)) return
    seen.add(key)
    latest.push(row)
  })

  return latest
    .filter((row) => row.isdeparted && row.latitude != null && row.longitude != null)
    .map((row) => ({
      userid: row.userid,
      guestid: row.guestid,
      startLat: Number(row.latitude),
      startLng: Number(row.longitude),
    }))
}

async function seedParticipants(participants) {
  await Promise.all(
    participants.map(async (participant) => {
      const { isUser, userId, guestId } = getParticipantIdentity(participant)
      const transportMode =
        await getSavedTransportMode(participant) ||
        participant.transportmode ||
        'car'

      const row = {
        roomid: context.roomId,
        scheduleid: context.scheduleId,
        userid: userId,
        guestid: guestId,
        latitude: Number(participant.startLat),
        longitude: Number(participant.startLng),
        accuracy: participant.accuracy ?? null,
        transportmode: transportMode,
        isdeparted: true,
        departedat: new Date().toISOString(),
        arrivedat: null,
        locationstatus: 'tracking',
        locationerror: null,
        createdat: new Date().toISOString(),
      }

      const { error } = await supabase
        .from('schedule_user_locations')
        .upsert(row, { onConflict: isUser ? 'scheduleid,userid' : 'scheduleid,guestid' })

      if (error) throw error
    })
  )
}

async function updateParticipant(participant, dest, t, isLast) {
  const jitter = () => (Math.random() - 0.5) * 0.00006

  const updateData = {
    latitude: lerp(participant.startLat, dest.lat, t) + jitter(),
    longitude: lerp(participant.startLng, dest.lng, t) + jitter(),
    createdat: new Date().toISOString(),
    locationstatus: isLast ? 'arrived' : t >= 0.8 ? 'approaching' : 'tracking',
  }

  if (isLast) {
    updateData.isdeparted = false
    updateData.arrivedat = new Date().toISOString()
  }

  let query = supabase
    .from('schedule_user_locations')
    .update(updateData)
    .eq('roomid', context.roomId)
    .eq('scheduleid', context.scheduleId)

  query = participant.userid
    ? query.eq('userid', participant.userid)
    : query.eq('guestid', participant.guestid)

  const { error } = await query
  if (error) throw error
}

async function main() {
  await resolveRunContext()

  const dest = await getDestination()

  let participants

  if (config?.participants?.length) {
    console.log(`참가자 ${config.participants.length}명 출발 상태로 세팅 중...`)
    await seedParticipants(config.participants)

    participants = config.participants.map((p) => ({
      userid: p.userid || null,
      guestid: p.guestid || null,
      startLat: Number(p.startLat),
      startLng: Number(p.startLng),
    }))
  } else {
    participants = await getMovingParticipants()
  }

  if (participants.length === 0) {
    console.error('이동시킬 참가자가 없습니다. config의 participants를 채우거나, 먼저 앱에서 "출발하기"를 눌러야 합니다.')
    process.exit(1)
  }

  console.log(`방/일정: room ${context.roomId}, schedule ${context.scheduleId}`)
  console.log(`목적지: ${dest.name} (${dest.lat}, ${dest.lng})`)
  console.log(
    `이동 대상 ${participants.length}명, 총 ${TOTAL_TICKS}틱 x ${TICK_MS / 1000}초 (약 ${DURATION_MIN}분) 후 도착 처리`
  )

  let tick = 0

  const interval = setInterval(async () => {
    tick += 1
    const t = Math.min(1, tick / TOTAL_TICKS)
    const isLast = tick >= TOTAL_TICKS

    try {
      await Promise.all(participants.map((p) => updateParticipant(p, dest, t, isLast)))
      console.log(`[tick ${tick}/${TOTAL_TICKS}] 진행률 ${(t * 100).toFixed(0)}% 위치 갱신 완료`)
    } catch (err) {
      console.error('위치 갱신 실패:', err.message)
    }

    if (isLast) {
      clearInterval(interval)
      console.log('모든 참가자 도착 처리 완료.')
    }
  }, TICK_MS)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
