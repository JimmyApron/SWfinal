const assert = require('node:assert/strict')
const { test, afterEach } = require('node:test')
const { syncBackupFiles, renderBackupDocument, uploadDriveFile } = require('./driveBackupFiles')
const { DOCX_MIME, prepareBackupImage } = require('./backupDocument')
const sharp = require('sharp')
const JSZip = require('jszip')
const imageBytes = sharp({ create: { width: 40, height: 30, channels: 3, background: '#ff0000' } }).jpeg().toBuffer()

async function documentParts(buffer, multipart = false) {
  if (multipart) buffer = buffer.subarray(buffer.indexOf(Buffer.from('PK\x03\x04')), buffer.lastIndexOf(Buffer.from('\r\n--')))
  const zip = await JSZip.loadAsync(buffer)
  return { zip, xml: await zip.file('word/document.xml').async('string'), relationships: await zip.file('word/_rels/document.xml.rels').async('string') }
}

const originalFetch = global.fetch
afterEach(() => { global.fetch = originalFetch })
const folder = { id: 'folder-7', name: '사용자가 변경한 폴더 이름' }
const document = { id: 'doc-7', name: '변경한 문서 이름', mimeType: 'application/vnd.google-apps.document', appProperties: { sykBackupDocument: '1' } }
const photo = { id: 'photo-9', name: 'syk-room-7-member-member-1-photo-9', mimeType: 'image/jpeg' }

function snapshot() {
  return { room_id: 7, exported_at: '2026-11-03T01:00:00Z', diaries: [{
    id: 'diary-1', status: 'draft', visibility: 'private', mood_emoji: '😊',
    body: '첫 줄 <script>alert("hello")</script>\n둘째 줄 & 추억', updated_at: '2026-11-03T00:00:00Z',
    meeting: { title: '친구와 <산책>', meeting_date: '2026-11-02', location: '서울숲', start_time: '13:00', end_time: '14:00' },
    photos: [{ id: 9, storage_path: 'private/photo.jpg', sort_order: 0, is_cover: true }],
  }] }
}

function mockRequests(steps) {
  const calls = []
  global.fetch = async (url, options = {}) => {
    const step = steps.shift()
    assert.ok(step, `Unexpected request: ${url}`)
    calls.push({ url: String(url), ...options })
    await step.check?.(String(url), options)
    return new Response(step.status === 204 ? null : JSON.stringify(step.data ?? {}), {
      status: step.status || 200, headers: { 'Content-Type': 'application/json', ...step.headers },
    })
  }
  return { calls, done: () => assert.equal(steps.length, 0, 'All expected Drive requests were made') }
}

function options(overrides = {}) {
  return { token: 'test-token', userId: 'member-1', snapshot: snapshot(), isEnabled: async () => true,
    downloadPhoto: async () => new Blob([await imageBytes], { type: 'image/jpeg' }), ...overrides }
}

test('creates a private room folder and a native Google Doc with photos in that folder', async () => {
  const requests = mockRequests([
    { data: { files: [] }, check: (url) => {
      const q = new URL(url).searchParams.get('q')
      assert.ok(q.includes("value='7:member-1'"))
      assert.ok(q.includes('application/vnd.google-apps.folder'))
    } },
    { data: folder, check: (_, request) => {
      const metadata = JSON.parse(request.body)
      assert.equal(metadata.name, 'SYK 기록 백업 - 방 7')
      assert.deepEqual(metadata.parents, ['root'])
      assert.deepEqual(metadata.appProperties, { sykBackup: '7:member-1' })
    } },
    { data: { files: [] }, check: (url) => assert.ok(new URL(url).searchParams.get('q').includes("'folder-7' in parents")) },
    { data: photo, check: (_, request) => assert.ok(request.body.toString().includes('"parents":["folder-7"]')) },
    { data: document, check: async (_, request) => {
      const body = request.body.toString()
      assert.ok(body.includes('"mimeType":"application/vnd.google-apps.document"'))
      assert.ok(body.includes(`Content-Type: ${DOCX_MIME}`))
      const { xml, relationships } = await documentParts(request.body, true)
      assert.ok(xml.includes('첫 줄 &lt;script&gt;'))
      assert.ok(xml.includes('둘째 줄 &amp; 추억'))
      assert.ok(relationships.includes('https://drive.google.com/file/d/photo-9/view'))
      assert.equal((xml.match(/<w:drawing>/g) || []).length, 1)
      assert.ok(xml.includes('임시 저장'))
      assert.ok(xml.includes('나만 보기'))
      assert.ok(!xml.includes('private/photo.jpg'))
      assert.ok(!body.includes('backup.json'))
    } },
  ])
  await syncBackupFiles(options())
  requests.done()
  assert.ok(requests.calls.every((call) => call.headers.Authorization === 'Bearer test-token'))
})

test('reuses renamed folder and document, paginates photos, and updates the same Doc', async () => {
  const orphan = { id: 'old-photo', name: 'syk-room-7-member-member-1-photo-deleted' }
  const requests = mockRequests([
    { data: { files: [folder] } },
    { data: { files: [document], nextPageToken: 'page-2' } },
    { data: { files: [photo, orphan, { id: 'user-file', name: '나의 별도 문서' }] }, check: (url) => assert.equal(new URL(url).searchParams.get('pageToken'), 'page-2') },
    { data: document, check: async (url, request) => {
      assert.ok(url.includes('/doc-7?uploadType=media'))
      assert.equal(request.method, 'PATCH')
      assert.equal(request.headers['Content-Type'], DOCX_MIME)
      const { xml } = await documentParts(request.body)
      assert.ok(xml.includes('마지막 수정:'))
      assert.equal((xml.match(/<w:drawing>/g) || []).length, 1)
    } },
    { status: 204, check: (url, request) => {
      assert.ok(url.endsWith('/old-photo'))
      assert.equal(request.method, 'DELETE')
    } },
  ])
  await syncBackupFiles(options())
  requests.done()
})

test('does not delete any photo if document update fails', async () => {
  const requests = mockRequests([
    { data: { files: [folder] } },
    { data: { files: [document, photo, { id: 'old', name: 'syk-room-7-member-member-1-photo-old' }] } },
    { status: 500, data: { message: 'upload failed' } },
  ])
  await assert.rejects(syncBackupFiles(options()), /Google Drive 500/)
  requests.done()
  assert.ok(requests.calls.every((call) => call.method !== 'DELETE'))
})

test('disabled backup makes no Drive requests', async () => {
  const requests = mockRequests([])
  await syncBackupFiles(options({ isEnabled: async () => false }))
  requests.done()
})

test('stops before photo upload if backup is turned off during sync', async () => {
  let checks = 0
  const requests = mockRequests([{ data: { files: [folder] } }, { data: { files: [] } }])
  await syncBackupFiles(options({ isEnabled: async () => ++checks === 1 }))
  requests.done()
})

test('large photos use resumable uploads with folder metadata', async () => {
  const requests = mockRequests([
    { data: { files: [folder] } }, { data: { files: [document] } },
    { headers: { location: 'https://www.googleapis.com/upload/session' }, check: (url, request) => {
      assert.ok(url.includes('uploadType=resumable'))
      assert.deepEqual(JSON.parse(request.body).parents, ['folder-7'])
    } },
    { data: photo, check: (_, request) => assert.equal(request.method, 'PUT') },
    { data: document, check: (_, request) => assert.equal(request.method, 'PATCH') },
  ])
  await syncBackupFiles(options({ downloadPhoto: async () => new Blob([await imageBytes, Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/jpeg' }) }))
  requests.done()
})

test('document contains all months, drafts, line breaks and every image', async () => {
  const empty = await documentParts(await renderBackupDocument({ room_id: 7, diaries: [] }))
  assert.ok(empty.xml.includes('아직 백업할 기록이 없습니다.'))
  const data = snapshot()
  data.diaries.push({ ...data.diaries[0], id: 'older', meeting: { meeting_date: '2026-06-01' }, photos: [{ id: 10, drive_file_id: 'photo-10' }] })
  const prepared = await prepareBackupImage(await imageBytes)
  const { xml, zip } = await documentParts(await renderBackupDocument(data, new Map([['9', prepared], ['10', prepared]])))
  assert.ok(xml.includes('2026-06-01'))
  assert.ok(xml.includes('2026-11-02'))
  assert.ok(xml.includes('전체 기간 · 일기 2개 · 사진 2장'))
  assert.ok(xml.includes('임시 저장'))
  assert.ok(xml.includes('&lt;script&gt;alert(&quot;hello&quot;)&lt;/script&gt;'))
  assert.ok(xml.includes('<w:br/>'))
  assert.ok(!xml.includes('<script>'))
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 2)
  assert.ok(Object.keys(zip.files).some(name => name.startsWith('word/media/') && !zip.files[name].dir))
})

test('missing image bytes fail instead of silently omitting a photo', async () => {
  await assert.rejects(renderBackupDocument(snapshot()), /일기 사진을 문서에 포함하지 못했습니다/)
})

test('ICO images with bitmap frames are converted and included like other photos', async () => {
  const ico = Buffer.alloc(70)
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4)
  ico[6] = 1; ico[7] = 1
  ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(48, 14); ico.writeUInt32LE(22, 18)
  ico.writeUInt32LE(40, 22); ico.writeInt32LE(1, 26); ico.writeInt32LE(2, 30)
  ico.writeUInt16LE(1, 34); ico.writeUInt16LE(32, 36); ico.writeUInt32LE(8, 42)
  ico[64] = 255; ico[65] = 255
  const prepared = await prepareBackupImage(ico)
  assert.equal((await sharp(prepared.data).metadata()).format, 'jpeg')
  const { xml } = await documentParts(await renderBackupDocument(snapshot(), new Map([['9', prepared]])))
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 1)
})

test('large existing documents use resumable updates to the same Google Doc', async () => {
  const content = Buffer.alloc(5 * 1024 * 1024 + 1)
  const requests = mockRequests([
    { headers: { location: 'https://www.googleapis.com/upload/session' }, check: (url, request) => {
      assert.ok(url.includes('/doc-7?uploadType=resumable'))
      assert.equal(request.method, 'PATCH')
      assert.equal(request.headers['X-Upload-Content-Type'], DOCX_MIME)
    } },
    { data: document, check: (_, request) => { assert.equal(request.method, 'PUT'); assert.equal(request.body.length, content.length) } },
  ])
  await uploadDriveFile('test-token', { mimeType: document.mimeType }, content, DOCX_MIME, 'doc-7')
  requests.done()
})
