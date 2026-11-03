const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const router = express.Router()
let client

router.post('/rooms/:roomId/participants', async (req, res) => {
  try {
    const roomId = Number(req.params.roomId)
    const ids = req.body?.meetingIds
    if (!Number.isSafeInteger(roomId) || roomId < 1 || !Array.isArray(ids) || ids.length > 1000 ||
        ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
      return res.status(400).json({ message: '만남 조회 정보가 올바르지 않습니다.' })
    }
    const token = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return res.status(401).json({ message: '로그인이 필요합니다.' })
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ message: '참여자 조회 서버 설정이 필요합니다.' })
    }
    if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: auth, error: authError } = await client.auth.getUser(token)
    if (authError || !auth?.user) return res.status(401).json({ message: '로그인을 다시 해 주세요.' })
    const { data: member, error: memberError } = await client.from('room_members').select('id')
      .eq('roomid', roomId).eq('userid', auth.user.id).maybeSingle()
    if (memberError) throw memberError
    if (!member) return res.status(403).json({ message: '이 방의 회원만 참여자를 볼 수 있습니다.' })
    const participantsByMeeting = {}
    const uniqueIds = [...new Set(ids)]
    // Chunk the IN filter to keep query URLs bounded; paginate nested participants too.
    for (let index = 0; index < uniqueIds.length; index += 100) {
      const batchIds = uniqueIds.slice(index, index + 100)
      const { data: meetings, error } = await client.from('room_meetings').select('id')
        .eq('room_id', roomId).eq('source_type', 'lightning').in('id', batchIds)
      if (error) throw error
      const allowedIds = meetings.map(meeting => meeting.id)
      allowedIds.forEach(id => { participantsByMeeting[id] = [] })
      if (!allowedIds.length) continue
      for (let offset = 0; ; offset += 1000) {
        const { data: participants, error: participantError } = await client.from('meeting_participants')
          .select('id,meeting_id,actor:room_actor_identities!meeting_participants_actor_identity_id_fkey(auth_user_id)')
          .in('meeting_id', allowedIds).order('id').range(offset, offset + 999)
        if (participantError) throw participantError
        for (const participant of participants) {
          if (participant.actor?.auth_user_id) participantsByMeeting[participant.meeting_id].push(participant.actor.auth_user_id)
        }
        if (participants.length < 1000) break
      }
    }
    for (const id of Object.keys(participantsByMeeting)) participantsByMeeting[id] = [...new Set(participantsByMeeting[id])]
    return res.json({ participantsByMeeting })
  } catch (error) {
    console.error('만남 참여자 조회 오류:', error.message)
    return res.status(500).json({ message: '만남 참여자를 불러오지 못했습니다.' })
  }
})

module.exports = router
