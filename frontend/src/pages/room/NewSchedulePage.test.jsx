import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';
import NewSchedulePage from './NewSchedulePage';
import { saveNewScheduleWithCourse } from '../../api/newScheduleCourseApi';
import { normalizeCourseVoteSelection } from '../../utils/courseVoteUtils';
import { getCurrentRoomParticipantInfo } from '../../api/courseApi';
import { createRoomNotifications } from '../../api/notificationApi';

jest.mock('react-router-dom', () => ({ useLocation: jest.fn(), useNavigate: jest.fn(), useParams: () => ({ roomid: '1' }) }));
jest.mock('../../api/newScheduleCourseApi', () => ({ ...jest.requireActual('../../api/newScheduleCourseApi'), saveNewScheduleWithCourse: jest.fn() }));
jest.mock('../../api/notificationApi', () => ({ createRoomNotifications: jest.fn().mockResolvedValue() }));
jest.mock('../../api/roomApi', () => ({ updateRoomLastActivity: jest.fn() }));
jest.mock('../../api/courseApi', () => ({ getCurrentRoomParticipantInfo: jest.fn().mockResolvedValue({ participantType: 'member', participantId: 'user' }) }));
jest.mock('../../components/CourseVoteComposer', () => function Composer({ options, onChange, onRecommend, schedule }) {
  return <><div>후보 수 {options.length}</div><button disabled={!schedule} onClick={onRecommend}>추천받기</button>
    <button disabled={!schedule} onClick={() => onChange([...options, { courseid: 'manual', course_name: '직접 코스', stops: [
      { id: '11', placeName: '카페', lat: 37.55, lng: 126.92, visitStartTime: '15:30', visitEndTime: '16:30' },
    ] }])}>직접 코스 추가</button></>;
});
let navigate;
beforeEach(() => {
  jest.clearAllMocks();
  getCurrentRoomParticipantInfo.mockResolvedValue({ participantType: 'member', participantId: 'user' });
  createRoomNotifications.mockResolvedValue();
  navigate = jest.fn(); useNavigate.mockReturnValue(navigate);
  useLocation.mockReturnValue({ state: null });
  saveNewScheduleWithCourse.mockResolvedValue({ schedule: { id: 3 }, vote: { id: 7 }, finalization: { id: 9 } });
});
const fill = () => {
  fireEvent.change(screen.getByLabelText('일정 제목'), { target: { value: '새 약속' } });
  fireEvent.change(screen.getByLabelText('일정 날짜'), { target: { value: '2099-11-01' } });
  fireEvent.change(screen.getByLabelText('일정 시작 시간'), { target: { value: '15:30' } });
  fireEvent.change(screen.getByLabelText('일정 종료 시간'), { target: { value: '18:00' } });
};

test('일정·코스 두 선택지만 제공하고 추천은 코스 작성 중에만 표시', () => {
  render(<NewSchedulePage />);
  expect(screen.getByRole('button', { name: '일정 만들기' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText('코스 투표 만들기')).not.toBeInTheDocument();
  expect(screen.queryByText('추천받기')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '코스 만들기' }));
  expect(screen.getByText('추천받기')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '일정 만들기' }));
  expect(screen.queryByText('추천받기')).not.toBeInTheDocument();
});

test('기본값은 코스 없이 일정만 생성', async () => {
  render(<NewSchedulePage />); fill();
  fireEvent.click(screen.getByRole('button', { name: '일정 저장하기' }));
  await waitFor(() => expect(saveNewScheduleWithCourse).toHaveBeenCalledWith(expect.objectContaining({ mode: 'none',
    schedule: expect.objectContaining({ title: '새 약속', date: '2099-11-01' }) })));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/1?tab=schedule&scheduleId=3', { replace: true }));
});

test('직접 코스 하나를 선택해 일정과 함께 확정하고 로드맵으로 이동', async () => {
  render(<NewSchedulePage />); fill();
  fireEvent.click(screen.getByRole('button', { name: '코스 만들기' }));
  fireEvent.click(screen.getByText('직접 코스 추가'));
  expect(screen.getByLabelText('직접 코스')).toBeChecked();
  fireEvent.click(screen.getByText('코스 저장하기'));
  await waitFor(() => expect(saveNewScheduleWithCourse).toHaveBeenCalledWith(expect.objectContaining({ mode: 'direct', selectedCourseId: 'manual' })));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/1/schedules/3/final-course', { replace: true }));
});

test('추천 요청 전에 일정은 저장하지 않고 새 일정 초안을 전달', () => {
  render(<NewSchedulePage />); fill();
  fireEvent.click(screen.getByRole('button', { name: '코스 만들기' }));
  fireEvent.click(screen.getByText('직접 코스 추가'));
  fireEvent.click(screen.getByText('추천받기'));
  expect(saveNewScheduleWithCourse).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledWith('/rooms/1/course-recommendation', expect.objectContaining({ state: expect.objectContaining({
    newScheduleDraft: expect.objectContaining({ mode: 'direct', courses: expect.any(Array), form: expect.objectContaining({ title: '새 약속' }) }),
  }) }));
});

test('날짜·시간 미입력과 일정 초과 후보는 저장 차단', () => {
  render(<NewSchedulePage />);
  fireEvent.click(screen.getByText('일정 저장하기'));
  expect(screen.getByRole('alert')).toHaveTextContent('날짜');
  fill();
  fireEvent.click(screen.getByRole('button', { name: '코스 만들기' }));
  fireEvent.click(screen.getByText('직접 코스 추가'));
  fireEvent.change(screen.getByLabelText('일정 종료 시간'), { target: { value: '16:00' } });
  fireEvent.click(screen.getByText('코스 저장하기'));
  expect(screen.getByRole('alert')).toHaveTextContent('시간표');
  expect(saveNewScheduleWithCourse).not.toHaveBeenCalled();
});

test('일정 생성 뒤 실패하면 입력을 고정하고 저장 진행 상태로 재시도', async () => {
  const progress = { schedule: { id: 3 }, courses: [] };
  saveNewScheduleWithCourse.mockImplementationOnce(async request => {
    request.onProgress(progress); throw new Error('코스 저장 실패');
  }).mockResolvedValueOnce({ ...progress, finalization: { id: 9 } });
  render(<NewSchedulePage />); fill();
  fireEvent.click(screen.getByRole('button', { name: '코스 만들기' }));
  fireEvent.click(screen.getByText('직접 코스 추가'));
  fireEvent.click(screen.getByText('코스 저장하기'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('일정은 이미 생성'));
  expect(screen.getByLabelText('일정 제목')).toBeDisabled();
  fireEvent.click(screen.getByText('남은 저장 다시 시도'));
  await waitFor(() => expect(saveNewScheduleWithCourse).toHaveBeenLastCalledWith(expect.objectContaining({ progress })));
});

test('추천에서 돌아온 새 일정과 코스 초안을 복원', () => {
  const courses = normalizeCourseVoteSelection([{ id: 'recommended', name: '추천 코스', stops: [] }]);
  useLocation.mockReturnValue({ state: { newScheduleDraft: {
    form: { title: '복원할 일정', date: '2099-11-01', starttime: '15:30', endtime: '18:30', isallday: false }, mode: 'direct', courses,
  } } });
  render(<NewSchedulePage />);
  expect(screen.getByDisplayValue('복원할 일정')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '코스 만들기' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('후보 수 1')).toBeInTheDocument();
});
