require('dotenv').config()

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const TICK_MS = 3 * 1000

function parseArgs() {
  const args = {}
  process.argv.slice(2).forEach((arg) => {
    const match = arg.match(/^--([^=]+)=(.*)$/)
    if (match) args[match[1]] = match[2]
  })
  return args
}

function loadConfig(configPath) {
  const resolved = path.resolve(process.cwd(), configPath)
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'))
}

const args = parseArgs()
const config = args.config ? loadConfig(args.config) : null

const ROOM_ID = Number(args.room || config?.room)
const SCHEDULE_ID = Number(args.schedule || config?.schedule)
const DURATION_MIN = Number(args.duration || config?.duration || 5)
const TOTAL_TICKS = Math.max(1, Math.round((DURATION_MIN * 60 * 1000) / TICK_MS))

if (!ROOM_ID || !SCHEDULE_ID) {
  console.error(
    '사용법: node scripts/simulateMemberMovement.js --room=<roomId> --schedule=<scheduleId> [--duration=분(기본 5)]'
  )
  console.error(
    '   또는: node scripts/simulateMemberMovement.js --config=scripts/seed.json  (출발 등록까지 한번에 처리)'
  )
  process.exit(1)
}

function lerp(start, end, t) {
  return start + (end - start) * t
}

async function getDestination() {
  const { data, error } = await supabase
    .from('confirmed_schedules')
    .select('location, locationlat, locationlng')
    .eq('id', SCHEDULE_ID)
    .eq('roomid', ROOM_ID)
    .maybeSingle()

  if (error) throw error
  if (!data || data.locationlat == null || data.locationlng == null) {
    throw new Error('이 일정에 확정된 만날 장소가 없습니다. 먼저 투표/일정에서 장소를 확정하세요.')
  }

  return { lat: Number(data.locationlat), lng: Number(data.locationlng), name: data.location || '확정된 장소' }
}

async function getMovingParticipants() {
  const { data, error } = await supabase
    .from('schedule_user_locations')
    .select('userid, guestid, latitude, longitude, isdeparted, createdat')
    .eq('roomid', ROOM_ID)
    .eq('scheduleid', SCHEDULE_ID)
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
      const isUser = Boolean(participant.userid)

      if (!isUser && !participant.guestid) {
        throw new Error('config의 participants 항목에는 userid 또는 guestid가 필요합니다.')
      }

      const row = {
        roomid: ROOM_ID,
        scheduleid: SCHEDULE_ID,
        userid: isUser ? participant.userid : null,
        guestid: isUser ? null : participant.guestid,
        latitude: Number(participant.startLat),
        longitude: Number(participant.startLng),
        accuracy: participant.accuracy ?? null,
        transportmode: participant.transportmode || 'car',
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
    .eq('roomid', ROOM_ID)
    .eq('scheduleid', SCHEDULE_ID)

  query = participant.userid
    ? query.eq('userid', participant.userid)
    : query.eq('guestid', participant.guestid)

  const { error } = await query
  if (error) throw error
}

async function main() {
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

  console.log(`목적지: ${dest.name} (${dest.lat}, ${dest.lng})`)
  console.log(
    `이동 대상 ${participants.length}명, 총 ${TOTAL_TICKS}틱 x 30초 (약 ${DURATION_MIN}분) 후 도착 처리`
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
