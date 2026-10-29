import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { supabase } from './lib/supabaseClient';
import { getFinalizedRoadmap } from './api/courseRoadmapApi';
jest.mock('./api/courseRoadmapApi', () => ({ getFinalizedRoadmap: jest.fn() }));
jest.mock('./lib/supabaseClient', () => ({ supabase: { auth: {
  getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
  onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
} } }));
beforeEach(() => {
  localStorage.clear();
  supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
});

test('direct roadmap URL resolves room and schedule through actual App routes', async () => {
  getFinalizedRoadmap.mockResolvedValue(null);
  window.history.replaceState({}, '', '/rooms/1/schedules/2/final-course');
  render(<App />);
  expect(await screen.findByText('아직 최종 확정된 코스가 없습니다.')).toBeInTheDocument();
  expect(getFinalizedRoadmap).toHaveBeenCalledWith('1', '2');
});

test('renders MeetUP entry and navigates to guest login with the real router', async () => {
  window.history.replaceState({}, '', '/');
  render(<App />);
  const entry = screen.getByRole('button', { name: /초대 코드로 참여하기/ });
  expect(entry).toBeInTheDocument();
  fireEvent.click(entry);
  expect(window.location.pathname).toBe('/guest');
  expect(await screen.findByPlaceholderText(/닉네임/)).toBeInTheDocument();
});
