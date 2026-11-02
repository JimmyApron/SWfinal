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
