const assert = require('node:assert/strict')
const { test } = require('node:test')
const db = {
  room_actor_identities: [{ id: 'me', room_id: 7, auth_user_id: 'user-1' }, { id: 'friend', room_id: 7, auth_user_id: 'user-2' }],
  room_meetings: [{ id: 'june', room_id: 7, meeting_date: '2026-06-01' }, { id: 'october', room_id: 7, meeting_date: '2026-10-01' }, { id: 'november', room_id: 7, meeting_date: '2026-11-01' }, { id: 'other-room', room_id: 8 }],
  meeting_diaries: [
    { id: 'd1', author_identity_id: 'me', meeting_id: 'june', status: 'published', visibility: 'room' },
    { id: 'd2', author_identity_id: 'me', meeting_id: 'october', status: 'draft', visibility: 'private' },
    { id: 'd3', author_identity_id: 'me', meeting_id: 'november', status: 'published', visibility: 'private' },
    { id: 'other-person', author_identity_id: 'friend', meeting_id: 'june', status: 'published' },
    { id: 'outside', author_identity_id: 'me', meeting_id: 'other-room' },
  ],
  diary_photos: [
    ...['d1', 'd2', 'd3'].flatMap((diary_id, i) => [0, 1].map(j => ({ id: `${i}-${j}`, diary_id, storage_path: `${i}/${j}.jpg`, sort_order: j }))),
    { id: 'friend-photo', diary_id: 'other-person', storage_path: 'private-friend.jpg' },
  ],
}
const client = { from(table) {
  const filters = []
  let start = 0, end = Infinity
  const query = {
    select: () => query, order: () => query,
    eq: (key, value) => { filters.push(row => row[key] === value); return query },
    in: (key, values) => { filters.push(row => values.includes(row[key])); return query },
    range: (from, to) => { start = from; end = to; return query },
    then: (resolve, reject) => Promise.resolve({ data: db[table].filter(row => filters.every(f => f(row))).slice(start, end + 1) }).then(resolve, reject),
  }
  return query
} }
const sdkPath = require.resolve('@supabase/supabase-js')
const sdk = require(sdkPath)
require.cache[sdkPath].exports = { createClient: () => client }
const { roomSnapshot } = require('./roomDriveBackup')
require.cache[sdkPath].exports = sdk
process.env.SUPABASE_URL = 'https://example.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'

test('backup collects every month, every photo and drafts within the member and room scope', async () => {
  const result = await roomSnapshot('user-1', 7)
  assert.deepEqual(result.diaries.map(d => d.meeting.meeting_date), ['2026-06-01', '2026-10-01', '2026-11-01'])
  assert.equal(result.diaries.length, 3)
  assert.equal(result.diaries.flatMap(d => d.photos).length, 6)
  assert.equal(result.diaries.find(d => d.id === 'd2').status, 'draft')
  assert.ok(result.diaries.every(d => d.photos.length === 2))
  assert.ok(!result.diaries.some(d => ['other-person', 'outside'].includes(d.id)))
})
