const crypto = require('crypto')
const { DOCX_MIME, prepareBackupImage, renderBackupDocument } = require('./backupDocument')

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DOC_MIME = 'application/vnd.google-apps.document'
const FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

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

function queryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function listFiles(token, query) {
  const files = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({
      spaces: 'drive', q: `${query} and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,parents,appProperties)', pageSize: '1000',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await driveRequest(token, `${FILES_URL}?${params}`)
    files.push(...(page.files || []))
    pageToken = page.nextPageToken || ''
  } while (pageToken)
  return files
}

async function getBackupRoot(token) {
  const folders = await listFiles(token,
    `mimeType = '${FOLDER_MIME}' and appProperties has { key='sykBackupRoot' and value='1' }`)
  if (folders.length) {
    const folder = folders[0]
    if (folder.name !== '기록 백업') return folder
    return driveRequest(token, `${FILES_URL}/${encodeURIComponent(folder.id)}?fields=id,name`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'MeetUP 기록 백업' }),
    })
  }
  return driveRequest(token, `${FILES_URL}?fields=id,name`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'MeetUP 기록 백업', mimeType: FOLDER_MIME,
      parents: ['root'], appProperties: { sykBackupRoot: '1' },
    }),
  })
}

async function getBackupFolder(token, roomId, userId, rootId) {
  // Private app metadata keeps the folder identifiable even after a user renames it.
  const key = `${roomId}:${userId}`
  const folders = await listFiles(token,
    `mimeType = '${FOLDER_MIME}' and appProperties has { key='sykBackup' and value='${queryValue(key)}' }`)
  if (folders.length) {
    const folder = folders[0]
    const oldDefaultName = `SYK 기록 백업 - 방 ${roomId}`
    const needsMove = !folder.parents?.includes(rootId)
    const needsRename = folder.name === oldDefaultName
    if (needsMove || needsRename) {
      const params = new URLSearchParams({ fields: 'id,name,parents' })
      if (needsMove) {
        params.set('addParents', rootId)
        if (folder.parents?.length) params.set('removeParents', folder.parents.join(','))
      }
      return driveRequest(token, `${FILES_URL}/${encodeURIComponent(folder.id)}?${params}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(needsRename ? { name: `방 ${roomId}` } : {}),
      })
    }
    return folder
  }
  return driveRequest(token, `${FILES_URL}?fields=id,name`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `방 ${roomId}`, mimeType: FOLDER_MIME,
      parents: [rootId], appProperties: { sykBackup: key },
    }),
  })
}

async function uploadDriveFile(token, metadata, content, sourceMimeType, fileId) {
  const targetUrl = `${UPLOAD_URL}${fileId ? `/${encodeURIComponent(fileId)}` : ''}`
  if (content.length > 5 * 1024 * 1024) {
    const start = await fetch(`${targetUrl}?uploadType=resumable&fields=id,name`, {
      method: fileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': sourceMimeType, 'X-Upload-Content-Length': String(content.length),
      },
      body: JSON.stringify(metadata),
    })
    const location = start.headers.get('location')
    if (!start.ok || !location) throw new Error(`Google Drive 업로드 시작 실패: ${start.status}`)
    return driveRequest(token, location, {
      method: 'PUT', headers: { 'Content-Type': sourceMimeType, 'Content-Length': String(content.length) },
      body: content,
    })
  }
  if (fileId) return driveRequest(token, `${targetUrl}?uploadType=media&fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': sourceMimeType }, body: content,
  })
  const boundary = `backup_${crypto.randomUUID()}`
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(JSON.stringify(metadata)),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${sourceMimeType}\r\n\r\n`), content,
    Buffer.from(`\r\n--${boundary}--`),
  ])
  return driveRequest(token, `${UPLOAD_URL}?uploadType=multipart&fields=id,name`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  })
}

async function syncBackupFiles({ token, userId, snapshot, downloadPhoto, isEnabled }) {
  if (!(await isEnabled())) return
  const root = await getBackupRoot(token)
  const folder = await getBackupFolder(token, snapshot.room_id, userId, root.id)
  const files = await listFiles(token, `'${queryValue(folder.id)}' in parents`)
  const byName = new Map(files.map((file) => [file.name, file]))
  const prefix = `syk-room-${snapshot.room_id}-member-${userId}-photo-`
  const activePhotoNames = new Set()
  const images = new Map()
  for (const diary of snapshot.diaries) {
    for (const photo of diary.photos) {
      if (!(await isEnabled())) return
      const name = `${prefix}${photo.id}`
      activePhotoNames.add(name)
      const blob = await downloadPhoto(photo.storage_path)
      const original = Buffer.from(await blob.arrayBuffer())
      images.set(String(photo.id), await prepareBackupImage(original))
      let file = byName.get(name)
      if (!file) {
        const mimeType = blob.type || 'application/octet-stream'
        file = await uploadDriveFile(token, { name, mimeType, parents: [folder.id] }, original, mimeType)
        byName.set(name, file)
      }
      photo.drive_file_id = file.id
    }
  }
  if (!(await isEnabled())) return
  const content = await renderBackupDocument(snapshot, images)
  const existing = files.find((file) => file.mimeType === DOC_MIME && file.appProperties?.sykBackupDocument === '1')
  if (existing) {
    await uploadDriveFile(token, { mimeType: DOC_MIME }, content, DOCX_MIME, existing.id)
  } else {
    await uploadDriveFile(token, {
      name: `방 ${snapshot.room_id} - 내 기록`, mimeType: DOC_MIME, parents: [folder.id],
      appProperties: { sykBackupDocument: '1' },
    }, content, DOCX_MIME)
  }
  // Clean up only this backup's photos, after the new document is safely written.
  for (const file of files) {
    if (!(await isEnabled())) return
    if (file.name.startsWith(prefix) && !activePhotoNames.has(file.name)) {
      await driveRequest(token, `${FILES_URL}/${encodeURIComponent(file.id)}`, { method: 'DELETE' })
    }
  }
}

module.exports = { syncBackupFiles, renderBackupDocument, uploadDriveFile }
