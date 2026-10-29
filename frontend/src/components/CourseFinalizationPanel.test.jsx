import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CourseFinalizationPanel from './CourseFinalizationPanel';
import { finalizeCourse, getCourseConfirmationProgress } from '../api/courseFinalizationApi';
jest.mock('../api/courseFinalizationApi', () => ({ finalizeCourse: jest.fn(), getCourseConfirmationProgress: jest.fn() }));
jest.mock('react-router-dom', () => ({ Link: ({ to, children }) => <a href={to}>{children}</a> }));
jest.mock('./map/KakaoMapView', () => () => <div>코스 지도</div>);
jest.mock('../lib/supabaseClient', () => ({ supabase: {
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; }, removeChannel: jest.fn(),
} }));
const vote = { id: 1, scheduleid: 3, vote_course_links: [{ course_id: 20, vote_option_id: 10 }, { course_id: 21, vote_option_id: 11 }],
  voteoptions: [{ id: 10, optiontext: '코스 A', courseMeta: { course_name: '코스 A', stops: [{ id: 1, stop_order: 1, place_name: '카페', latitude: 37, longitude: 127 }] } }, { id: 11, optiontext: '코스 B' }] };
let progress;
beforeEach(() => {
  progress = { totalVoters: 1, eligibleCount: 3, courseVoteCount: 1, canFinalize: true, finalization: null,
    options: [{ optionId: '10', count: 1, percent: 100 }, { optionId: '11', count: 0, percent: 0 }],
    participants: [{ nickname: '노출하면안됨', status: '미확정' }] };
  getCourseConfirmationProgress.mockReset().mockImplementation(async () => progress);
  finalizeCourse.mockReset();
});
const setup = (props = {}) => render(<CourseFinalizationPanel vote={vote} roomId={2} onFinalized={jest.fn()} {...props} />);

test('득표·비율·막대와 후보별 버튼, 개인별 현황 미노출', async () => {
  setup();
  expect(await screen.findByText('1명 (100%)')).toBeInTheDocument();
  expect(screen.getByText('0명 (0%)')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: '코스 A 득표율' })).toHaveAttribute('aria-valuenow', '100');
  expect(screen.queryByText(/노출하면안됨|미확정|개인 확정 현황/)).not.toBeInTheDocument();
  const buttons = screen.getAllByRole('button', { name: '코스 확정' });
  expect(buttons[0]).toBeEnabled();
  expect(buttons[1]).toBeEnabled();
});
test('비생성자도 전원 투표 전 득표 코스를 확정', async () => {
  progress.isCreator = false;
  finalizeCourse.mockResolvedValue({ course_id: 20 });
  setup();
  fireEvent.click((await screen.findAllByRole('button', { name: '코스 확정' }))[0]);
  await waitFor(() => expect(finalizeCourse).toHaveBeenCalledWith({ scheduleId: 3, roomId: 2, voteId: 1, courseId: 20 }));
});
test('아무도 투표하지 않아도 코스를 확정할 수 있음', async () => {
  progress.options.forEach(option => { option.count = 0; option.percent = 0; });
  progress.totalVoters = 0;
  finalizeCourse.mockResolvedValue({ course_id: 21 });
  setup();
  const buttons = await screen.findAllByRole('button', { name: '코스 확정' });
  expect(buttons.every(button => !button.disabled)).toBe(true);
  fireEvent.click(buttons[1]);
  await waitFor(() => expect(finalizeCourse).toHaveBeenCalledWith({ scheduleId: 3, roomId: 2, voteId: 1, courseId: 21 }));
});
test('조회 오류에서는 확정 버튼을 노출하지 않음', async () => {
  getCourseConfirmationProgress.mockRejectedValue(new Error('조회 실패'));
  setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('조회 실패');
  expect(screen.queryByRole('button', { name: '코스 확정' })).not.toBeInTheDocument();
});
test('최종 확정 표시는 한 코스에만, 다른 코스 확정 및 재투표 차단', async () => {
  progress.finalization = { course_id: 20, course: { course_name: '최종 코스', stops: [{ id: 1, place_name: '확정 카페' }] } };
  setup({ onReVote: jest.fn() });
  expect(await screen.findByText('최종 확정 완료 · 최종 코스')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '코스 확정됨' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '코스 확정' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '다시 투표하기' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '전체 코스 보기' })).toHaveAttribute('href', '/rooms/2/schedules/3/final-course');
});
test('실패 시 완료 표시 안 함, 빠른 중복 클릭은 한 요청', async () => {
  let rejectSave;
  finalizeCourse.mockImplementation(() => new Promise((resolve, reject) => { rejectSave = reject; }));
  setup();
  const button = (await screen.findAllByRole('button', { name: '코스 확정' }))[0];
  fireEvent.click(button); fireEvent.click(button);
  expect(finalizeCourse).toHaveBeenCalledTimes(1);
  rejectSave(new Error('저장 실패'));
  expect(await screen.findByRole('alert')).toHaveTextContent('저장 실패');
  expect(screen.queryByText(/최종 확정 완료/)).not.toBeInTheDocument();
});
test('선택·투표·재투표 동작과 지도 상세', async () => {
  const onSelect = jest.fn(), onSubmit = jest.fn(), onReVote = jest.fn();
  const view = setup({ isVoting: true, selectedOptions: [10], onSelect, onSubmit, onReVote });
  await screen.findByText('1명 (100%)');
  fireEvent.click(screen.getByRole('radio', { name: '코스 B' }));
  expect(onSelect).toHaveBeenCalledWith(11);
  fireEvent.click(screen.getByRole('button', { name: '투표하기' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getAllByRole('button', { name: '지도보기' })[0]);
  expect(screen.getByText('코스 지도')).toBeInTheDocument();
  view.rerender(<CourseFinalizationPanel vote={vote} roomId={2} onFinalized={jest.fn()} onReVote={onReVote} />);
  fireEvent.click(screen.getByRole('button', { name: '다시 투표하기' }));
  expect(onReVote).toHaveBeenCalledTimes(1);
});
