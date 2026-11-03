const assert = require('node:assert/strict')
const { test, before, after } = require('node:test')
const express = require('express')
const ownMeeting = '00000000-0000-4000-8000-000000000001'
const otherMeeting = '00000000-0000-4000-8000-000000000002'
let isMember = true
const db = {
  room_meetings: [{ id: ownMeeting, room_id: 7, source_type: 'lightning' }, { id: otherMeeting, room_id: 8, source_type: 'lightning' }],
  meeting_participants: [{ id: 'p-1', meeting_id: ownMeeting, actor: { auth_user_id: 'me' } }, { id: 'p-2', meeting_id: otherMeeting, actor: { auth_user_id: 'other-user' } }],
}
const client = {
  auth: { getUser: async (token) => ({ data: token === 'valid' ? { user: { id: 'me' } } : null }) },
  from(table) {
    if (table === 'room_members') return { select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: isMember ? { id: 1 } : null }) }
    const filters = []
    const query = {
      select: () => query, order: () => query, range: () => query,
      eq: (key, value) => { filters.push(row => row[key] === value); return query },
      in: (key, values) => { filters.push(row => values.includes(row[key])); return query },
      then: (resolve, reject) => Promise.resolve({ data: db[table].filter(row => filters.every(filter => filter(row))) }).then(resolve, reject),
    }
    return query
  },
}
const sdkPath = require.resolve('@supabase/supabase-js')
const sdk = require(sdkPath)
require.cache[sdkPath].exports = { createClient: () => client }
const router = require('./meetingParticipants')
require.cache[sdkPath].exports = sdk
process.env.SUPABASE_URL = 'https://example.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
let server, base
before(async () => {
  const app = express()
  app.use(express.json()); app.use(router)
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => new Promise(resolve => server.close(resolve)))
function request(token = 'valid', meetingIds = [ownMeeting]) {
  return fetch(`${base}/rooms/7/participants`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify({ meetingIds }) })
}
test('solo meeting returns only its saved creator, excluding meetings in other rooms', async () => {
  const response = await request('valid', [ownMeeting, otherMeeting])
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { participantsByMeeting: { [ownMeeting]: ['me'] } })
})
test('missing or invalid session is rejected', async () => {
  assert.equal((await request(null)).status, 401)
  assert.equal((await request('invalid')).status, 401)
})
test('a user outside the room cannot read its participants', async () => {
  isMember = false
  try { assert.equal((await request()).status, 403) } finally { isMember = true }
})
test('malformed meeting filters are rejected', async () => {
  assert.equal((await request('valid', ['not-a-uuid'])).status, 400)
})
