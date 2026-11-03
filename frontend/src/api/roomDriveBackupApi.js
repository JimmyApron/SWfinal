import { supabase } from '../lib/supabaseClient'
import { getApiBaseUrl } from './apiBaseUrl'
import { readApiJson } from './apiResponse'

async function request(path, options = {}) {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) throw new Error('로그인이 필요합니다.')
  const response = await fetch(`${getApiBaseUrl()}/drive-backup${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  return readApiJson(response, 'Drive 백업 요청에 실패했습니다.')
}

export const getRoomDriveBackup = (roomId) => request(`/rooms/${roomId}`)
export const connectRoomDriveBackup = (code) => request('/connection', {
  method: 'POST', body: JSON.stringify({ code }),
})
export const setRoomDriveBackup = (roomId, enabled) => request(`/rooms/${roomId}`, {
  method: 'PUT', body: JSON.stringify({ enabled }),
})
