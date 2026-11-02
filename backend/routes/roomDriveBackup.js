const crypto = require('crypto')
const express = require('express')
const { createClient } = require('@supabase/supabase-js')

const router = express.Router()
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const PHOTO_BUCKET = 'meetup-diary-photos'
const syncing = new Set()
let admin

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function getAdmin() {
  if (admin) return admin
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(503, '백업 서버의 Supabase 설정이 필요합니다.')
  }
  admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return admin
}

function encryptionKey() {
  const value = process.env.GOOGLE_DRIVE_TOKEN_KEY || ''
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new HttpError(503, '백업 서버의 토큰 암호화 키 설정이 필요합니다.')
  }
  return Buffer.from(value, 'hex')
}

function encrypt(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

function decrypt(value) {
  const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function requiredGoogleConfig() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(503, '백업 서버의 Google OAuth 설정이 필요합니다.')
  }
  encryptionKey()
}

async function authenticatedUser(req) {
  const bearer = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]
  if (!bearer) throw new HttpError(401, '로그인이 필요합니다.')
  const { data, error } = await getAdmin().auth.getUser(bearer)
  if (error || !data?.user) throw new HttpError(401, '로그인을 다시 해 주세요.')
  return data.user
}

function roomIdFromRequest(req) {
  const roomId = Number(req.params.roomId)
  if (!Number.isSafeInteger(roomId) || roomId < 1) throw new HttpError(400, '방 번호가 올바르지 않습니다.')
  return roomId
}

async function isMember(userId, roomId) {
  const { data, error } = await getAdmin().from('room_members').select('id')
    .eq('userid', userId).eq('roomid', roomId).maybeSingle()
  if (error) throw error
  return Boolean(data)
}

async function requireMember(req) {
  const user = await authenticatedUser(req)
  const roomId = roomIdFromRequest(req)
  if (!(await isMember(user.id, roomId))) throw new HttpError(403, '이 방의 회원만 백업할 수 있습니다.')
  return { userId: user.id, roomId }
}

function handle(fn) {
  return async (req, res) => {
    try { await fn(req, res) }
    catch (error) {
      if (!(error instanceof HttpError)) console.error('[Drive 백업]', error)
      res.status(error.status || 500).json({ message: error instanceof HttpError ? error.message : 'Drive 백업을 처리하지 못했습니다.' })
    }
  }
}

async function tokenRequest(params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const data = await response.json()
  if (!response.ok) throw new HttpError(400, data.error === 'invalid_grant'
    ? 'Google 연결이 만료되었습니다. 다시 연결해 주세요.'
    : `Google 인증 실패: ${data.error || response.status}`)
  return data
}

async function accessToken(userId) {
  const { data: connection, error } = await getAdmin().from('google_drive_connections')
    .select('encrypted_refresh_token').eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!connection) throw new HttpError(409, 'Google Drive를 먼저 연결해 주세요.')
  const token = await tokenRequest({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: decrypt(connection.encrypted_refresh_token),
    grant_type: 'refresh_token',
  })
  if (!token.access_token) throw new Error('Google access token missing')
  if (token.refresh_token) {
    const { error: updateError } = await getAdmin().from('google_drive_connections')
      .update({ encrypted_refresh_token: encrypt(token.refresh_token) }).eq('user_id', userId)
    if (updateError) throw updateError
  }
  return token.access_token
}

async function driveRequest(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Google Drive ${response.status}: ${body.slice(0, 300)}`)
  }
  return response.status === 204 ? null : response.json()
}

async function listBackupFiles(token, prefix) {
  const files = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name contains '${prefix}' and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType)',
      pageSize: '1000',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await driveRequest(token, `https://www.googleapis.com/drive/v3/files?${params}`)
    files.push(...(page.files || []).filter((file) => file.name.startsWith(prefix)))
    pageToken = page.nextPageToken || ''
  } while (pageToken)
  return files
}

async function createDriveFile(token, name, content, mimeType) {
  if (content.length > 5 * 1024 * 1024) {
    const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(content.length),
      },
      body: JSON.stringify({ name, parents: ['appDataFolder'], mimeType }),
    })
    const location = start.headers.get('location')
    if (!start.ok || !location) throw new Error(`Google Drive 업로드 시작 실패: ${start.status}`)
    return driveRequest(token, location, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType, 'Content-Length': String(content.length) },
      body: content,
    })
  }
  const boundary = `backup_${crypto.randomUUID()}`
  const metadata = Buffer.from(JSON.stringify({ name, parents: ['appDataFolder'], mimeType }))
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--`),
  ])
  return driveRequest(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
}

async function replaceDriveFile(token, fileId, content, mimeType) {
  return driveRequest(token, `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': mimeType }, body: content,
  })
}

async function allRows(query) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query.range(from, from + 999)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 1000) return rows
  }
}

async function roomSnapshot(userId, roomId) {
  const client = getAdmin()
  const identities = await allRows(client.from('room_actor_identities').select('id')
    .eq('room_id', roomId).eq('auth_user_id', userId).order('id'))
  const identityIds = identities.map((row) => row.id)
  const meetings = await allRows(client.from('room_meetings')
    .select('id,source_type,title,meeting_date,start_time,end_time,is_all_day,location,location_address,lifecycle_status,attendance_status')
    .eq('room_id', roomId).order('id'))
  const meetingById = new Map(meetings.map((meeting) => [meeting.id, meeting]))
  const diaries = identityIds.length ? await allRows(client.from('meeting_diaries')
    .select('id,meeting_id,status,visibility,mood_emoji,body,version,published_at,updated_at')
    .in('author_identity_id', identityIds).order('id')) : []
  const ownDiaries = diaries.filter((diary) => meetingById.has(diary.meeting_id))
  const photos = []
  for (let index = 0; index < ownDiaries.length; index += 100) {
    const ids = ownDiaries.slice(index, index + 100).map((diary) => diary.id)
    const batch = await allRows(client.from('diary_photos')
      .select('id,diary_id,storage_path,sort_order,is_cover')
      .in('diary_id', ids).order('id'))
    photos.push(...batch)
  }
  return {
    schema_version: 1,
    room_id: roomId,
    exported_at: new Date().toISOString(),
    diaries: ownDiaries.map((diary) => ({
      ...diary, meeting: meetingById.get(diary.meeting_id),
      photos: photos.filter((photo) => photo.diary_id === diary.id).map((photo) => ({ ...photo })),
    })),
  }
}

async function performBackup(userId, roomId) {
  if (!(await isMember(userId, roomId))) {
    await getAdmin().from('room_google_drive_backups').update({ enabled: false, last_error: '방 회원이 아니어서 백업이 중지되었습니다.' })
      .eq('user_id', userId).eq('room_id', roomId)
    return
  }
  const token = await accessToken(userId)
  const snapshot = await roomSnapshot(userId, roomId)
  if (!(await isBackupEnabled(userId, roomId))) return
  const prefix = `syk-room-${roomId}-member-${userId}-`
  const files = await listBackupFiles(token, prefix)
  const byName = new Map(files.map((file) => [file.name, file]))
  const activePhotoNames = new Set()

  for (const diary of snapshot.diaries) {
    for (const photo of diary.photos) {
      const name = `${prefix}photo-${photo.id}`
      activePhotoNames.add(name)
      let file = byName.get(name)
      if (!file) {
        const { data: blob, error } = await getAdmin().storage.from(PHOTO_BUCKET).download(photo.storage_path)
        if (error) throw error
        const mimeType = blob.type || 'application/octet-stream'
        file = await createDriveFile(token, name, Buffer.from(await blob.arrayBuffer()), mimeType)
        byName.set(name, file)
      }
      photo.drive_file_id = file.id
      delete photo.storage_path
    }
  }

  const manifestName = `${prefix}backup.json`
  if (!(await isBackupEnabled(userId, roomId))) return
  const manifest = Buffer.from(JSON.stringify(snapshot, null, 2))
  const oldManifest = byName.get(manifestName)
  if (oldManifest) await replaceDriveFile(token, oldManifest.id, manifest, 'application/json')
  else await createDriveFile(token, manifestName, manifest, 'application/json')

  for (const file of files) {
    if (file.name.startsWith(`${prefix}photo-`) && !activePhotoNames.has(file.name)) {
      await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' })
    }
  }
}

async function isBackupEnabled(userId, roomId) {
  const { data, error } = await getAdmin().from('room_google_drive_backups')
    .select('enabled').eq('user_id', userId).eq('room_id', roomId).maybeSingle()
  if (error) throw error
  return Boolean(data?.enabled)
}

async function syncBackup(userId, roomId) {
  const key = `${userId}:${roomId}`
  if (syncing.has(key)) return
  syncing.add(key)
  try {
    if (!(await isBackupEnabled(userId, roomId))) return
    await performBackup(userId, roomId)
    const { error: updateError } = await getAdmin().from('room_google_drive_backups')
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq('user_id', userId).eq('room_id', roomId).eq('enabled', true)
    if (updateError) throw updateError
  } catch (error) {
    console.error(`[Drive 백업] ${key}`, error)
    await getAdmin().from('room_google_drive_backups')
      .update({ last_error: String(error.message || error).slice(0, 500) })
      .eq('user_id', userId).eq('room_id', roomId)
  } finally {
    syncing.delete(key)
  }
}

router.get('/rooms/:roomId', handle(async (req, res) => {
  const { userId, roomId } = await requireMember(req)
  const [connection, preference] = await Promise.all([
    getAdmin().from('google_drive_connections').select('user_id').eq('user_id', userId).maybeSingle(),
    getAdmin().from('room_google_drive_backups').select('enabled,last_synced_at,last_error')
      .eq('user_id', userId).eq('room_id', roomId).maybeSingle(),
  ])
  if (connection.error) throw connection.error
  if (preference.error) throw preference.error
  res.json({ connected: Boolean(connection.data), enabled: Boolean(preference.data?.enabled),
    lastSyncedAt: preference.data?.last_synced_at || null, error: preference.data?.last_error || null,
    syncing: syncing.has(`${userId}:${roomId}`) })
}))

router.post('/connection', handle(async (req, res) => {
  const user = await authenticatedUser(req)
  requiredGoogleConfig()
  const origin = req.headers.origin
  const allowedOrigins = (process.env.GOOGLE_OAUTH_ALLOWED_ORIGINS || 'http://localhost:8080,https://meetup-syk15151.apps.dauai.org')
    .split(',').map((value) => value.trim())
  if (!origin || !allowedOrigins.includes(origin)) throw new HttpError(403, '허용되지 않은 연결 주소입니다.')
  if (typeof req.body?.code !== 'string' || !req.body.code) throw new HttpError(400, 'Google 인증 코드가 필요합니다.')
  const token = await tokenRequest({
    code: req.body.code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: origin,
    grant_type: 'authorization_code',
  })
  if (!token.scope?.split(' ').includes(DRIVE_SCOPE)) throw new HttpError(400, 'Drive 백업 권한을 허용해 주세요.')
  if (!token.refresh_token) throw new HttpError(400, '지속 연결 권한을 받지 못했습니다. Google 동의 화면에서 다시 허용해 주세요.')
  const { error } = await getAdmin().from('google_drive_connections').upsert({
    user_id: user.id,
    encrypted_refresh_token: encrypt(token.refresh_token),
    connected_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw error
  res.json({ connected: true })
}))

router.put('/rooms/:roomId', handle(async (req, res) => {
  const { userId, roomId } = await requireMember(req)
  if (typeof req.body?.enabled !== 'boolean') throw new HttpError(400, '백업 설정이 올바르지 않습니다.')
  if (req.body.enabled) {
    requiredGoogleConfig()
    const { data, error } = await getAdmin().from('google_drive_connections')
      .select('user_id').eq('user_id', userId).maybeSingle()
    if (error) throw error
    if (!data) throw new HttpError(409, 'Google Drive를 먼저 연결해 주세요.')
  }
  const { error } = await getAdmin().from('room_google_drive_backups').upsert({
    user_id: userId, room_id: roomId, enabled: req.body.enabled,
    last_error: null,
  }, { onConflict: 'user_id,room_id' })
  if (error) throw error
  if (req.body.enabled) setImmediate(() => { void syncBackup(userId, roomId) })
  res.json({ enabled: req.body.enabled })
}))

async function processEnabledBackups() {
  try {
    const rows = await allRows(getAdmin().from('room_google_drive_backups')
      .select('user_id,room_id').eq('enabled', true).order('room_id').order('user_id'))
    for (const row of rows) await syncBackup(row.user_id, row.room_id)
  } catch (error) {
    console.error('[Drive 백업] 예약 작업 실패', error)
  }
}

function startRoomDriveBackupJob() {
  setInterval(() => { void processEnabledBackups() }, 15 * 60 * 1000)
  setTimeout(() => { void processEnabledBackups() }, 30 * 1000)
}

module.exports = { router, startRoomDriveBackupJob, encrypt, decrypt, roomSnapshot }
