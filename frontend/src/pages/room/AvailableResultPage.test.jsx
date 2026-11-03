import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';
import AvailableResultPage from './AvailableResultPage';
import { supabase } from '../../lib/supabaseClient';
import { createRoomNotifications } from '../../api/notificationApi';

jest.mock('react-router-dom', () => ({ useLocation: jest.fn(), useNavigate: jest.fn(), useParams: () => ({ roomid: '7' }) }));
jest.mock('../../lib/supabaseClient', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));
jest.mock('../../api/notificationApi', () => ({ createRoomNotifications: jest.fn() }));
jest.mock('../../api/roomApi', () => ({ updateRoomLastActivity: jest.fn().mockResolvedValue() }));
let insert, select, navigate;
beforeEach(() => {
  jest.clearAllMocks();
  navigate = jest.fn(); useNavigate.mockReturnValue(navigate);
  useLocation.mockReturnValue({ state: {
    candidates: [{ date: '2099-11-01' }, { date: '2099-11-02' }],
    availabilities: ['2099-11-01', '2099-11-02'].map(date => ({ date, userid: 'user1', starttime: '10:00', endtime: '12:00' })),
  } });
  select = jest.fn().mockResolvedValue({ data: [{ id: 42 }], error: null });
  insert = jest.fn().mockReturnValue({ select });
  supabase.from.mockReturnValue({ insert });
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user1' } } });
  createRoomNotifications.mockResolvedValue();
});
function open() {
  fireEvent.click(screen.getAllByRole('button', { name: '확정하기' })[0]);
  return within(screen.getByRole('dialog'));
}
test('확정 버튼은 투표 선택을 바꾸지 않고 해당 시간으로 직접 확정한다', async () => {
  render(<AvailableResultPage />);
  const dialog = open();
  expect(screen.getAllByRole('checkbox').every(input => !input.checked)).toBe(true);
  fireEvent.change(dialog.getByLabelText('일정 제목'), { target: { value: '점심 약속' } });
  fireEvent.click(dialog.getByRole('button', { name: '확정하기' }));
  await waitFor(() => expect(insert).toHaveBeenCalledWith([{ roomid: 7, title: '점심 약속', date: '2099-11-01', starttime: '10:00', endtime: '12:00', isallday: false }]));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/7?tab=schedule&scheduleId=42'));
  expect(createRoomNotifications).toHaveBeenCalledWith(expect.objectContaining({ type: 'schedule_confirmed', roomId: 7 }));
});
test('일별 결과는 모든 날짜를 한 번에 하루종일 일정으로 저장한다', async () => {
  render(<AvailableResultPage />);
  fireEvent.click(screen.getByRole('button', { name: '일별' }));
  const dialog = open();
  fireEvent.change(dialog.getByLabelText('일정 제목'), { target: { value: '여행' } });
  fireEvent.click(dialog.getByRole('button', { name: '확정하기' }));
  await waitFor(() => expect(insert).toHaveBeenCalledWith(['2099-11-01', '2099-11-02'].map(date => ({ roomid: 7, title: '여행', date, starttime: null, endtime: null, isallday: true }))));
});
test('제목 누락과 저장 실패를 안내하고 취소하면 저장하지 않는다', async () => {
  render(<AvailableResultPage />);
  const dialog = open();
  fireEvent.click(dialog.getByRole('button', { name: '확정하기' }));
  expect(dialog.getByRole('alert')).toHaveTextContent('제목');
  expect(insert).not.toHaveBeenCalled();
  select.mockResolvedValue({ error: new Error('save failed') });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  fireEvent.change(dialog.getByLabelText('일정 제목'), { target: { value: '약속' } });
  fireEvent.click(dialog.getByRole('button', { name: '확정하기' }));
  await waitFor(() => expect(dialog.getByRole('alert')).toHaveTextContent('확정하지 못했어요'));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: '취소' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(insert).toHaveBeenCalledTimes(1);
  jest.restoreAllMocks();
});
