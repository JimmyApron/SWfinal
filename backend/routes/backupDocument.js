const sharp = require('sharp')
const {
  Document, Paragraph, TextRun, ImageRun, ExternalHyperlink, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableCell, TableRow, WidthType, Packer,
} = require('docx')

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const FONT = 'Malgun Gothic'
const COLORS = { ink: '252534', muted: '747487', accent: '7168C9', line: 'E7E5F0' }

function textRuns(value, options = {}) {
  return String(value).split(/\r\n|\r|\n/).map((line, index) => new TextRun({
    text: line, font: FONT, color: COLORS.ink, ...options, ...(index ? { break: 1 } : {}),
  }))
}

function textParagraph(value, { run = {}, ...options } = {}) {
  return new Paragraph({ children: textRuns(value, run), ...options })
}

function photoCell(photo, index, image) {
  if (!image) throw new Error(`일기 사진을 문서에 포함하지 못했습니다: ${photo.id}`)
  const scale = Math.min(215 / image.width, 190 / image.height, 1)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  return new TableCell({
    width: { size: 4500, type: WidthType.DXA },
    margins: { top: 100, bottom: 150, left: 0, right: 180 },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
        children: [new ImageRun({ type: 'jpg', data: image.data,
          transformation: { width, height }, altText: { title: `사진 ${index + 1}` } })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: `사진 ${index + 1}${photo.is_cover ? ' · 대표 사진' : ''}  `,
          font: FONT, size: 17, color: COLORS.muted }),
        new ExternalHyperlink({
          link: `https://drive.google.com/file/d/${encodeURIComponent(photo.drive_file_id)}/view`,
          children: [new TextRun({ text: '원본 사진 보기', font: FONT, size: 17, color: COLORS.accent,
            underline: {} })],
        }),
      ] }),
    ],
  })
}

function photoGallery(photos, images) {
  const rows = []
  for (let index = 0; index < photos.length; index += 2) {
    const pair = photos.slice(index, index + 2)
    rows.push(new TableRow({ cantSplit: true, children: pair.map((photo, offset) =>
      photoCell(photo, index + offset, images.get(String(photo.id))))
      .concat(pair.length === 1 ? [new TableCell({ children: [new Paragraph('')],
        width: { size: 4500, type: WidthType.DXA } })] : []) }))
  }
  return new Table({ rows, columnWidths: [4500, 4500],
    width: { size: 9000, type: WidthType.DXA },
    borders: Object.fromEntries(['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical']
      .map((side) => [side, { style: BorderStyle.NONE }])) })
}

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
  const children = [
    textParagraph(`방 ${snapshot.room_id} 내 기록`, { heading: HeadingLevel.TITLE,
      run: { bold: true, size: 34, color: COLORS.ink }, spacing: { after: 120 } }),
    textParagraph(`전체 기간 · 일기 ${records.length}개 · 사진 ${photoCount}장 (임시 저장 포함)`, {
      run: { size: 20, color: COLORS.accent }, spacing: { after: 80 },
    }),
    textParagraph(`백업 시각: ${formatTimestamp(snapshot.exported_at)} (한국 시간) · 앱 기록으로 자동 갱신`, {
      run: { size: 17, color: COLORS.muted }, spacing: { after: 310 },
    }),
  ]
  if (!records.length) children.push(textParagraph('아직 백업할 기록이 없습니다.', {
    run: { size: 22 }, spacing: { before: 200 },
  }))
  for (const [recordIndex, diary] of records.entries()) {
    const meeting = diary.meeting || {}
    const photos = [...(diary.photos || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const date = meeting.meeting_date || '날짜 미정'
    const time = meeting.is_all_day ? '하루 종일' : [meeting.start_time, meeting.end_time].filter(Boolean).join(' ~ ')
    const place = meeting.location
      ? `${meeting.location}${meeting.location_address ? ` (${meeting.location_address})` : ''}` : '미정'
    children.push(
      textParagraph(date, { run: { bold: true, size: 19, color: COLORS.accent },
        spacing: { before: recordIndex ? 440 : 80, after: 70 }, keepNext: true,
        ...(recordIndex ? { border: { top: { color: COLORS.line, size: 7, space: 18,
          style: BorderStyle.SINGLE } } } : {}),
      }),
      textParagraph(`${meeting.title || '만남 기록'}${diary.mood_emoji ? `  ${diary.mood_emoji}` : ''}`, {
        heading: HeadingLevel.HEADING_1, run: { bold: true, size: 28, color: COLORS.ink },
        spacing: { before: 0, after: 90 }, keepNext: true,
      }),
      textParagraph(`만남  ${time || '시간 미정'}    ·    장소  ${place}`, {
        run: { size: 18, color: COLORS.muted }, spacing: { after: 220 }, keepNext: true,
      }),
    )
    if (photos.length) {
      children.push(
        textParagraph(`사진 ${photos.length}장`, { run: { bold: true, size: 18, color: COLORS.ink },
          spacing: { after: 80 }, keepNext: true }),
        photoGallery(photos, images),
      )
    }
    children.push(textParagraph(diary.body || '본문이 없는 사진 기록입니다.', {
      run: { size: 22 }, spacing: { before: photos.length ? 200 : 0, after: 240, line: 340 },
    }))
    children.push(textParagraph(
      `${diary.status === 'published' ? '작성 완료' : '임시 저장'} · ${diary.visibility === 'room' ? '방 멤버 공개' : '나만 보기'} · 마지막 수정: ${formatTimestamp(diary.updated_at)}`, {
        run: { size: 17, color: COLORS.muted }, spacing: { after: 80 },
      }))
  }
  return Packer.toBuffer(new Document({
    title: `방 ${snapshot.room_id} - 내 기록`, creator: 'SYK',
    styles: { default: { document: { run: { font: FONT, size: 21, color: COLORS.ink } } } },
    sections: [{ properties: { page: { margin: { top: 950, right: 1000, bottom: 950, left: 1000 } } }, children }],
  }))
}

module.exports = { DOCX_MIME, prepareBackupImage, renderBackupDocument }
