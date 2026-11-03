const sharp = require('sharp')
const { Document, Paragraph, TextRun, ImageRun, ExternalHyperlink, HeadingLevel, Packer } = require('docx')

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function formatTimestamp(value) {
  const date = new Date(value)
  return value && !Number.isNaN(date.getTime())
    ? date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미정'
}

async function prepareBackupImage(buffer) {
  if (buffer.length >= 6 && buffer.readUInt32LE(0) === 0x00010000) {
    const { decodeIco } = await import('icojs')
    const icons = await decodeIco(buffer, 'image/png')
    const largest = icons.sort((a, b) => b.width * b.height - a.width * a.height)[0]
    if (!largest) throw new Error('ICO 사진을 변환하지 못했습니다.')
    buffer = Buffer.from(largest.buffer)
  }
  // Keep originals in Drive; use a bounded, correctly oriented image in the document.
  const { data, info } = await sharp(buffer).rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true })
  const scale = Math.min(480 / info.width, 640 / info.height, 1)
  return { data, width: Math.max(1, Math.round(info.width * scale)), height: Math.max(1, Math.round(info.height * scale)) }
}

async function renderBackupDocument(snapshot, images = new Map()) {
  const records = [...snapshot.diaries].sort((a, b) =>
    String(a.meeting?.meeting_date || '').localeCompare(String(b.meeting?.meeting_date || '')) ||
    String(a.id).localeCompare(String(b.id)))
  const photoCount = records.reduce((count, diary) => count + (diary.photos || []).length, 0)
  const paragraph = (text, options = {}) => new Paragraph({
    ...options,
    children: String(text).split(/\r\n|\r|\n/).map((line, index) => new TextRun({ text: line, ...(index ? { break: 1 } : {}) })),
  })
  const children = [
    paragraph(`방 ${snapshot.room_id} · 내 기록`, { heading: HeadingLevel.TITLE }),
    paragraph(`백업 시각: ${formatTimestamp(snapshot.exported_at)} (한국 시간)`),
    paragraph(`전체 기간 · 일기 ${records.length}개 · 사진 ${photoCount}장 (임시 저장 포함)`),
    paragraph('앱에서 작성한 내용으로 자동 갱신됩니다.'),
  ]
  if (!records.length) children.push(paragraph('아직 백업할 기록이 없습니다.'))
  for (const diary of records) {
    const meeting = diary.meeting || {}
    const photos = [...(diary.photos || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const date = meeting.meeting_date || '날짜 미정'
    const time = meeting.is_all_day ? '하루 종일' : [meeting.start_time, meeting.end_time].filter(Boolean).join(' ~ ')
    children.push(
      paragraph(`${date} · ${meeting.title || '만남 기록'}`, { heading: HeadingLevel.HEADING_1 }),
      paragraph(`만남: ${date} ${time}`),
      paragraph(`장소: ${meeting.location || '미정'}${meeting.location_address ? ` (${meeting.location_address})` : ''}`),
      paragraph(`상태: ${diary.status === 'published' ? '작성 완료' : '임시 저장'} · 공개 범위: ${diary.visibility === 'room' ? '방 멤버 공개' : '나만 보기'}`),
    )
    if (diary.mood_emoji) children.push(paragraph(`기분: ${diary.mood_emoji}`))
    children.push(paragraph(diary.body || '본문이 없는 사진 기록입니다.'))
    if (photos.length) children.push(paragraph(`사진 (${photos.length}장)`, { heading: HeadingLevel.HEADING_2 }))
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index]
      const image = images.get(String(photo.id))
      if (!image) throw new Error(`일기 사진을 문서에 포함하지 못했습니다: ${photo.id}`)
      children.push(
        paragraph(`사진 ${index + 1}${photo.is_cover ? ' (대표 사진)' : ''}`),
        new Paragraph({ children: [new ImageRun({ type: 'jpg', data: image.data,
          transformation: { width: image.width, height: image.height } })] }),
        new Paragraph({ children: [new ExternalHyperlink({
          link: `https://drive.google.com/file/d/${encodeURIComponent(photo.drive_file_id)}/view`,
          children: [new TextRun({ text: '원본 사진 보기', style: 'Hyperlink' })],
        })] }),
      )
    }
    children.push(paragraph(`마지막 수정: ${formatTimestamp(diary.updated_at)}`))
  }
  return Packer.toBuffer(new Document({
    title: `방 ${snapshot.room_id} - 내 기록`, creator: 'SYK',
    sections: [{ children }],
  }))
}

module.exports = { DOCX_MIME, prepareBackupImage, renderBackupDocument }
