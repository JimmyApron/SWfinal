import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useGoogleLogin } from '@react-oauth/google'
import RoomDriveBackupControl from './RoomDriveBackupControl'
import { connectRoomDriveBackup, getRoomDriveBackup, setRoomDriveBackup } from '../../api/roomDriveBackupApi'

jest.mock('@react-oauth/google', () => ({ useGoogleLogin: jest.fn() }))
jest.mock('../../api/roomDriveBackupApi', () => ({
  connectRoomDriveBackup: jest.fn(),
  getRoomDriveBackup: jest.fn(),
  setRoomDriveBackup: jest.fn(),
}))

test('first ON connects once; later room toggle changes reuse the connection', async () => {
  jest.clearAllMocks()
  const login = jest.fn(() => useGoogleLogin.mock.calls.at(-1)[0].onSuccess({ code: 'oauth-code' }))
  useGoogleLogin.mockImplementation(() => login)
  getRoomDriveBackup.mockResolvedValue({ connected: false, enabled: false, lastSyncedAt: null })
  connectRoomDriveBackup.mockResolvedValue({ connected: true })
  setRoomDriveBackup.mockImplementation(async (_roomId, enabled) => ({ enabled }))

  render(<RoomDriveBackupControl roomId={7} />)
  const toggle = await screen.findByRole('switch', { name: '내 기록 Google Drive 백업' })
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  await waitFor(() => expect(connectRoomDriveBackup).toHaveBeenCalledWith('oauth-code'))
  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))

  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
  expect(login).toHaveBeenCalledTimes(1)
  expect(setRoomDriveBackup.mock.calls).toEqual([[7, true], [7, false], [7, true]])
})

test('shows a disabled switch while room membership is unavailable', () => {
  jest.clearAllMocks()
  useGoogleLogin.mockImplementation(() => jest.fn())
  render(<RoomDriveBackupControl roomId={7} canBackup={false} />)
  expect(screen.getByRole('switch', { name: '내 기록 Google Drive 백업' })).toBeDisabled()
  expect(screen.getByText('이 방의 회원으로 로그인하면 사용할 수 있어요.')).toBeInTheDocument()
  expect(getRoomDriveBackup).not.toHaveBeenCalled()
})

test('existing hidden-folder connection asks for new My Drive permission', async () => {
  jest.clearAllMocks()
  const login = jest.fn(() => useGoogleLogin.mock.calls.at(-1)[0].onSuccess({ code: 'new-scope-code' }))
  useGoogleLogin.mockImplementation(() => login)
  getRoomDriveBackup.mockResolvedValue({ connected: false, enabled: true, error: '내 드라이브 백업을 위해 Google을 다시 연결해 주세요.' })
  connectRoomDriveBackup.mockResolvedValue({ connected: true })
  setRoomDriveBackup.mockResolvedValue({ enabled: true })

  render(<RoomDriveBackupControl roomId={7} />)
  const reconnect = await screen.findByRole('button', { name: 'Google 다시 연결' })
  expect(useGoogleLogin.mock.calls.at(-1)[0].scope).toBe('https://www.googleapis.com/auth/drive.file')
  fireEvent.click(reconnect)
  await waitFor(() => expect(connectRoomDriveBackup).toHaveBeenCalledWith('new-scope-code'))
  await waitFor(() => expect(setRoomDriveBackup).toHaveBeenCalledWith(7, true))
})

test('manual backup syncs the entire room again without changing the selected month or reconnecting', async () => {
  jest.clearAllMocks()
  const login = jest.fn()
  useGoogleLogin.mockImplementation(() => login)
  getRoomDriveBackup.mockResolvedValue({ connected: true, enabled: true, syncing: false, lastSyncedAt: '2026-11-03T00:00:00Z' })
  setRoomDriveBackup.mockResolvedValue({ enabled: true })
  render(<RoomDriveBackupControl roomId={7} />)
  const button = await screen.findByRole('button', { name: '지금 전체 백업' })
  fireEvent.click(button)
  await waitFor(() => expect(setRoomDriveBackup).toHaveBeenCalledWith(7, true))
  expect(login).not.toHaveBeenCalled()
  expect(connectRoomDriveBackup).not.toHaveBeenCalled()
  expect(await screen.findByText('백업 중...')).toBeInTheDocument()
  expect(screen.getByText(/선택한 달과 관계없이/)).toBeInTheDocument()
})
