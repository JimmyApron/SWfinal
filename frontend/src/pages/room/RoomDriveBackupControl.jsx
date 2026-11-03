import { useEffect, useRef, useState } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import { connectRoomDriveBackup, getRoomDriveBackup, setRoomDriveBackup } from '../../api/roomDriveBackupApi'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export default function RoomDriveBackupControl({ roomId, canBackup = true, checkingMembership = false, compact = false }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const refreshTimerRef = useRef(null)

  useEffect(() => {
    let active = true
    setStatus(null)
    setMessage('')
    if (!canBackup) return () => { active = false; window.clearTimeout(refreshTimerRef.current) }
    getRoomDriveBackup(roomId)
      .then((result) => { if (active) setStatus(result) })
      .catch((error) => { if (active) setMessage(error.message) })
    return () => { active = false; window.clearTimeout(refreshTimerRef.current) }
  }, [roomId, canBackup])

  useEffect(() => {
    if (!canBackup || !status?.enabled) return undefined
    const timer = window.setInterval(() => {
      getRoomDriveBackup(roomId).then(setStatus).catch((error) => setMessage(error.message))
    }, 30000)
    return () => window.clearInterval(timer)
  }, [roomId, canBackup, status?.enabled])

  async function enableBackup() {
    await setRoomDriveBackup(roomId, true)
    setStatus((current) => ({ ...current, connected: true, enabled: true, syncing: true, error: null }))
    refreshTimerRef.current = window.setTimeout(() => {
      getRoomDriveBackup(roomId).then(setStatus).catch((error) => setMessage(error.message))
    }, 3000)
  }

  const googleLogin = useGoogleLogin({
    flow: 'auth-code',
    scope: DRIVE_SCOPE,
    overrideScope: true,
    include_granted_scopes: false,
    prompt: 'consent',
    onSuccess: async ({ code }) => {
      try {
        await connectRoomDriveBackup(code)
        await enableBackup()
        setMessage('')
      } catch (error) {
        setMessage(error.message)
      } finally {
        setBusy(false)
      }
    },
    onError: () => { setBusy(false); setMessage('Google 연결을 완료하지 못했습니다.') },
    onNonOAuthError: () => { setBusy(false); setMessage('Google 연결 창을 열지 못했습니다.') },
  })

  async function toggle() {
    if (busy || !status || !canBackup) return
    setBusy(true)
    setMessage('')
    if (!status.enabled && !status.connected) {
      googleLogin()
      return
    }
    try {
      if (status.enabled) {
        await setRoomDriveBackup(roomId, false)
        setStatus((current) => ({ ...current, enabled: false, syncing: false, error: null }))
      } else {
        await enableBackup()
      }
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  function reconnect() {
    if (busy) return
    setBusy(true)
    setMessage('')
    googleLogin()
  }

  async function syncNow() {
    if (busy || status?.syncing || !canBackup) return
    setBusy(true)
    setMessage('')
    try { await enableBackup() }
    catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }

  const card = <div className="room-drive-backup">
    <div className="room-drive-backup-main">
      <div><strong>내 기록 Google Drive 백업</strong><span>선택한 달과 관계없이 이 방의 내 일기 전체(임시 저장 포함)를 백업합니다. 방별 폴더에 Google Docs 문서를 만들고 사진도 본문에 넣으며, 사진 원본도 함께 저장합니다. 문서는 앱 기록으로 자동 갱신됩니다.</span></div>
      <button type="button" role="switch" aria-label="내 기록 Google Drive 백업" aria-checked={Boolean(status?.enabled)}
        disabled={busy || !status || !canBackup} onClick={toggle} className={`room-drive-backup-switch ${status?.enabled ? 'on' : ''}`}>
        <span />
      </button>
    </div>
    {!canBackup && <small role="status">{checkingMembership ? '방 회원 확인 중...' : '이 방의 회원으로 로그인하면 사용할 수 있어요.'}</small>}
    {status?.enabled && <small role="status">{status.error || (status.syncing ? '백업 중...' : status.lastSyncedAt
      ? `마지막 백업: ${new Date(status.lastSyncedAt).toLocaleString('ko-KR')}` : '첫 백업 대기 중...')}</small>}
    {status?.enabled && status?.connected && <button type="button" className="room-drive-backup-reconnect" disabled={busy || status.syncing || !canBackup} onClick={syncNow}>지금 전체 백업</button>}
    {((status?.error && status?.connected) || (status?.enabled && !status?.connected)) && <button type="button" className="room-drive-backup-reconnect" disabled={busy} onClick={reconnect}>Google 다시 연결</button>}
    {message && <small className="room-drive-backup-error" role="alert">{message}</small>}
  </div>
  if (!compact) return card
  return <div className="room-tool">
    <button type="button" className={`room-tool-button ${status?.enabled ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      백업{status?.enabled ? ' ON' : ''}{status?.error ? ' ⚠' : ''}
    </button>
    {open && <>
      <div className="room-tool-backdrop" onClick={() => setOpen(false)} />
      <div className="room-tool-popover" role="dialog" aria-label="내 기록 Google Drive 백업">{card}</div>
    </>}
  </div>
}
