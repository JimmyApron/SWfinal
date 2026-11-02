import { supabase } from '../lib/supabaseClient'
import { getApiBaseUrl } from './apiBaseUrl'

async function request(path, options = {}) {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) throw new Error('로그인이 필요합니다.')
  const response = await fetch(`${getApiBaseUrl()}/drive-backup${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || 'Drive 백업 요청에 실패했습니다.')
  return result
}

export const getRoomDriveBackup = (roomId) => request(`/rooms/${roomId}`)
export const connectRoomDriveBackup = (code) => request('/connection', {
  method: 'POST', body: JSON.stringify({ code }),
})
export const setRoomDriveBackup = (roomId, enabled) => request(`/rooms/${roomId}`, {
  method: 'PUT', body: JSON.stringify({ enabled }),
})
