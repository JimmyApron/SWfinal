import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';
import VoteCreatePage from './VoteCreatePage';
import { supabase } from '../../lib/supabaseClient';
import { createCourseWithStops } from '../../api/courseApi';
import { createVote } from '../../api/voteApi';
import { normalizeCourseVoteSelection } from '../../utils/courseVoteUtils';
import { mockDatabase } from '../../testUtils/mockDatabase';

jest.mock('react-router-dom', () => ({ useLocation: jest.fn(), useNavigate: jest.fn(), useParams: () => ({ roomid: '1' }) }));
jest.mock('../../lib/supabaseClient', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));
jest.mock('../../api/courseApi', () => ({ createCourseWithStops: jest.fn() }));
jest.mock('../../api/voteApi', () => ({ createVote: jest.fn() }));
jest.mock('../../api/scheduleApi', () => ({ getMemberAvailabilities: jest.fn(), getScheduleCandidates: jest.fn() }));
jest.mock('../notification/VoteNotification', () => ({ sendVoteNotification: jest.fn() }));
jest.mock('../../components/map/KakaoMapView', () => function Map() { return <div>지도</div>; });
jest.mock('../../components/map/LocationPicker', () => function Picker({ onSelect }) {
  return <button onClick={() => onSelect('직접 고른 식당', '홍대', { id: '99', lat: 37.55, lng: 126.92 })}>장소 검색 결과 선택</button>;
});
const schedule = { id: 3, roomid: 1, title: '홍대 모임', date: '2026-10-30', starttime: '15:30', endtime: '18:30' };
const recommendation = { id: 'recommended', name: '추천 A', totalDurationMin: 60, stops: [{ id: '10', placeName: '추천 카페', lat: 37.55, lng: 126.92, expectedStayMin: 60, visitStartTime: '15:30', visitEndTime: '16:30' }] };
let navigate;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); jest.clearAllMocks();
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  navigate = jest.fn(); useNavigate.mockReturnValue(navigate);
  useLocation.mockReturnValue({ state: { voteType: 'course', votePurpose: 'course', scheduleId: 3, title: '코스 투표', selectedCourses: [recommendation] } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user', email: 'test@example.com' } } });
  mockDatabase(supabase, { rooms: [{ id: 1, roomname: '테스트 모임' }], profiles: [{ id: 'user', nickname: '작성자' }], confirmed_schedules: [schedule] });
  createCourseWithStops.mockImplementation(async payload => ({ id: payload.courseName === '추천 A' ? 30 : 31, stops: payload.stops }));
  createVote.mockResolvedValue({ id: 50 });
});
afterEach(() => jest.restoreAllMocks());

async function addManual() {
  await waitFor(() => expect(screen.getByText('직접 만들기')).toBeEnabled());
  fireEvent.click(screen.getByText('직접 만들기'));
  fireEvent.change(screen.getByLabelText('코스 이름'), { target: { value: '직접 B' } });
  fireEvent.click(screen.getByText('장소 검색 결과 선택'));
  fireEvent.click(screen.getByText('투표 후보에 추가'));
}

test('추천·직접 코스를 같은 투표에 저장하고 일정 원본 voteid는 덮어쓰지 않음', async () => {
  render(<VoteCreatePage />);
  await addManual();
  expect(screen.getByText('투표 후보 2개')).toBeInTheDocument();
  fireEvent.click(screen.getByText('완료'));
  await waitFor(() => expect(createVote).toHaveBeenCalled());
  expect(createCourseWithStops).toHaveBeenCalledTimes(2);
  expect(createCourseWithStops).toHaveBeenCalledWith(expect.objectContaining({ courseName: '직접 B', scheduleId: 3,
    estimatedCostPerPerson: null, stops: [expect.objectContaining({ place_id: '99', expected_stay_min: 60 })] }));
  expect(createVote).toHaveBeenCalledWith(expect.objectContaining({ scheduleid: 3, votetype: 'course',
    options: [expect.objectContaining({ courseid: 30 }), expect.objectContaining({ courseid: 31 })] }));
});

test('추천 후보를 삭제하면 원래 selectedCourses 대신 남은 직접 코스만 저장', async () => {
  render(<VoteCreatePage />);
  await addManual();
  fireEvent.click(screen.getAllByText('후보 삭제')[0]);
  fireEvent.click(screen.getByText('완료'));
  await waitFor(() => expect(createVote).toHaveBeenCalled());
  expect(createCourseWithStops).toHaveBeenCalledTimes(1);
  expect(createCourseWithStops.mock.calls[0][0].courseName).toBe('직접 B');
});

test('추천 화면으로 이동할 때 제목과 직접 후보 초안을 전달', async () => {
  render(<VoteCreatePage />);
  await addManual();
  fireEvent.click(screen.getByText('추천받기'));
  expect(navigate).toHaveBeenCalledWith('/rooms/1/course-recommendation', expect.objectContaining({ state: expect.objectContaining({
    schedule, courseVoteDraft: expect.objectContaining({ title: '코스 투표', scheduleId: 3, options: expect.any(Array) }),
  }) }));
  expect(navigate.mock.calls[0][1].state.courseVoteDraft.options).toHaveLength(2);
});

test('추천 화면에서 돌아오면 기존 직접 후보와 새 추천 후보를 합치고 제목 복원', async () => {
  const manual = normalizeCourseVoteSelection([{ ...recommendation, id: 'manual', name: '직접 만든 초안' }]);
  useLocation.mockReturnValue({ state: { voteType: 'course', votePurpose: 'course', scheduleId: 3,
    selectedCourses: [recommendation], courseVoteDraft: { title: '유지할 제목', options: manual, scheduleId: 3 } } });
  render(<VoteCreatePage />);
  await waitFor(() => expect(screen.getByText('추천받기')).toBeEnabled());
  expect(screen.getByText('투표 후보 2개')).toBeInTheDocument();
  expect(screen.getByDisplayValue('유지할 제목')).toBeInTheDocument();
  expect(screen.getByText('직접 만든 초안')).toBeInTheDocument();
});
