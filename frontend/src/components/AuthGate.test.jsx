import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AuthGate from './AuthGate'
import { supabase } from '../lib/supabaseClient'

jest.mock('../lib/supabaseClient', () => ({ supabase: { auth: {
  getSession: jest.fn(), onAuthStateChange: jest.fn(),
} } }))
let onAuthChange
function Page() {
  return <div>{useLocation().pathname === '/' ? '로그인 선택' : '회원 화면'}</div>
}
function setup(path = '/rooms/57') {
  render(<MemoryRouter initialEntries={[path]}><AuthGate><Page /></AuthGate></MemoryRouter>)
}
beforeEach(() => {
  localStorage.clear()
  supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
  supabase.auth.onAuthStateChange.mockImplementation(callback => {
    onAuthChange = callback
    return { data: { subscription: { unsubscribe: jest.fn() } } }
  })
})
test('missing session redirects protected pages to login', async () => {
  setup()
  expect(await screen.findByText('로그인 선택')).toBeInTheDocument()
  expect(screen.queryByText('회원 화면')).not.toBeInTheDocument()
})
test('session restoration waits before rendering the protected screen', async () => {
  let resolve
  supabase.auth.getSession.mockReturnValue(new Promise(r => { resolve = r }))
  setup()
  expect(screen.getByRole('status')).toBeInTheDocument()
  await act(async () => resolve({ data: { session: { user: { id: 'member' } } }, error: null }))
  expect(screen.getByText('회원 화면')).toBeInTheDocument()
  act(() => onAuthChange('SIGNED_OUT', null))
  expect(await screen.findByText('로그인 선택')).toBeInTheDocument()
})
test('guest participation remains available without a member session', async () => {
  localStorage.setItem('guest_id', 'guest')
  setup()
  expect(await screen.findByText('회원 화면')).toBeInTheDocument()
})
test('initial stale session result cannot overwrite a signout event', async () => {
  let resolve
  supabase.auth.getSession.mockReturnValue(new Promise(r => { resolve = r }))
  setup()
  act(() => onAuthChange('SIGNED_OUT', null))
  await act(async () => resolve({ data: { session: { user: { id: 'member' } } }, error: null }))
  expect(screen.getByText('로그인 선택')).toBeInTheDocument()
})
test('auth lookup errors do not masquerade as signout', async () => {
  supabase.auth.getSession.mockRejectedValue(new Error('offline'))
  setup()
  expect(await screen.findByRole('alert')).toHaveTextContent('로그인 정보를 확인하지 못했습니다.')
  expect(screen.queryByText('로그인 선택')).not.toBeInTheDocument()
})
